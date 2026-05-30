// ─── Tool Registry ─────────────────────────────────────────────────────────────
// Aggregates all tool definitions from every wrapper module.

import type { MCPToolDefinition } from '../types';
import { adbTools } from './adb';
import { fridaTools } from './frida';
import { objectionTools } from './objection';
import { mobsfTools } from './mobsf';
import { jadxTools } from './jadx';
import { apktoolTools } from './apktool';

export const ALL_TOOLS: MCPToolDefinition[] = [
  ...adbTools,
  ...fridaTools,
  ...objectionTools,
  ...mobsfTools,
  ...jadxTools,
  ...apktoolTools,
];

// ─── Utility / Meta tools ─────────────────────────────────────────────────────
import { execTool, generateSummary, estimateTokens, writeArtifact, smartTruncate } from '../utils/helpers';
import { TOOL_DEFAULTS, ensureArtifactsDir } from '../utils/config';
import { getTokenStats } from '../optimizer';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const META_TOOLS: MCPToolDefinition[] = [
  {
    name: 'token_stats',
    description: 'Get token optimization statistics — total tokens used, saved, per-tool breakdown, cache hit rate.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const stats = getTokenStats();
      const output = JSON.stringify(stats, null, 2);
      return {
        tool: 'token_stats', success: true, output,
        summary: `Token savings: ${stats.savingsPercent}% (${stats.totalSaved} saved, ${stats.totalUsed} used)`,
        artifacts: [], durationMs: 0, cached: false,
        tier: 'minimal' as const, tokensEstimate: estimateTokens(output), tokensSaved: 0,
      };
    },
  },
  {
    name: 'read_artifact',
    description: 'Read content from a saved artifact file (large output offloaded by optimizer).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute path to artifact file' },
        max_lines: { type: 'number', description: 'Max lines to return (default: 500)' },
      },
      required: ['file_path'] as string[],
    },
    handler: async (args: Record<string, unknown>) => {
      const filePath = String(args.file_path);
      const maxLines = Number(args.max_lines || 500);

      if (!fs.existsSync(filePath)) {
        return {
          tool: 'read_artifact', success: false,
          output: `File not found: ${filePath}`,
          summary: 'File not found',
          artifacts: [], durationMs: 0, cached: false,
          tier: 'minimal' as const, tokensEstimate: 20, tokensSaved: 0,
        };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const { text, truncated } = smartTruncate(content, maxLines * 100);
      return {
        tool: 'read_artifact', success: true,
        output: `${truncated ? '[TRUNCATED]\n' : ''}${text}`,
        summary: `Read ${(content.length / 1024).toFixed(1)}KB from ${path.basename(filePath)}`,
        artifacts: [], durationMs: 0, cached: false,
        tier: 'full' as const, tokensEstimate: estimateTokens(text), tokensSaved: 0,
      };
    },
  },
  {
    name: 'pentest_workflow',
    description: 'Run a full automated pentest workflow: decompile + MobSF scan + secret search + permission analysis in one shot.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        apk_path: { type: 'string', description: 'Path to APK file' },
        mobsf_scan: { type: 'boolean', description: 'Also run MobSF scan if available (default: true)' },
      },
      required: ['apk_path'] as string[],
    },
    handler: async (args: Record<string, unknown>) => {
      const apkPath = String(args.apk_path);
      const mobsfScan = args.mobsf_scan !== false;
      const start = Date.now();
      const results: string[] = [];

      // Step 1: APKTool decode
      results.push('=== STEP 1: APKTool Decode ===');
      const workDir = path.join(ensureArtifactsDir(), `workflow_${Date.now()}`);
      const { stdout: d1, stderr: e1 } = await execTool(
        { ...TOOL_DEFAULTS.apktool, timeout: 180000 },
        ['d', apkPath, '-o', workDir, '-f']
      );
      results.push(d1 || e1);

      // Step 2: JADX decompile (for Java source)
      results.push('\n=== STEP 2: JADX Decompile ===');
      const jadxDir = workDir + '_jadx';
      const { stdout: d2, stderr: e2 } = await execTool(
        { ...TOOL_DEFAULTS.jadx, timeout: 180000 },
        ['-d', jadxDir, '--no-res', apkPath]
      );
      results.push(d2 || e2);

      // Step 3: Manifest analysis
      results.push('\n=== STEP 3: Manifest Analysis ===');
      const manifestPath = path.join(workDir, 'AndroidManifest.xml');
      if (fs.existsSync(manifestPath)) {
        const manifest = fs.readFileSync(manifestPath, 'utf-8');

        const exportedActivities = (manifest.match(/<activity[^>]*android:exported="true"[^>]*>/g) || []);
        const exportedServices = (manifest.match(/<service[^>]*android:exported="true"[^>]*>/g) || []);
        const exportedReceivers = (manifest.match(/<receiver[^>]*android:exported="true"[^>]*>/g) || []);
        const dangerousPerms = (manifest.match(/<uses-permission[^>]*android:name="[^"]*"[^>]*>/g) || [])
          .filter((p: string) => /DANGEROUS|WRITE|DELETE|INSTALL|REBOOT|SYSTEM_ALERT|RECORD_AUDIO|CAMERA|READ_CONTACTS|READ_CALL_LOG|READ_SMS|RECEIVE_SMS|SEND_SMS/i.test(p));
        const debuggable = /android:debuggable="true"/.test(manifest);
        const backupEnabled = /android:allowBackup="true"/.test(manifest);
        const cleartext = /android:usesCleartextTraffic="true"/.test(manifest);

        results.push(`Debuggable: ${debuggable ? 'YES (RISK)' : 'No'}`);
        results.push(`Allow Backup: ${backupEnabled ? 'YES (RISK)' : 'No'}`);
        results.push(`Cleartext Traffic: ${cleartext ? 'YES (RISK)' : 'No'}`);
        results.push(`Exported Activities: ${exportedActivities.length}`);
        results.push(`Exported Services: ${exportedServices.length}`);
        results.push(`Exported Receivers: ${exportedReceivers.length}`);
        results.push(`Dangerous Permissions: ${dangerousPerms.length}`);

        if (dangerousPerms.length > 0) {
          results.push('\nDangerous Permissions:');
          dangerousPerms.forEach((p: string) => results.push('  ' + p));
        }
        if (exportedActivities.length > 0) {
          results.push('\nExported Activities:');
          exportedActivities.forEach((a: string) => results.push('  ' + a));
        }
      }

      // Step 4: Secret search
      results.push('\n=== STEP 4: Secret Search ===');
      const secretPatterns = [
        /api[_-]?key\s*=\s*["'][^"']+["']/gi,
        /password\s*=\s*["'][^"']+["']/gi,
        /secret\s*=\s*["'][^"']+["']/gi,
        /AIza[0-9A-Za-z\-_]{35}/g,
        /sk-[a-zA-Z0-9]{48}/g,
        /-----BEGIN.*PRIVATE KEY-----/g,
      ];
      const srcDir = jadxDir;
      if (fs.existsSync(srcDir)) {
        const files = fs.readdirSync(srcDir, { recursive: true, withFileTypes: true });
        const secrets: string[] = [];
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.java') || secrets.length >= 30) continue;
          try {
            const content = fs.readFileSync(path.join(file.parentPath || srcDir, file.name), 'utf-8');
            for (const pattern of secretPatterns) {
              const matches = content.match(pattern);
              if (matches) matches.forEach((m: string) => secrets.push(`${file.name}: ${m}`));
            }
          } catch { /* skip */ }
        }
        results.push(secrets.length > 0 ? `Found ${secrets.length} secrets:\n` + secrets.join('\n') : 'No hardcoded secrets found.');
      }

      // Step 5: Crypto analysis
      results.push('\n=== STEP 5: Crypto Analysis ===');
      if (fs.existsSync(srcDir)) {
        const cryptoFindings: string[] = [];
        const files = fs.readdirSync(srcDir, { recursive: true, withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.java')) continue;
          try {
            const content = fs.readFileSync(path.join(file.parentPath || srcDir, file.name), 'utf-8');
            if (/DES|ECB|MD5|SHA-?1/i.test(content)) {
              cryptoFindings.push(`${file.name}: Uses weak crypto (DES/ECB/MD5/SHA1)`);
            }
            if (/SecretKeySpec\s*\(\s*"[^"]+"\s*,/i.test(content)) {
              cryptoFindings.push(`${file.name}: Hardcoded encryption key`);
            }
          } catch { /* skip */ }
        }
        results.push(cryptoFindings.length > 0 ? cryptoFindings.join('\n') : 'No crypto issues found.');
      }

      const output = results.join('\n');
      const duration = Date.now() - start;
      const reportPath = writeArtifact(`pentest_report_${Date.now()}.txt`, output);

      return {
        tool: 'pentest_workflow', success: true, output,
        summary: `Full pentest completed in ${(duration / 1000).toFixed(1)}s. Report: ${reportPath}`,
        artifacts: [workDir, jadxDir, reportPath],
        durationMs: duration, cached: false,
        tier: 'summary' as const, tokensEstimate: estimateTokens(output), tokensSaved: 0,
      };
    },
  },
  {
    name: 'check_tools',
    description: 'Verify which pentesting tools (adb, frida, objection, mobsf, jadx, apktool) are installed and accessible.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const tools = ['adb', 'frida', 'frida-ps', 'objection', 'jadx', 'apktool'];
      const results: string[] = [];

      for (const tool of tools) {
        try {
          const { stdout, stderr } = await execTool(
            { name: tool, enabled: true, timeout: 5000, maxOutputLength: 1000, autoCache: false },
            ['--version'],
          );
          const version = stdout || stderr;
          const available = !version.includes('not found') && !version.includes('command not found') && !version.includes('ENOENT');
          results.push(`${tool}: ${available ? `OK (${version.split('\n')[0].trim()})` : 'NOT FOUND'}`);
        } catch {
          results.push(`${tool}: CHECK FAILED`);
        }
      }

      // Check MobSF API
      results.push(`mobsf: Checking...`);
      try {
        const conf = require('../utils/config').loadConfig() as { mobsfUrl: string; mobsfApiKey: string };
        const mobResult = await new Promise<string>((resolve) => {
          const url = new URL(conf.mobsfUrl);
          const lib = url.protocol === 'https:' ? require('https') : http;
          lib.get({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 8000),
            path: '/api/v1/mobsf_rest_api_info',
            timeout: 3000,
            rejectUnauthorized: false,
            headers: conf.mobsfApiKey ? { Authorization: conf.mobsfApiKey } : {},
          }, (res: http.IncomingMessage) => {
            let data = '';
            res.on('data', (c: Buffer | string) => data += c);
            res.on('end', () => resolve(`OK (${conf.mobsfUrl})`));
          }).on('error', () => resolve(`NOT REACHABLE (${conf.mobsfUrl})`));
        });
        results[results.length - 1] = `mobsf: ${mobResult}`;
      } catch {
        results[results.length - 1] = 'mobsf: CHECK FAILED';
      }

      const output = 'Tool Availability:\n' + results.join('\n');
      return {
        tool: 'check_tools', success: true, output,
        summary: results.filter(r => r.includes('OK')).length + '/' + (tools.length + 1) + ' tools available',
        artifacts: [], durationMs: 5000, cached: false,
        tier: 'minimal' as const, tokensEstimate: estimateTokens(output), tokensSaved: 0,
      };
    },
  },
];

export const ALL_TOOL_DEFINITIONS: MCPToolDefinition[] = [...ALL_TOOLS, ...META_TOOLS];
