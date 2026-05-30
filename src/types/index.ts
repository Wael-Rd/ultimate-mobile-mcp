// ─── Mobile Pentest MCP — Type Definitions ────────────────────────────────────

export interface ToolConfig {
  name: string;
  enabled: boolean;
  binPath?: string;          // Override binary path
  timeout: number;           // ms
  maxOutputLength: number;   // chars before truncation
  autoCache: boolean;
  env?: Record<string, string>;
}

export interface SessionConfig {
  sessionId: string;
  targetApk?: string;
  targetPackage?: string;
  deviceId?: string;
  platform: 'android' | 'ios' | 'both';
  createdAt: number;
}

export type OutputTier = 'minimal' | 'summary' | 'full';

export interface TokenUsageRecord {
  sessionId: string;
  toolName: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  tier: OutputTier;
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  hitCount: number;
  sizeBytes: number;
  tier: OutputTier;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  summary: string;
  artifacts: string[];       // paths to generated files
  durationMs: number;
  cached: boolean;
  tier: OutputTier;
  tokensEstimate: number;
  tokensSaved: number;
}

export interface DiffResult {
  tool: string;
  previousHash: string;
  currentHash: string;
  added: string[];
  removed: string[];
  changed: string[];
  output: string;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface TokenOptimizerConfig {
  enabled: boolean;
  maxCacheSize: number;           // MB
  defaultTier: OutputTier;
  enableDiffing: boolean;
  enableCompression: boolean;
  enableSummaries: boolean;
  aggressiveTruncation: boolean;
  maxArtifactLines: number;
  summaryMaxLines: number;
}
