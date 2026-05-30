// ─── Objection Tool Wrapper ───────────────────────────────────────────────────
// Runtime exploration via objection: bypass SSL, dump keys, navigate app,
// interact with activities, services, and the filesystem on rooted devices.

import { execTool, generateSummary, estimateTokens, writeArtifact } from '../utils/helpers';
import { TOOL_DEFAULTS, ensureArtifactsDir } from '../utils/config';
import type { MCPToolDefinition, ToolResult } from '../types';

const cfg = () => ({ ...TOOL_DEFAULTS.objection, timeout: 90000 });

function wrap(name: string, desc: string, schema: Record<string, unknown>, required: string[] = [],
  handler: (args: any) => Promise<ToolResult>): MCPToolDefinition {
  return {
    name: `objection_${name}`,
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

export const objectionTools: MCPToolDefinition[] = [
  // ─── Exploration ─────────────────────────────────────────────────────────
  wrap('explore', 'Start an objection explore session (interactive commands)', {
    package: { type: 'string', description: 'Package name to explore' },
    command: { type: 'string', description: 'Objection command to run (e.g. "env", "ls")' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package', 'command'], async ({ package: pkg, command, device }) => {
    const args: string[] = ['-g', pkg, 'explore', command];
    if (device) args.unshift('-s', device);
    // objection commands are space-separated
    const fullArgs = ['-g', pkg, 'explore', ...(command ? String(command).split(' ') : [])];
    const { stdout, stderr, duration } = await execTool(cfg(), fullArgs);
    return result('objection_explore', stdout, stderr, duration);
  }),

  // ─── SSL Bypass ──────────────────────────────────────────────────────────
  wrap('sslpinning_disable', 'Disable SSL pinning via objection', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'sslpinning', 'disable'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_ssl_bypass', stdout, stderr, duration);
  }),

  // ─── Key & Certificate Dump ──────────────────────────────────────────────
  wrap('dump_keys', 'Dump keystore/keys from app', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'keystore', 'list'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_dump_keys', stdout, stderr, duration);
  }),

  // ─── Activities ──────────────────────────────────────────────────────────
  wrap('list_activities', 'List all activities via objection', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'hooking', 'list', 'activities'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_list_activities', stdout, stderr, duration);
  }),

  wrap('list_services', 'List all services', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'hooking', 'list', 'services'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_list_services', stdout, stderr, duration);
  }),

  wrap('list_receivers', 'List broadcast receivers', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'hooking', 'list', 'receivers'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_list_receivers', stdout, stderr, duration);
  }),

  // ─── Class & Method Search ───────────────────────────────────────────────
  wrap('search_classes', 'Search for classes by name pattern', {
    package: { type: 'string', description: 'Package name' },
    pattern: { type: 'string', description: 'Class name pattern (e.g. "*crypto*")' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package', 'pattern'], async ({ package: pkg, pattern, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'hooking', 'search', 'classes', pattern];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_search_classes', stdout, stderr, duration);
  }),

  wrap('list_class_methods', 'List all methods in a class', {
    package: { type: 'string', description: 'Package name' },
    class_name: { type: 'string', description: 'Fully qualified class name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package', 'class_name'], async ({ package: pkg, class_name, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'hooking', 'list', 'class_methods', class_name];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_list_class_methods', stdout, stderr, duration);
  }),

  // ─── File System ─────────────────────────────────────────────────────────
  wrap('ls', 'List directory contents in app sandbox', {
    package: { type: 'string', description: 'Package name' },
    path: { type: 'string', description: 'Directory path (default: /)' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, path = '/', device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'ls', path];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_ls', stdout, stderr, duration);
  }),

  wrap('cat', 'Read a file from app sandbox', {
    package: { type: 'string', description: 'Package name' },
    path: { type: 'string', description: 'File path to read' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package', 'path'], async ({ package: pkg, path, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'file', 'download', path];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_cat', stdout, stderr, duration);
  }),

  wrap('download', 'Download a file from app to host', {
    package: { type: 'string', description: 'Package name' },
    remote_path: { type: 'string', description: 'Remote file path' },
    local_path: { type: 'string', description: 'Local save path' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package', 'remote_path'], async ({ package: pkg, remote_path, local_path, device }) => {
    const savePath = local_path || path.join(ensureArtifactsDir(), `objection_${path.basename(remote_path)}_${Date.now()}`);
    const args: string[] = ['-g', pkg, 'explore', 'file', 'download', remote_path, savePath];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_download', stdout, stderr, duration, [savePath]);
  }),

  // ─── SQLite Database ─────────────────────────────────────────────────────
  wrap('sqlite_dump', 'Dump SQLite database from app', {
    package: { type: 'string', description: 'Package name' },
    db_path: { type: 'string', description: 'Path to SQLite DB in app sandbox' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package', 'db_path'], async ({ package: pkg, db_path, device }) => {
    // objection sqlite: uses "sqlite connect <path>" then "sqlite query <sql>"
    const connectArgs = ['-g', pkg, 'explore', 'sqlite', 'connect', db_path];
    const { stdout: s1, stderr: e1, duration: d1 } = await execTool(cfg(), connectArgs);

    const queryArgs = ['-g', pkg, 'explore', 'sqlite', 'query', 'SELECT * FROM sqlite_master'];
    const { stdout, stderr, duration: d2 } = await execTool(cfg(), queryArgs);

    return result('objection_sqlite_dump', s1 + '\n' + stdout, e1 + '\n' + stderr, d1 + d2);
  }),

  // ─── Environment ─────────────────────────────────────────────────────────
  wrap('env', 'Show app environment info', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'env'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_env', stdout, stderr, duration);
  }),

  wrap('get_root', 'Check if running as root in objection', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'root', 'disable'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_root', stdout, stderr, duration);
  }),

  // ─── Clipboard ───────────────────────────────────────────────────────────
  wrap('clipboard', 'Monitor clipboard changes', {
    package: { type: 'string', description: 'Package name' },
    device: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'android', 'clipboard', 'monitor'];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_clipboard', stdout, stderr, duration);
  }),

  // ─── Plist (iOS) ─────────────────────────────────────────────────────────
  wrap('plist_read', 'Read a plist file (iOS)', {
    package: { type: 'string', description: 'Bundle ID' },
    path: { type: 'string', description: 'Plist file path' },
    device: { type: 'string', description: 'Device UDID' },
  }, ['package', 'path'], async ({ package: pkg, path, device }) => {
    const args: string[] = ['-g', pkg, 'explore', 'plist', 'read', path];
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('objection_plist_read', stdout, stderr, duration);
  }),
];

import * as path from 'path';
