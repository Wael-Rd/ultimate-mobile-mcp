// ─── Helpers ───────────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import execa from 'execa';
import hasha from 'hasha';
import type { ToolConfig, ToolResult } from '../types';
import { logger } from './logger';
import { ensureArtifactsDir } from './config';

/**
 * Execute a CLI tool and return structured ToolResult.
 */
export async function execTool(
  config: ToolConfig,
  args: string[],
  input?: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; duration: number }> {
  const bin = config.binPath || config.name;
  const start = Date.now();

  logger.info({ tool: config.name, args, cwd }, `Executing: ${bin} ${args.join(' ')}`);

  try {
    const result = await execa(bin, args, {
      timeout: config.timeout,
      cwd,
      input,
      env: { ...process.env, ...config.env } as Record<string, string>,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      reject: false,                // Don't throw on non-zero exit
    });

    const duration = Date.now() - start;
    logger.info({ tool: config.name, duration, exitCode: result.exitCode }, 'Command finished');

    return {
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
      duration,
    };
  } catch (err: any) {
    const duration = Date.now() - start;
    logger.error({ tool: config.name, err: err.message, duration }, 'Command failed');
    return {
      stdout: '',
      stderr: err.message || String(err),
      duration,
    };
  }
}

/**
 * Generate a deterministic cache key from tool name + arguments.
 */
export async function makeCacheKey(tool: string, args: unknown[]): Promise<string> {
  const payload = JSON.stringify({ tool, args });
  return (await hasha(payload, { algorithm: 'sha256' })).slice(0, 24);
}

/**
 * Estimate token count (rough: ~4 chars per token for English, ~2 chars for CJK).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Truncate text to a maximum length, preserving line boundaries.
 */
export function smartTruncate(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) return { text, truncated: false };

  const lines = text.split('\n');
  let out = '';
  let total = 0;

  for (const line of lines) {
    if (total + line.length + 1 > maxLength) break;
    out += line + '\n';
    total += line.length + 1;
  }

  const remaining = lines.length - out.split('\n').length;
  return {
    text: out + `\n\n[... ${remaining} more lines truncated ...]`,
    truncated: true,
  };
}

/**
 * Generate a quick summary of tool output.
 */
export function generateSummary(output: string, tool: string): string {
  if (!output || output.length < 200) return output;

  const lines = output.split('\n').filter(l => l.trim());
  const importantLines: string[] = [];
  const patterns = [
    /error|fail|vulnerab|insecure|warning|critical/i,
    /found|detect|success|match/i,
    /permission|intent|exported|debuggable/i,
    /secret|key|token|password|api.key/i,
    /certificate|ssl|tls|https/i,
    /root|frida|hook|bypass/i,
  ];

  for (const line of lines) {
    if (patterns.some(p => p.test(line))) {
      importantLines.push(line.trim());
    }
    if (importantLines.length >= 30) break;
  }

  if (importantLines.length > 0) {
    return `Key findings (${importantLines.length} items):\n` + importantLines.join('\n');
  }

  // Fallback: first 10 + last 5 lines
  const head = lines.slice(0, 10).join('\n');
  const tail = lines.length > 15 ? '\n...\n' + lines.slice(-5).join('\n') : '';
  return `Output preview:\n${head}${tail}`;
}

/**
 * Write an artifact file (output from tools that's too large for inline).
 */
export function writeArtifact(filename: string, content: string): string {
  const dir = ensureArtifactsDir();
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}
