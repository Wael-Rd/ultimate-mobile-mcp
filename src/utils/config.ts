// ─── Configuration ─────────────────────────────────────────────────────────────
import * as path from 'path';
import * as fs from 'fs';
import type { ToolConfig, TokenOptimizerConfig, OutputTier } from '../types';

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const XDG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

export const CONFIG_DIR = path.join(XDG, 'mobile-pentest-mcp');
export const CACHE_DIR = path.join(CONFIG_DIR, 'cache');
export const ARTIFACTS_DIR = path.join(CONFIG_DIR, 'artifacts');
export const DB_PATH = path.join(CONFIG_DIR, 'sessions.db');

// ─── Tool Defaults ────────────────────────────────────────────────────────────
export const TOOL_DEFAULTS: Record<string, ToolConfig> = {
  adb: {
    name: 'adb',
    enabled: true,
    timeout: 30000,
    maxOutputLength: 50000,
    autoCache: true,
  },
  frida: {
    name: 'frida',
    enabled: true,
    timeout: 60000,
    maxOutputLength: 100000,
    autoCache: true,
  },
  objection: {
    name: 'objection',
    enabled: true,
    timeout: 60000,
    maxOutputLength: 100000,
    autoCache: true,
  },
  mobsf: {
    name: 'mobsf',
    enabled: true,
    timeout: 120000,
    maxOutputLength: 200000,
    autoCache: true,
    env: { MOBSF_API_KEY: '' },
  },
  jadx: {
    name: 'jadx',
    enabled: true,
    timeout: 120000,
    maxOutputLength: 200000,
    autoCache: true,
  },
  apktool: {
    name: 'apktool',
    enabled: true,
    timeout: 60000,
    maxOutputLength: 100000,
    autoCache: true,
  },
};

// ─── Token Optimizer Defaults ─────────────────────────────────────────────────
export const OPTIMIZER_DEFAULTS: TokenOptimizerConfig = {
  enabled: true,
  maxCacheSize: 256,
  defaultTier: 'summary',
  enableDiffing: true,
  enableCompression: true,
  enableSummaries: true,
  aggressiveTruncation: true,
  maxArtifactLines: 500,
  summaryMaxLines: 50,
};

// ─── Load config from disk ────────────────────────────────────────────────────
export function loadConfig(): {
  tools: Record<string, ToolConfig>;
  optimizer: TokenOptimizerConfig;
  mobsfUrl: string;
  mobsfApiKey: string;
} {
  const cfgPath = path.join(CONFIG_DIR, 'config.json');

  if (!fs.existsSync(cfgPath)) {
    // Ensure directories exist
    for (const dir of [CONFIG_DIR, CACHE_DIR, ARTIFACTS_DIR]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Write defaults
    const defaults = {
      tools: TOOL_DEFAULTS,
      optimizer: OPTIMIZER_DEFAULTS,
      mobsfUrl: process.env.MOBSF_URL || 'http://127.0.0.1:8000',
      mobsfApiKey: process.env.MOBSF_API_KEY || '',
    };
    fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  return {
    tools: { ...TOOL_DEFAULTS, ...raw.tools },
    optimizer: { ...OPTIMIZER_DEFAULTS, ...raw.optimizer },
    mobsfUrl: raw.mobsfUrl || process.env.MOBSF_URL || 'http://127.0.0.1:8000',
    mobsfApiKey: raw.mobsfApiKey || process.env.MOBSF_API_KEY || '',
  };
}

// ─── Ensure artifact dir exists ───────────────────────────────────────────────
export function ensureArtifactsDir(): string {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return ARTIFACTS_DIR;
}
