// ─── APKTool Tool Wrapper ─────────────────────────────────────────────────────
// APK unpacking, resource decoding, smali modification, and repacking.
// Essential for: modifying manifests, removing protections, patching apps.

import { execTool, generateSummary, estimateTokens, smartTruncate, writeArtifact } from '../utils/helpers';
import { TOOL_DEFAULTS, ensureArtifactsDir } from '../utils/config';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import type { MCPToolDefinition, ToolResult } from '../types';

const cfg = () => TOOL_DEFAULTS.apktool;

function wrap(name: string, desc: string, schema: Record<string, unknown>, required: string[] = [],
  handler: (args: any) => Promise<ToolResult>): MCPToolDefinition {
  return {
    name: `apktool_${name}`,
    description: desc,
    inputSchema: { type: 'object' as const, properties: schema, required },
    handler,
  };
}

function result(tool: string, stdout: string, stderr: string, duration: number, artifacts: string[] = []): ToolResult {
  const output = stdout || stderr;
  return {
    tool, success: !stderr || !!stdout,
    output, summary: generateSummary(output, tool),
    artifacts, durationMs: duration, cached: false,
    tier: 'summary', tokensEstimate: estimateTokens(output), tokensSaved: 0,
  };
}

export const apktoolTools: MCPToolDefinition[] = [
  // ─── Decode ──────────────────────────────────────────────────────────────
  wrap('decode', 'Decode APK to smali + resources', {
    apk_path: { type: 'string', description: 'Path to APK file' },
    output_dir: { type: 'string', description: 'Output directory' },
    no_src: { type: 'boolean', description: 'Do not decode sources (default: false)' },
    no_res: { type: 'boolean', description: 'Do not decode resources (default: false)' },
    force: { type: 'boolean', description: 'Overwrite existing output (default: true)' },
  }, ['apk_path'], async ({ apk_path, output_dir, no_src, no_res, force = true }) => {
    try {
      if (!apk_path) {
        return result('apktool_decode', 'Error: apk_path is required', 'Missing parameter', 0);
      }
      const outDir = output_dir || path.join(ensureArtifactsDir(), `apktool_${path.basename(apk_path)}_${Date.now()}`);
      const args: string[] = ['d', apk_path, '-o', outDir, '-f'];
      if (no_src) args.push('-s');
      if (no_res) args.push('-r');

      const { stdout, stderr, duration } = await execTool({ ...cfg(), timeout: 180000 }, args);

      let fileCount = 0;
      try {
        if (fs.existsSync(outDir)) {
          fileCount = fs.readdirSync(outDir, { recursive: true, withFileTypes: true }).filter(f => f.isFile()).length;
        }
      } catch { /* ignore */ }

      const output = `Decoded to: ${outDir}\nFiles: ${fileCount}\n${stdout || stderr}`;
      return result('apktool_decode', output, stderr, duration, [outDir]);
    } catch (error: any) {
      return result('apktool_decode', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  // ─── Build / Repack ──────────────────────────────────────────────────────
  wrap('build', 'Rebuild APK from decoded directory', {
    input_dir: { type: 'string', description: 'Decoded APK directory' },
    output_apk: { type: 'string', description: 'Output APK path' },
    use_aapt2: { type: 'boolean', description: 'Use aapt2 (default: true)' },
  }, ['input_dir'], async ({ input_dir, output_apk, use_aapt2 = true }) => {
    try {
      if (!input_dir) {
        return result('apktool_build', 'Error: input_dir is required', 'Missing parameter', 0);
      }
      const outApk = output_apk || path.join(ensureArtifactsDir(), `rebuilt_${Date.now()}.apk`);
      const args: string[] = ['b', input_dir, '-o', outApk];
      if (!use_aapt2) args.push('--use-aapt1');

      const { stdout, stderr, duration } = await execTool({ ...cfg(), timeout: 180000 }, args);
      const output = `Built APK: ${outApk}\n${stdout || stderr}`;
      return result('apktool_build', output, stderr, duration, [outApk]);
    } catch (error: any) {
      return result('apktool_build', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  // ─── Manifest Operations ─────────────────────────────────────────────────
  wrap('read_manifest', 'Read the decoded AndroidManifest.xml', {
    decoded_dir: { type: 'string', description: 'Decoded APK directory' },
  }, ['decoded_dir'], async ({ decoded_dir }) => {
    try {
      if (!decoded_dir) {
        return result('apktool_read_manifest', 'Error: decoded_dir is required', 'Missing parameter', 0);
      }
      const manifestPath = path.join(decoded_dir, 'AndroidManifest.xml');
      if (!fs.existsSync(manifestPath)) {
        return result('apktool_read_manifest', `Manifest not found at: ${manifestPath}`, '', 0);
      }

      const content = fs.readFileSync(manifestPath, 'utf-8');
      const { text, truncated } = smartTruncate(content, 30000);
      return result('apktool_read_manifest', `${truncated ? '[TRUNCATED]\n' : ''}${text}`, '', 0);
    } catch (error: any) {
      return result('apktool_read_manifest', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  wrap('patch_manifest', 'Patch AndroidManifest.xml (modify permissions, components, flags)', {
    decoded_dir: { type: 'string', description: 'Decoded APK directory' },
    patches: { type: 'string', description: 'JSON array of patches: [{"op":"remove_permission","value":"..."}, {"op":"set_debuggable","value":true}, {"op":"set_exported","component":"...","value":true}]' },
  }, ['decoded_dir', 'patches'], async ({ decoded_dir, patches }) => {
    try {
      if (!decoded_dir || !patches) {
        return result('apktool_patch_manifest', 'Error: decoded_dir and patches are required', 'Missing parameter', 0);
      }
      const manifestPath = path.join(decoded_dir, 'AndroidManifest.xml');
      if (!fs.existsSync(manifestPath)) {
        return result('apktool_patch_manifest', 'Manifest not found', '', 0);
      }

      let content = fs.readFileSync(manifestPath, 'utf-8');
      let patchList;

      try {
        patchList = typeof patches === 'string' ? JSON.parse(patches) : patches;
      } catch {
        return result('apktool_patch_manifest', 'Invalid patches JSON', '', 0);
      }

      const applied: string[] = [];

      for (const patch of patchList) {
        switch (patch.op) {
          case 'remove_permission':
            content = content.replace(
              new RegExp(`<uses-permission\\s+android:name="${patch.value}"[^/]*/>`, 'g'),
              `<!-- REMOVED: ${patch.value} -->`
            );
            applied.push(`Removed permission: ${patch.value}`);
            break;

          case 'add_permission':
            if (!content.includes(`android:name="${patch.value}"`)) {
              content = content.replace('</manifest>', `<uses-permission android:name="${patch.value}"/>\n</manifest>`);
            }
            applied.push(`Added permission: ${patch.value}`);
            break;

          case 'set_debuggable':
            content = content.replace(
              /android:debuggable="[^"]*"/g,
              `android:debuggable="${patch.value ? 'true' : 'false'}"`
            );
            if (!content.includes('android:debuggable')) {
              content = content.replace(
                '<application',
                `<application android:debuggable="${patch.value ? 'true' : 'false'}"`
              );
            }
            applied.push(`Set debuggable: ${patch.value}`);
            break;

          case 'set_exported':
            const componentRegex = new RegExp(
              `(<(?:activity|service|receiver|provider)[^>]*android:name="${patch.component}"[^>]*)(android:exported="[^"]*")?`,
              'g'
            );
            content = content.replace(componentRegex, (match, prefix, existing) => {
              if (existing) return match.replace(existing, `android:exported="${patch.value ? 'true' : 'false'}"`);
              return `${prefix} android:exported="${patch.value ? 'true' : 'false'}"`;
            });
            applied.push(`Set exported=${patch.value}: ${patch.component}`);
            break;

          case 'set_allow_backup':
            content = content.replace(
              /android:allowBackup="[^"]*"/g,
              `android:allowBackup="${patch.value ? 'true' : 'false'}"`
            );
            applied.push(`Set allowBackup: ${patch.value}`);
            break;

          case 'remove_network_security_config':
            content = content.replace(
              /android:networkSecurityConfig="[^"]*"/g,
              ''
            );
            applied.push('Removed networkSecurityConfig');
            break;

          case 'set_uses_cleartext':
            content = content.replace(
              /android:usesCleartextTraffic="[^"]*"/g,
              `android:usesCleartextTraffic="${patch.value ? 'true' : 'false'}"`
            );
            if (!content.includes('android:usesCleartextTraffic')) {
              content = content.replace(
                '<application',
                `<application android:usesCleartextTraffic="${patch.value ? 'true' : 'false'}"`
              );
            }
            applied.push(`Set usesCleartextTraffic: ${patch.value}`);
            break;
        }
      }

      // Backup original
      fs.copyFileSync(manifestPath, manifestPath + '.bak');
      fs.writeFileSync(manifestPath, content, 'utf-8');

      const output = `Applied ${applied.length} patches:\n` + applied.join('\n');
      return result('apktool_patch_manifest', output, '', 0);
    } catch (error: any) {
      return result('apktool_patch_manifest', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  // ─── Smali Operations ────────────────────────────────────────────────────
  wrap('read_smali', 'Read a smali file from decoded APK', {
    decoded_dir: { type: 'string', description: 'Decoded APK directory' },
    smali_path: { type: 'string', description: 'Relative path to smali file' },
    max_lines: { type: 'number', description: 'Max lines (default: 200)' },
  }, ['decoded_dir', 'smali_path'], async ({ decoded_dir, smali_path, max_lines = 200 }) => {
    try {
      if (!decoded_dir || !smali_path) {
        return result('apktool_read_smali', 'Error: decoded_dir and smali_path are required', 'Missing parameter', 0);
      }
      const fullPath = path.join(decoded_dir, smali_path);
      if (!fs.existsSync(fullPath)) {
        return result('apktool_read_smali', `File not found: ${fullPath}`, '', 0);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const { text, truncated } = smartTruncate(content, max_lines * 80);
      return result('apktool_read_smali', `${truncated ? '[TRUNCATED]\n' : ''}${text}`, '', 0);
    } catch (error: any) {
      return result('apktool_read_smali', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  wrap('patch_smali', 'Patch a smali file (inject/remove/modify instructions)', {
    decoded_dir: { type: 'string', description: 'Decoded APK directory' },
    smali_path: { type: 'string', description: 'Relative path to smali file' },
    find: { type: 'string', description: 'Text to find (or regex pattern)' },
    replace: { type: 'string', description: 'Replacement text' },
    insert_after: { type: 'string', description: 'Insert after this line' },
    insert_code: { type: 'string', description: 'Code to insert' },
    use_regex: { type: 'boolean', description: 'Use regex for find (default: false)' },
  }, ['decoded_dir', 'smali_path'], async ({ decoded_dir, smali_path, find, replace, insert_after, insert_code, use_regex }) => {
    try {
      if (!decoded_dir || !smali_path) {
        return result('apktool_patch_smali', 'Error: decoded_dir and smali_path are required', 'Missing parameter', 0);
      }
      const fullPath = path.join(decoded_dir, smali_path);
      if (!fs.existsSync(fullPath)) {
        return result('apktool_patch_smali', `File not found: ${fullPath}`, '', 0);
      }

      let content = fs.readFileSync(fullPath, 'utf-8');
      const applied: string[] = [];

      // Find & Replace
      if (find && replace !== undefined) {
        const regex = use_regex ? new RegExp(find, 'g') : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = content.match(regex);
        content = content.replace(regex, replace);
        applied.push(`Replaced ${matches?.length || 0} occurrences`);
      }

      // Insert after
      if (insert_after && insert_code) {
        const lines = content.split('\n');
        const idx = lines.findIndex(l => l.includes(insert_after));
        if (idx >= 0) {
          lines.splice(idx + 1, 0, insert_code);
          content = lines.join('\n');
          applied.push(`Inserted after line ${idx + 1}`);
        } else {
          applied.push(`Warning: pattern "${insert_after}" not found`);
        }
      }

      // Backup & save
      fs.copyFileSync(fullPath, fullPath + '.bak');
      fs.writeFileSync(fullPath, content, 'utf-8');

      return result('apktool_patch_smali', `Applied ${applied.length} smali patches:\n` + applied.join('\n'), '', 0);
    } catch (error: any) {
      return result('apktool_patch_smali', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  // ─── Smali Search ────────────────────────────────────────────────────────
  wrap('search_smali', 'Search smali code for patterns', {
    decoded_dir: { type: 'string', description: 'Decoded APK directory' },
    pattern: { type: 'string', description: 'Search pattern (text or regex)' },
    use_regex: { type: 'boolean', description: 'Use regex (default: false)' },
    max_results: { type: 'number', description: 'Max results (default: 50)' },
  }, ['decoded_dir', 'pattern'], async ({ decoded_dir, pattern, use_regex, max_results = 50 }) => {
    try {
      if (!decoded_dir || !pattern) {
        return result('apktool_search_smali', 'Error: decoded_dir and pattern are required', 'Missing parameter', 0);
      }
      const start = Date.now();
      const results: string[] = [];
      const smaliDir = path.join(decoded_dir, 'smali');

      if (!fs.existsSync(smaliDir)) {
        return result('apktool_search_smali', `Smali directory not found: ${smaliDir}`, '', 0);
      }

      const regex = use_regex ? new RegExp(pattern, 'g') : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const files = fs.readdirSync(smaliDir, { recursive: true, withFileTypes: true });

      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.smali') || results.length >= max_results) continue;
        try {
          const fullPath = path.join(file.parentPath || smaliDir, file.name);
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const relPath = path.relative(decoded_dir, fullPath);
              results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= max_results) break;
            }
          }
        } catch { /* skip */ }
      }

      const output = `Found ${results.length} matches:\n` + results.join('\n');
      return result('apktool_search_smali', output, '', Date.now() - start);
    } catch (error: any) {
      return result('apktool_search_smali', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  // ─── Resource Operations ─────────────────────────────────────────────────
  wrap('read_resource', 'Read a specific resource file', {
    decoded_dir: { type: 'string', description: 'Decoded APK directory' },
    resource_path: { type: 'string', description: 'Relative path to resource file' },
  }, ['decoded_dir', 'resource_path'], async ({ decoded_dir, resource_path }) => {
    try {
      if (!decoded_dir || !resource_path) {
        return result('apktool_read_resource', 'Error: decoded_dir and resource_path are required', 'Missing parameter', 0);
      }
      const fullPath = path.join(decoded_dir, 'res', resource_path);
      if (!fs.existsSync(fullPath)) {
        return result('apktool_read_resource', `Resource not found: ${fullPath}`, '', 0);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const { text, truncated } = smartTruncate(content, 20000);
      return result('apktool_read_resource', `${truncated ? '[TRUNCATED]\n' : ''}${text}`, '', 0);
    } catch (error: any) {
      return result('apktool_read_resource', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  wrap('list_resources', 'List all resource files', {
    decoded_dir: { type: 'string', description: 'Decoded APK directory' },
    filter: { type: 'string', description: 'Filter by name or extension' },
  }, ['decoded_dir'], async ({ decoded_dir, filter }) => {
    try {
      if (!decoded_dir) {
        return result('apktool_list_resources', 'Error: decoded_dir is required', 'Missing parameter', 0);
      }
      const resDir = path.join(decoded_dir, 'res');
      if (!fs.existsSync(resDir)) {
        return result('apktool_list_resources', 'No resources directory found', '', 0);
      }

      const files = fs.readdirSync(resDir, { recursive: true, withFileTypes: true })
        .filter(f => f.isFile() && (!filter || f.name.includes(filter)))
        .map(f => path.join(f.parentPath || resDir, f.name).replace(resDir + '/', ''));

      const output = `Found ${files.length} resource files:\n` + files.join('\n');
      return result('apktool_list_resources', output, '', 0);
    } catch (error: any) {
      return result('apktool_list_resources', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),

  // ─── Full Pipeline ───────────────────────────────────────────────────────
  wrap('patch_and_rebuild', 'Full pipeline: decode → patch → rebuild → sign', {
    apk_path: { type: 'string', description: 'Path to original APK' },
    manifest_patches: { type: 'string', description: 'JSON patches for manifest (same format as patch_manifest)' },
    smali_patches: { type: 'string', description: 'JSON array: [{"path":"smali/file.smali","find":"...","replace":"..."}]' },
    output_apk: { type: 'string', description: 'Output APK path' },
  }, ['apk_path'], async ({ apk_path, manifest_patches, smali_patches, output_apk }) => {
    try {
      if (!apk_path) {
        return result('apktool_patch_and_rebuild', 'Error: apk_path is required', 'Missing parameter', 0);
      }
      const start = Date.now();
      const workDir = path.join(ensureArtifactsDir(), `patch_${Date.now()}`);

      // Step 1: Decode
      const { stdout: d1, stderr: e1, duration: dur1 } = await execTool(
        { ...cfg(), timeout: 180000 }, ['d', apk_path, '-o', workDir, '-f']
      );

      const applied: string[] = [];

      // Step 2: Manifest patches
      if (manifest_patches) {
        const manifestPath = path.join(workDir, 'AndroidManifest.xml');
        if (fs.existsSync(manifestPath)) {
          let content = fs.readFileSync(manifestPath, 'utf-8');
          const patches = JSON.parse(manifest_patches);
          for (const patch of patches) {
            switch (patch.op) {
              case 'remove_permission':
                content = content.replace(
                  new RegExp(`<uses-permission\\s+android:name="${patch.value}"[^/]*/>`, 'g'),
                  `<!-- REMOVED -->`
                );
                applied.push(`Removed: ${patch.value}`);
                break;
              case 'set_debuggable':
                content = content.replace(/android:debuggable="[^"]*"/g, 'android:debuggable="true"');
                applied.push('Set debuggable=true');
                break;
            }
          }
          fs.writeFileSync(manifestPath, content);
        }
      }

      // Step 3: Smali patches
      if (smali_patches) {
        const patches = JSON.parse(smali_patches);
        for (const p of patches) {
          const fullPath = path.join(workDir, p.path);
          if (fs.existsSync(fullPath)) {
            let content = fs.readFileSync(fullPath, 'utf-8');
            content = content.replace(p.find, p.replace);
            fs.writeFileSync(fullPath, content);
            applied.push(`Patched: ${p.path}`);
          }
        }
      }

      // Step 4: Rebuild
      const outApk = output_apk || path.join(ensureArtifactsDir(), `patched_${Date.now()}.apk`);
      const { stdout: b1, stderr: e2, duration: dur2 } = await execTool(
        { ...cfg(), timeout: 180000 }, ['b', workDir, '-o', outApk]
      );

      const duration = Date.now() - start;
      const output = `Pipeline complete!\nOutput: ${outApk}\n\nApplied patches:\n${applied.join('\n')}\n\nRebuild log:\n${b1 || e2}`;

      return result('apktool_patch_and_rebuild', output, e1 || e2, duration, [outApk]);
    } catch (error: any) {
      return result('apktool_patch_and_rebuild', `Exception occurred: ${error.message}`, error.message, 0);
    }
  }),
];
