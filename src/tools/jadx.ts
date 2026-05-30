// ─── JADX Tool Wrapper ────────────────────────────────────────────────────────
// Decompilation and static analysis via JADX. Decompile APK/IPA to Java source,
// search for specific patterns, and extract security-relevant code.

import { execTool, generateSummary, estimateTokens, smartTruncate, writeArtifact } from '../utils/helpers';
import { TOOL_DEFAULTS, ensureArtifactsDir } from '../utils/config';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import type { MCPToolDefinition, ToolResult } from '../types';

const cfg = () => TOOL_DEFAULTS.jadx;

function wrap(name: string, desc: string, schema: Record<string, unknown>, required: string[] = [],
  handler: (args: any) => Promise<ToolResult>): MCPToolDefinition {
  return {
    name: `jadx_${name}`,
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

// ─── Source search utilities ──────────────────────────────────────────────────
function searchInDir(dir: string, pattern: RegExp, maxResults: number = 50): string[] {
  const results: string[] = [];
  try {
    const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.java') && !file.name.endsWith('.smali')) continue;
      if (results.length >= maxResults) break;
      try {
        const content = fs.readFileSync(path.join(file.parentPath || dir, file.name), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            results.push(`${file.name}:${i + 1}: ${lines[i].trim()}`);
            if (results.length >= maxResults) break;
          }
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* dir might not exist */ }
  return results;
}

export const jadxTools: MCPToolDefinition[] = [
  // ─── Decompile ───────────────────────────────────────────────────────────
  wrap('decompile', 'Decompile APK to Java source code', {
    apk_path: { type: 'string', description: 'Path to APK file' },
    output_dir: { type: 'string', description: 'Output directory (default: auto-generated)' },
    show_bad_code: { type: 'boolean', description: 'Show code jadx could not decompile (default: false)' },
    threads: { type: 'number', description: 'Number of processing threads (default: 4)' },
  }, ['apk_path'], async ({ apk_path, output_dir, show_bad_code, threads = 4 }) => {
    const outDir = output_dir || path.join(ensureArtifactsDir(), `jadx_${path.basename(apk_path)}_${Date.now()}`);
    const args: string[] = ['-d', outDir];
    if (threads) args.push('-j', String(threads));
    if (show_bad_code) args.push('--show-bad-code');
    args.push(apk_path);

    const { stdout, stderr, duration } = await execTool({ ...cfg(), timeout: 180000 }, args);

    // Count decompiled files
    let fileCount = 0;
    try {
      const files = fs.readdirSync(outDir, { recursive: true, withFileTypes: true });
      fileCount = files.filter(f => f.isFile()).length;
    } catch { /* ignore */ }

    const output = `Decompiled to: ${outDir}\nFiles generated: ${fileCount}\n${stdout || stderr}`;
    return result('jadx_decompile', output, stderr, duration, [outDir]);
  }),

  wrap('decompile_resources', 'Extract and decode resources (strings, layouts, manifests)', {
    apk_path: { type: 'string', description: 'Path to APK file' },
    output_dir: { type: 'string', description: 'Output directory' },
  }, ['apk_path'], async ({ apk_path, output_dir }) => {
    const outDir = output_dir || path.join(ensureArtifactsDir(), `jadx_resources_${Date.now()}`);
    const args: string[] = ['-d', outDir, '--no-res', apk_path, '-e']; // -e = export resources only
    // Actually, jadx always decompiles. We use --no-src to get only resources.
    const args2: string[] = ['-d', outDir, '--no-src', apk_path];
    const { stdout, stderr, duration } = await execTool({ ...cfg(), timeout: 180000 }, args2);
    const output = `Resources extracted to: ${outDir}\n${stdout || stderr}`;
    return result('jadx_decompile_resources', output, stderr, duration, [outDir]);
  }),

  // ─── Security Search Patterns ────────────────────────────────────────────
  wrap('search_secrets', 'Search decompiled source for hardcoded secrets and keys', {
    source_dir: { type: 'string', description: 'Path to decompiled source directory' },
    apk_path: { type: 'string', description: 'Path to APK (will auto-decompile if source_dir not provided)' },
  }, [], async ({ source_dir, apk_path }) => {
    let searchDir = source_dir;

    // Auto-decompile if needed
    if (!searchDir && apk_path) {
      searchDir = path.join(ensureArtifactsDir(), `jadx_secret_search_${Date.now()}`);
      await execTool({ ...cfg(), timeout: 180000 }, ['-d', searchDir, '--no-res', apk_path]);
    }

    if (!searchDir) {
      return result('jadx_search_secrets', 'Error: provide source_dir or apk_path', '', 0);
    }

    const start = Date.now();
    const secretPatterns = [
      /api[_-]?key\s*=\s*["'][^"']+["']/gi,
      /password\s*=\s*["'][^"']+["']/gi,
      /secret\s*=\s*["'][^"']+["']/gi,
      /token\s*=\s*["'][^"']+["']/gi,
      /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
      /AIza[0-9A-Za-z\-_]{35}/g,                      // Google API key
      /sk-[a-zA-Z0-9]{48}/g,                           // OpenAI key
      /ghp_[a-zA-Z0-9]{36}/g,                           // GitHub PAT
      /xox[bsrp]-[a-zA-Z0-9\-]{10,}/g,                // Slack token
      /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g,
      /aws_access_key_id\s*=\s*["'][A-Z0-9]{20}["']/gi,
      /client_secret\s*=\s*["'][^"']+["']/gi,
      /jdbc:[a-z]+:\/\/[^\s"']+/gi,
    ];

    const allResults: string[] = [];
    for (const pattern of secretPatterns) {
      const matches = searchInDir(searchDir, pattern, 20);
      for (const m of matches) allResults.push(m);
    }

    const output = allResults.length > 0
      ? `Found ${allResults.length} potential secrets:\n` + allResults.join('\n')
      : 'No hardcoded secrets found in decompiled source.';
    const duration = Date.now() - start;
    return result('jadx_search_secrets', output, '', duration);
  }),

  wrap('search_crypto', 'Search for cryptographic implementations and potential weaknesses', {
    source_dir: { type: 'string', description: 'Decompiled source directory' },
    apk_path: { type: 'string', description: 'APK path (auto-decompile)' },
  }, [], async ({ source_dir, apk_path }) => {
    let searchDir = source_dir;
    if (!searchDir && apk_path) {
      searchDir = path.join(ensureArtifactsDir(), `jadx_crypto_search_${Date.now()}`);
      await execTool({ ...cfg(), timeout: 180000 }, ['-d', searchDir, '--no-res', apk_path]);
    }

    const start = Date.now();
    const cryptoPatterns = [
      /Cipher\.getInstance\s*\(\s*["']([^"']+)["']/g,  // Algorithm names
      /MessageDigest\.getInstance/g,
      /SecretKeySpec/g,
      /IvParameterSpec/g,
      /DES|AES|RSA|ECB|CBC|GCM|MD5|SHA-?1/gi,
      /PKCS5Padding|PKCS7Padding/g,
      /InsecureCrypto|HardcodedKey|StaticIV/gi,
      /KeyGenerator\.getInstance/g,
      /SecureRandom\.getInstance/g,
    ];

    const allResults: string[] = [];
    for (const pattern of cryptoPatterns) {
      const matches = searchInDir(searchDir, pattern, 30);
      for (const m of matches) allResults.push(m);
    }

    const output = allResults.length > 0
      ? `Found ${allResults.length} crypto-related code:\n` + allResults.join('\n')
      : 'No cryptographic code found.';
    return result('jadx_search_crypto', output, '', Date.now() - start);
  }),

  wrap('search_urls', 'Extract all URLs and endpoints from decompiled source', {
    source_dir: { type: 'string', description: 'Decompiled source directory' },
    apk_path: { type: 'string', description: 'APK path (auto-decompile)' },
  }, [], async ({ source_dir, apk_path }) => {
    let searchDir = source_dir;
    if (!searchDir && apk_path) {
      searchDir = path.join(ensureArtifactsDir(), `jadx_url_search_${Date.now()}`);
      await execTool({ ...cfg(), timeout: 180000 }, ['-d', searchDir, '--no-res', apk_path]);
    }

    const start = Date.now();
    const urlPattern = /https?:\/\/[^\s"'<>\\)]+/g;
    const matches = searchInDir(searchDir, urlPattern, 100);

    // Deduplicate
    const unique = [...new Set(matches.map(m => m.split(': ').pop()))];
    const output = `Found ${unique.length} unique URLs:\n` + unique.join('\n');
    return result('jadx_search_urls', output, '', Date.now() - start);
  }),

  wrap('search_permissions', 'Analyze permission usage in code', {
    source_dir: { type: 'string', description: 'Decompiled source directory' },
    apk_path: { type: 'string', description: 'APK path (auto-decompile)' },
  }, [], async ({ source_dir, apk_path }) => {
    let searchDir = source_dir;
    if (!searchDir && apk_path) {
      searchDir = path.join(ensureArtifactsDir(), `jadx_perm_search_${Date.now()}`);
      await execTool({ ...cfg(), timeout: 180000 }, ['-d', searchDir, '--no-res', apk_path]);
    }

    const start = Date.now();
    const permPatterns = [
      /checkPermission|requestPermission|PERMISSION_/g,
      /READ_CONTACTS|WRITE_CONTACTS|READ_SMS|SEND_SMS/g,
      /ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/g,
      /CAMERA|RECORD_AUDIO|READ_PHONE_STATE/g,
      /WRITE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE/g,
      /INTERNET|ACCESS_NETWORK_STATE/g,
    ];

    const allResults: string[] = [];
    for (const pattern of permPatterns) {
      const matches = searchInDir(searchDir, pattern, 20);
      for (const m of matches) allResults.push(m);
    }

    const output = allResults.length > 0
      ? `Found ${allResults.length} permission references:\n` + allResults.join('\n')
      : 'No direct permission checks found.';
    return result('jadx_search_permissions', output, '', Date.now() - start);
  }),

  wrap('read_source', 'Read a specific decompiled Java/Smali file', {
    source_dir: { type: 'string', description: 'Decompiled source directory' },
    file_path: { type: 'string', description: 'Relative path to the source file' },
    max_lines: { type: 'number', description: 'Max lines to return (default: 100)' },
  }, ['source_dir', 'file_path'], async ({ source_dir, file_path, max_lines = 100 }) => {
    const start = Date.now();
    if (!source_dir || !file_path) {
      return result('jadx_read_source', 'Error: source_dir and file_path are required', '', 0);
    }
    const fullPath = path.join(source_dir, file_path);

    try {
      if (!fs.existsSync(fullPath)) {
        // Try fuzzy search
        if (fs.existsSync(source_dir)) {
          const files = fs.readdirSync(source_dir, { recursive: true, withFileTypes: true });
          const matches = files.filter(f =>
            f.name.includes(path.basename(file_path)) || file_path.includes(f.name)
          ).map(f => f.path || path.join(f.parentPath || source_dir, f.name));

          if (matches.length > 0) {
            const content = fs.readFileSync(matches[0], 'utf-8');
            const { text, truncated } = smartTruncate(content, max_lines * 100);
            return result('jadx_read_source', `File: ${matches[0]}${truncated ? '\n[TRUNCATED]' : ''}\n${text}`, '', Date.now() - start);
          }
        }
        return result('jadx_read_source', `File not found: ${fullPath}`, '', 0);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const { text, truncated } = smartTruncate(content, max_lines * 100);
      return result('jadx_read_source', `File: ${fullPath}${truncated ? '\n[TRUNCATED]' : ''}\n${text}`, '', Date.now() - start);
    } catch (err: any) {
      return result('jadx_read_source', `Error reading source file: ${err.message}`, '', Date.now() - start);
    }
  }),

  wrap('list_classes', 'List all decompiled Java classes', {
    source_dir: { type: 'string', description: 'Decompiled source directory' },
    filter: { type: 'string', description: 'Filter class name substring' },
  }, ['source_dir'], async ({ source_dir, filter }) => {
    const start = Date.now();
    if (!source_dir) {
      return result('jadx_list_classes', 'Error: source_dir is required', '', 0);
    }
    try {
      if (!fs.existsSync(source_dir)) {
        return result('jadx_list_classes', `Source directory not found: ${source_dir}`, '', 0);
      }
      const files = fs.readdirSync(source_dir, { recursive: true, withFileTypes: true });
      const classes = files
        .filter(f => f.isFile() && f.name.endsWith('.java') && (!filter || f.name.includes(filter)))
        .map(f => path.join(f.parentPath || source_dir, f.name).replace(source_dir + '/', '').replace('.java', ''));

      const output = `Found ${classes.length} classes:\n` + classes.join('\n');
      return result('jadx_list_classes', output, '', Date.now() - start);
    } catch (err: any) {
      return result('jadx_list_classes', `Error listing classes: ${err.message}`, '', Date.now() - start);
    }
  }),

  // ─── APK Structure ───────────────────────────────────────────────────────
  wrap('show_structure', 'Show APK structure (manifest, activities, services, etc.)', {
    apk_path: { type: 'string', description: 'Path to APK file' },
  }, ['apk_path'], async ({ apk_path }) => {
    const start = Date.now();
    if (!apk_path) {
      return result('jadx_show_structure', 'Error: apk_path is required', '', 0);
    }
    const outDir = path.join(ensureArtifactsDir(), `jadx_structure_${Date.now()}`);
    await execTool({ ...cfg(), timeout: 180000 }, ['-d', outDir, '--no-src', apk_path]);

    try {
      if (!fs.existsSync(outDir)) {
        return result('jadx_show_structure', 'Error: Decompilation output directory was not created.', '', Date.now() - start);
      }
      // Read AndroidManifest.xml
      const manifestPath = path.join(outDir, 'resources', 'AndroidManifest.xml');
      let output = '';
      if (fs.existsSync(manifestPath)) {
        output = fs.readFileSync(manifestPath, 'utf-8');
      } else {
        // Try to find it
        const files = fs.readdirSync(outDir, { recursive: true });
        const mf = files.find(f => typeof f === 'string' && f.includes('AndroidManifest'));
        if (mf) output = fs.readFileSync(path.join(outDir, String(mf)), 'utf-8');
        else output = 'Manifest not found. APK may be corrupted or protected.';
      }

      return result('jadx_show_structure', output, '', Date.now() - start);
    } catch (err: any) {
      return result('jadx_show_structure', `Error showing structure: ${err.message}`, '', Date.now() - start);
    }
  }),
];
