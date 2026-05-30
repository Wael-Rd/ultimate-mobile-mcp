#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Pentest MCP — Unified Mobile Security Testing Server
// ═══════════════════════════════════════════════════════════════════════════════
//
// Integrates: ADB, Frida, Objection, MobSF, JADX, APKTool
// Features:   Token optimization (6-layer pipeline), caching, diffing,
//             smart summarization, artifact offloading
//
// Usage:
//   npx mobile-pentest-mcp                  (stdio transport — for Claude Desktop / Cursor)
//   MOBSF_URL=http://... MOBSF_API_KEY=... npx mobile-pentest-mcp
//
// Claude Desktop config (~/.claude/claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "mobile-pentest": {
//         "command": "node",
//         "args": ["/path/to/mobile-pentest-mcp/dist/index.js"]
//       }
//     }
//   }
//
// Gemini CLI config:
//   Add to your Gemini CLI MCP settings similarly.
// ═══════════════════════════════════════════════════════════════════════════════

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './utils/logger';
import { loadConfig, ensureArtifactsDir } from './utils/config';
import { initOptimizer, optimize, checkCache, storeCache } from './optimizer';
import { ALL_TOOL_DEFINITIONS } from './tools/index.js';
import type { ToolResult, OutputTier } from './types';

// ─── Banner ───────────────────────────────────────────────────────────────────
const BANNER = `
╔══════════════════════════════════════════════════════════════════╗
║          🔥 MOBILE PENTEST MCP — v2.0.0 🔥                   ║
║  ADB · Frida · Objection · MobSF · JADX · APKTool             ║
║  6-Layer Token Optimization Engine Active                       ║
║  Works with: Claude Desktop, Gemini CLI, Cursor, Windsurf      ║
╚══════════════════════════════════════════════════════════════════╝
`.trim();

// ─── Initialize ───────────────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  ensureArtifactsDir();

  // Initialize token optimizer
  initOptimizer(config.optimizer);

  logger.info(BANNER);
  logger.info(`Config loaded. ${ALL_TOOL_DEFINITIONS.length} tools registered.`);

  // ─── Create Low-Level MCP Server ──────────────────────────────────────────
  const server = new Server(
    {
      name: 'mobile-pentest-mcp',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );

  // ─── Register Tools Request Handler ─────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOL_DEFINITIONS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  // ─── Register Tool Call Request Handler ──────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const toolDef = ALL_TOOL_DEFINITIONS.find((t) => t.name === name);
    if (!toolDef) {
      throw new Error(`Tool not found: ${name}`);
    }

    const startTime = Date.now();

    // Determine requested output tier
    const tier = (args.__tier as OutputTier) || config.optimizer.defaultTier;
    const cleanArgs = { ...args };
    delete cleanArgs.__tier; // Don't pass to actual tool

    // Layer 1: Check cache
    const cached = checkCache(toolDef.name, Object.values(cleanArgs));
    if (cached) {
      logger.info({ tool: toolDef.name }, 'Returning cached result');
      return {
        content: [{
          type: 'text' as const,
          text: formatResult({
            ...cached,
            output: `⚡ CACHED (${cached.durationMs}ms original) — ${cached.output}`,
          }),
        }],
      };
    }

    // Execute tool
    logger.info({ tool: toolDef.name, args: Object.keys(cleanArgs) }, 'Executing tool');
    let result: ToolResult;
    try {
      result = await toolDef.handler(cleanArgs);
    } catch (err: any) {
      result = {
        tool: toolDef.name,
        success: false,
        output: `Tool execution error: ${err.message}\n${err.stack?.slice(0, 500) || ''}`,
        summary: `Error: ${err.message}`,
        artifacts: [],
        durationMs: Date.now() - startTime,
        cached: false,
        tier: 'minimal',
        tokensEstimate: 0,
        tokensSaved: 0,
      };
    }

    // Run through optimization pipeline
    const optimized = optimize(result, toolDef.name, Object.values(cleanArgs), tier);

    // Store in cache
    if (config.tools[toolDef.name.split('_')[0]]?.autoCache !== false) {
      storeCache(toolDef.name, Object.values(cleanArgs), optimized);
    }

    const formatted = formatResult(optimized);
    logger.info({
      tool: toolDef.name,
      duration: optimized.durationMs,
      tokens: optimized.tokensEstimate,
      saved: optimized.tokensSaved,
      success: optimized.success,
    }, 'Tool completed');

    return {
      content: [{ type: 'text' as const, text: formatted }],
    };
  });

  // ─── Register Prompts Request Handler ───────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: 'pentest-checklist',
          description: 'Get a structured mobile app pentest checklist with MCP tool commands',
        },
      ],
    };
  });

  // ─── Register Get Prompt Handler ────────────────────────────────────────────
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    if (name !== 'pentest-checklist') {
      throw new Error(`Prompt not found: ${name}`);
    }

    const checklist = `# Mobile App Pentest Checklist — Mobile Pentest MCP

## Phase 1: Reconnaissance
1. \`check_tools\` — Verify all tools are installed
2. \`adb_devices\` — List connected devices
3. \`adb_list_packages\` — Enumerate installed apps
4. \`pentest_workflow\` — Run full automated scan on APK

## Phase 2: Static Analysis
5. \`apktool_decode\` — Decode APK structure
6. \`apktool_read_manifest\` — Analyze manifest
7. \`jadx_search_secrets\` — Find hardcoded credentials
8. \`jadx_search_crypto\` — Analyze crypto implementation
9. \`jadx_search_urls\` — Extract API endpoints
10. \`mobsf_upload\` → \`mobsf_scan\` — MobSF analysis

## Phase 3: Dynamic Analysis
11. \`adb_install\` — Install target APK
12. \`frida_spawn\` — Spawn with Frida attached
13. \`frida_hook_ssl_pinning\` — Bypass SSL pinning
14. \`frida_hook_crypto\` — Intercept crypto operations
15. \`frida_hook_root_detection\` — Bypass root detection
16. \`frida_hook_intent\` — Log intent communications
17. \`frida_hook_shared_prefs\` — Monitor SharedPreferences
18. \`objection_sslpinning_disable\` — Objection SSL bypass
19. \`objection_dump_keys\` — Extract keystore keys

## Phase 4: Advanced
20. \`frida_dump_ui\` — Dump UI hierarchy
21. \`frida_enum_classes\` — Enumerate classes
22. \`objection_search_classes\` — Search classes at runtime
23. \`apktool_patch_and_rebuild\` — Patch and rebuild APK
24. \`adb_logcat\` — Capture security-relevant logs

## Phase 5: Reporting
25. \`mobsf_pdf_report\` — Download PDF report
26. \`mobsf_report_json\` — Get JSON findings
27. \`token_stats\` — View token optimization stats

Use \`__tier\`: "minimal" | "summary" | "full" in any tool call to control output verbosity.`;

    return {
      messages: [{ role: 'user', content: { type: 'text', text: checklist } }],
    };
  });

  // ─── Register Resources Request Handler ─────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'mcp://mobile-pentest/tools',
          name: 'Tools',
          description: 'List all available pentesting tools organized by category',
          mimeType: 'text/plain',
        },
      ],
    };
  });

  // ─── Register Read Resource Handler ─────────────────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri !== 'mcp://mobile-pentest/tools') {
      throw new Error(`Resource not found: ${uri}`);
    }

    const categories: Record<string, string[]> = {};
    for (const t of ALL_TOOL_DEFINITIONS) {
      const prefix = t.name.split('_')[0];
      if (!categories[prefix]) categories[prefix] = [];
      categories[prefix].push(`${t.name}: ${t.description}`);
    }
    const output = Object.entries(categories)
      .map(([cat, tools]) => `## ${cat.toUpperCase()}\n${tools.map(t => `- ${t}`).join('\n')}`)
      .join('\n\n');

    return {
      contents: [{ uri: 'mcp://mobile-pentest/tools', mimeType: 'text/plain', text: output }],
    };
  });

  // ─── Start server ─────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(BANNER);
  logger.info(`${ALL_TOOL_DEFINITIONS.length} tools ready. Listening on stdio.`);
  logger.info('Token optimization: ENABLED (6-layer pipeline)');
  logger.info('Compatible with: Claude Desktop, Gemini CLI, Cursor, Windsurf, Antigravity');
}

// ─── Format result for LLM ───────────────────────────────────────────────────
function formatResult(result: ToolResult): string {
  const parts: string[] = [];

  parts.push(`═══ ${result.tool.toUpperCase()} ═══`);
  parts.push(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  parts.push(`Time: ${result.durationMs}ms`);
  parts.push(`Tokens: ~${result.tokensEstimate} (saved: ~${result.tokensSaved})`);
  if (result.cached) parts.push('⚡ Result from cache');

  parts.push('\n── Summary ──');
  parts.push(result.summary);

  if (result.artifacts.length > 0) {
    parts.push('\n── Artifacts ──');
    result.artifacts.forEach(a => parts.push(`📁 ${a}`));
  }

  parts.push('\n── Full Output ──');
  parts.push(result.output);

  return parts.join('\n');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
main().catch((err) => {
  logger.fatal(err, 'Server crashed');
  process.exit(1);
});
