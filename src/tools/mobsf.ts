// ─── MobSF Tool Wrapper ───────────────────────────────────────────────────────
// Mobile Security Framework integration via REST API.
// Upload APK for static analysis, start dynamic instrumentation,
// and retrieve comprehensive security reports.

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { generateSummary, estimateTokens, writeArtifact } from '../utils/helpers';
import { TOOL_DEFAULTS, loadConfig, ensureArtifactsDir } from '../utils/config';
import { logger } from '../utils/logger';
import type { MCPToolDefinition, ToolResult } from '../types';

const cfg = () => TOOL_DEFAULTS.mobsf;

function wrap(name: string, desc: string, schema: Record<string, unknown>, required: string[] = [],
  handler: (args: any) => Promise<ToolResult>): MCPToolDefinition {
  return {
    name: `mobsf_${name}`,
    description: desc,
    inputSchema: { type: 'object' as const, properties: schema, required },
    handler,
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function apiRequest(
  method: string,
  urlPath: string,
  body?: any,
  apiKey?: string,
): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const conf = loadConfig();
    const baseUrl = new URL(urlPath, conf.mobsfUrl);
    const isHttps = baseUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (apiKey || conf.mobsfApiKey) {
      headers['Authorization'] = apiKey || conf.mobsfApiKey;
    }
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const req = lib.request(
      {
        hostname: baseUrl.hostname,
        port: baseUrl.port || (isHttps ? 443 : 8000),
        path: baseUrl.pathname + baseUrl.search,
        method,
        headers,
        rejectUnauthorized: false, // MobSF often uses self-signed certs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode || 200, data: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode || 200, data });
          }
        });
      },
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Multipart upload ─────────────────────────────────────────────────────────
function uploadFile(filePath: string, urlPath: string, apiKey?: string): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const conf = loadConfig();
    const baseUrl = new URL(urlPath, conf.mobsfUrl);
    const isHttps = baseUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const boundary = '----MobilePentestMCP' + Date.now();
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const headers: Record<string, string> = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': multipartBody.length.toString(),
    };
    if (apiKey || conf.mobsfApiKey) {
      headers['Authorization'] = apiKey || conf.mobsfApiKey;
    }

    const req = lib.request(
      {
        hostname: baseUrl.hostname,
        port: baseUrl.port || (isHttps ? 443 : 8000),
        path: baseUrl.pathname,
        method: 'POST',
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode || 200, data: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode || 200, data });
          }
        });
      },
    );

    req.on('error', reject);
    req.write(multipartBody);
    req.end();
  });
}

// ─── Smart report extraction ──────────────────────────────────────────────────
function extractSecurityFindings(report: any): string {
  const findings: string[] = [];

  if (report.findings) {
    for (const [key, value] of Object.entries(report.findings)) {
      findings.push(`[${key}] ${JSON.stringify(value)}`);
    }
  }

  // Extract security-relevant sections from full MobSF report
  const relevantKeys = [
    'androidhardening', 'network_security', 'certificate_analysis',
    'manifest_analysis', 'code_analysis', 'malware_analysis',
    'file_analysis', 'binary_analysis', 'secrets',
    'insecure_cryptography', 'root_detection', 'ssl_pinning',
    'data_storage', 'exported_components', 'permissions',
  ];

  for (const key of relevantKeys) {
    if (report[key]) {
      findings.push(`\n=== ${key} ===`);
      const section = report[key];
      if (typeof section === 'object') {
        for (const [k, v] of Object.entries(section)) {
          if (typeof v === 'string' && v.length < 500) {
            findings.push(`  ${k}: ${v}`);
          } else if (Array.isArray(v)) {
            findings.push(`  ${k}: ${v.join(', ')}`);
          }
        }
      } else {
        findings.push(String(section));
      }
    }
  }

  return findings.length > 0 ? findings.join('\n') : JSON.stringify(report, null, 2).slice(0, 5000);
}

function mobsfResult(tool: string, report: any, duration: number): ToolResult {
  const output = extractSecurityFindings(report);
  return {
    tool,
    success: true,
    output,
    summary: generateSummary(output, tool),
    artifacts: [],
    durationMs: duration,
    cached: false,
    tier: 'summary',
    tokensEstimate: estimateTokens(output),
    tokensSaved: 0,
  };
}

export const mobsfTools: MCPToolDefinition[] = [
  wrap('upload', 'Upload APK/IPA for analysis', {
    file_path: { type: 'string', description: 'Path to APK or IPA file' },
  }, ['file_path'], async ({ file_path }) => {
    const start = Date.now();
    logger.info({ file_path }, 'Uploading to MobSF');

    const { statusCode, data } = await uploadFile(file_path, '/api/v1/upload');
    const duration = Date.now() - start;

    if (statusCode !== 200) {
      return {
        tool: 'mobsf_upload', success: false,
        output: `MobSF upload failed (HTTP ${statusCode}): ${JSON.stringify(data)}`,
        summary: 'Upload failed', artifacts: [], durationMs: duration,
        cached: false, tier: 'minimal',
        tokensEstimate: estimateTokens(JSON.stringify(data)), tokensSaved: 0,
      };
    }

    const artifactPath = writeArtifact(`mobsf_upload_${Date.now()}.json`, JSON.stringify(data, null, 2));
    return mobsfResult('mobsf_upload', data, duration);
  }),

  wrap('scan', 'Start static analysis scan', {
    hash: { type: 'string', description: 'Scan hash from upload response' },
    scan_type: { type: 'string', description: 'apk or ipa', enum: ['apk', 'ipa'] },
  }, ['hash', 'scan_type'], async ({ hash, scan_type }) => {
    const start = Date.now();
    const { data } = await apiRequest('POST', `/api/v1/scan`, { hash, scan_type });

    const artifactPath = writeArtifact(`mobsf_scan_${hash}.json`, JSON.stringify(data, null, 2));
    const duration = Date.now() - start;
    return mobsfResult('mobsf_scan', data, duration);
  }),

  wrap('report_json', 'Get full JSON report for a scan', {
    hash: { type: 'string', description: 'Scan hash' },
  }, ['hash'], async ({ hash }) => {
    const start = Date.now();
    const { data } = await apiRequest('POST', `/api/v1/report_json`, { hash });

    const artifactPath = writeArtifact(`mobsf_report_${hash}.json`, JSON.stringify(data, null, 2));
    const output = extractSecurityFindings(data);
    const duration = Date.now() - start;

    return {
      tool: 'mobsf_report_json',
      success: true,
      output: output.slice(0, 20000) + `\n\n[Full report saved to: ${artifactPath}]`,
      summary: generateSummary(output, 'mobsf_report'),
      artifacts: [artifactPath],
      durationMs: duration,
      cached: false,
      tier: 'summary',
      tokensEstimate: estimateTokens(output),
      tokensSaved: estimateTokens(JSON.stringify(data)) - estimateTokens(output),
    };
  }),

  wrap('pdf_report', 'Download PDF report', {
    hash: { type: 'string', description: 'Scan hash' },
  }, ['hash'], async ({ hash }) => {
    const start = Date.now();
    const conf = loadConfig();
    const reportUrl = `${conf.mobsfUrl}/api/v1/download_pdf?hash=${hash}`;

    return new Promise((resolve) => {
      const url = new URL(reportUrl);
      const lib = url.protocol === 'https:' ? https : http;
      const filePath = path.join(ensureArtifactsDir(), `mobsf_report_${hash}.pdf`);

      lib.get({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 8000),
        path: url.pathname + url.search,
        headers: { Authorization: conf.mobsfApiKey },
        rejectUnauthorized: false,
      }, (res) => {
        const ws = fs.createWriteStream(filePath);
        res.pipe(ws);
        ws.on('finish', () => {
          resolve({
            tool: 'mobsf_pdf_report',
            success: true,
            output: `PDF report downloaded to: ${filePath}`,
            summary: `PDF report: ${filePath}`,
            artifacts: [filePath],
            durationMs: Date.now() - start,
            cached: false,
            tier: 'minimal',
            tokensEstimate: 20,
            tokensSaved: 0,
          });
        });
      });
    });
  }),

  wrap('dynamic_start', 'Start MobSF dynamic instrumentation (Android)', {
    hash: { type: 'string', description: 'Scan hash' },
    package: { type: 'string', description: 'Package name' },
    serial: { type: 'string', description: 'ADB device serial' },
  }, ['hash', 'package'], async ({ hash, package: pkg, serial }) => {
    const start = Date.now();
    const { data } = await apiRequest('POST', `/api/v1/dynamic/start_dynamic_analysis`, {
      hash,
      package: pkg,
      serialno: serial,
    });

    const artifactPath = writeArtifact(`mobsf_dynamic_${hash}.json`, JSON.stringify(data, null, 2));
    const duration = Date.now() - start;
    return mobsfResult('mobsf_dynamic_start', data, duration);
  }),

  wrap('dynamic_stop', 'Stop MobSF dynamic analysis and collect results', {
    hash: { type: 'string', description: 'Scan hash' },
    package: { type: 'string', description: 'Package name' },
  }, ['hash', 'package'], async ({ hash, package: pkg }) => {
    const start = Date.now();
    const { data } = await apiRequest('POST', `/api/v1/dynamic/stop_dynamic_analysis`, {
      hash,
      package: pkg,
    });

    const artifactPath = writeArtifact(`mobsf_dynamic_result_${hash}.json`, JSON.stringify(data, null, 2));
    const duration = Date.now() - start;
    return mobsfResult('mobsf_dynamic_stop', data, duration);
  }),

  wrap('frida_logs', 'Get Frida instrumentation logs from MobSF', {
    hash: { type: 'string', description: 'Scan hash' },
  }, ['hash'], async ({ hash }) => {
    const start = Date.now();
    const { data } = await apiRequest('POST', `/api/v1/dynamic/frida_logs`, { hash });
    const duration = Date.now() - start;
    return mobsfResult('mobsf_frida_logs', data, duration);
  }),

  wrap('recent_scans', 'List all recent MobSF scans', {}, [], async () => {
    const start = Date.now();
    const { data } = await apiRequest('GET', '/api/v1/recent_scans');
    const duration = Date.now() - start;
    return mobsfResult('mobsf_recent_scans', data, duration);
  }),

  wrap('delete_scan', 'Delete a scan and its data', {
    hash: { type: 'string', description: 'Scan hash to delete' },
  }, ['hash'], async ({ hash }) => {
    const start = Date.now();
    const { data } = await apiRequest('POST', `/api/v1/delete_scan`, { hash });
    const duration = Date.now() - start;
    return mobsfResult('mobsf_delete_scan', data, duration);
  }),

  wrap('api_info', 'Get MobSF API info and version', {}, [], async () => {
    const start = Date.now();
    const { data } = await apiRequest('GET', '/api/v1/mobsf_rest_api_info');
    const duration = Date.now() - start;
    return mobsfResult('mobsf_api_info', data, duration);
  }),
];
