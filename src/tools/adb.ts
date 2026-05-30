// ─── ADB Tool Wrapper ──────────────────────────────────────────────────────────
// Full coverage of ADB commands for device management, app interaction,
// file operations, screenshot, logcat, and security-relevant queries.

import { execTool, generateSummary, estimateTokens, smartTruncate } from '../utils/helpers';
import { TOOL_DEFAULTS, ensureArtifactsDir } from '../utils/config';
import * as path from 'path';
import type { MCPToolDefinition, ToolResult } from '../types';

const cfg = () => TOOL_DEFAULTS.adb;

function wrap(name: string, desc: string, schema: Record<string, unknown>, required: string[] = [],
  handler: (args: any) => Promise<ToolResult>): MCPToolDefinition {
  return {
    name: `adb_${name}`,
    description: desc,
    inputSchema: { type: 'object' as const, properties: schema, required },
    handler,
  };
}

function adbResult(tool: string, stdout: string, stderr: string, duration: number): ToolResult {
  const output = stdout || stderr;
  return {
    tool,
    success: !!stdout || !stderr,
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

export const adbTools: MCPToolDefinition[] = [
  // ─── Device Management ───────────────────────────────────────────────────
  wrap('devices', 'List connected Android devices/emulators', {
    serial: { type: 'string', description: 'Optional: filter by serial number' },
  }, [], async ({ serial }) => {
    const { stdout, stderr, duration } = await execTool(cfg(), serial ? ['-s', serial, 'devices'] : ['devices']);
    return adbResult('adb_devices', stdout, stderr, duration);
  }),

  wrap('install', 'Install APK on device', {
    apk_path: { type: 'string', description: 'Path to APK file' },
    serial: { type: 'string', description: 'Device serial' },
    replace: { type: 'boolean', description: 'Replace existing app (default: true)' },
    downgrade: { type: 'boolean', description: 'Allow downgrade (default: false)' },
  }, ['apk_path'], async ({ apk_path, serial, replace = true, downgrade = false }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    if (replace) args.push('-r');
    if (downgrade) args.push('-d');
    args.push('install', apk_path);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_install', stdout, stderr, duration);
  }),

  wrap('uninstall', 'Uninstall app from device', {
    package: { type: 'string', description: 'Package name' },
    serial: { type: 'string', description: 'Device serial' },
    keep_data: { type: 'boolean', description: 'Keep app data (default: false)' },
  }, ['package'], async ({ package: pkg, serial, keep_data }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    if (keep_data) args.push('-k');
    args.push('uninstall', pkg);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_uninstall', stdout, stderr, duration);
  }),

  // ─── Shell Commands ──────────────────────────────────────────────────────
  wrap('shell', 'Execute arbitrary ADB shell command', {
    command: { type: 'string', description: 'Shell command to execute' },
    serial: { type: 'string', description: 'Device serial' },
    as_root: { type: 'boolean', description: 'Run as root if available (default: false)' },
  }, ['command'], async ({ command, serial, as_root }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell');
    if (as_root) args.push('su', '-c');
    args.push(command);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_shell', stdout, stderr, duration);
  }),

  wrap('dump_package', 'Full package info dump for security analysis', {
    package: { type: 'string', description: 'Package name' },
    serial: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, serial }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'dumpsys', 'package', pkg);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_dump_package', stdout, stderr, duration);
  }),

  // ─── Security-Specific ───────────────────────────────────────────────────
  wrap('list_permissions', 'List all permissions and their grant status', {
    package: { type: 'string', description: 'Package name' },
    serial: { type: 'string', description: 'Device serial' },
    dangerous_only: { type: 'boolean', description: 'Show only dangerous permissions (default: true)' },
  }, ['package'], async ({ package: pkg, serial, dangerous_only = true }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'dumpsys', 'package', pkg);
    const { stdout, stderr, duration } = await execTool(cfg(), args);

    // Extract and filter permissions
    let output = stdout;
    if (dangerous_only && stdout) {
      const lines = stdout.split('\n');
      const permSection = lines.filter((l, i) => {
        return l.includes('dangerous') || (l.includes('permission') && l.includes(pkg));
      }).join('\n');
      output = permSection || 'No dangerous permissions found';
    }

    return {
      ...adbResult('adb_list_permissions', output, stderr, duration),
      output,
      summary: generateSummary(output, 'permissions'),
    };
  }),

  wrap('list_activities', 'List all activities (exported + non-exported)', {
    package: { type: 'string', description: 'Package name' },
    serial: { type: 'string', description: 'Device serial' },
    exported_only: { type: 'boolean', description: 'Show only exported activities (default: false)' },
  }, ['package'], async ({ package: pkg, serial, exported_only }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'dumpsys', 'package', pkg);
    const { stdout, stderr, duration } = await execTool(cfg(), args);

    if (!stdout) return adbResult('adb_list_activities', '', stderr, duration);

    const activities: string[] = [];
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('Activity') && line.includes(pkg)) {
        if (exported_only && !line.includes('exported=true')) continue;
        activities.push(line.trim());
      }
    }

    return adbResult('adb_list_activities', activities.join('\n') || 'No activities found', '', duration);
  }),

  wrap('check_debuggable', 'Check if app is debuggable', {
    package: { type: 'string', description: 'Package name' },
    serial: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, serial }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'run-as', pkg, 'ls');
    const { stdout, stderr, duration } = await execTool(cfg(), args);

    const isDebuggable = !stderr.includes('not debuggable') && !stderr.includes('not installed');
    const output = `Debuggable: ${isDebuggable}\n${stderr ? 'Details: ' + stderr : 'Successfully accessed app data directory'}`;

    return adbResult('adb_check_debuggable', output, '', duration);
  }),

  // ─── File Operations ─────────────────────────────────────────────────────
  wrap('pull', 'Pull file from device to host', {
    remote_path: { type: 'string', description: 'Path on device' },
    local_path: { type: 'string', description: 'Local save path' },
    serial: { type: 'string', description: 'Device serial' },
  }, ['remote_path', 'local_path'], async ({ remote_path, local_path, serial }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('pull', remote_path, local_path);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_pull', stdout, stderr, duration);
  }),

  wrap('push', 'Push file from host to device', {
    local_path: { type: 'string', description: 'Local file path' },
    remote_path: { type: 'string', description: 'Path on device' },
    serial: { type: 'string', description: 'Device serial' },
  }, ['local_path', 'remote_path'], async ({ local_path, remote_path, serial }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('push', local_path, remote_path);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_push', stdout, stderr, duration);
  }),

  // ─── Logcat ──────────────────────────────────────────────────────────────
  wrap('logcat', 'Capture logcat output (with optional filters)', {
    filter: { type: 'string', description: 'Logcat filter expression (e.g. "*:E" for errors only)' },
    serial: { type: 'string', description: 'Device serial' },
    pid: { type: 'number', description: 'Filter by process ID' },
    since: { type: 'string', description: 'Time filter (e.g. "05-21 10:00:00.000")' },
    last_lines: { type: 'number', description: 'Number of recent lines to capture (default: 200)' },
  }, [], async ({ filter, serial, pid, since, last_lines = 200 }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('logcat', '-d'); // dump current buffer
    if (filter) args.push(filter);
    if (pid) args.push('--pid', String(pid));
    if (since) args.push('-t', since);
    else args.push('-t', String(last_lines));
    const { stdout, stderr, duration } = await execTool(cfg(), args);

    // Security-relevant log filtering
    let output = stdout;
    if (stdout) {
      const secLines = stdout.split('\n').filter(l =>
        /error|exception|crash|security|crypto|ssl|tls|root|frida|xposed|magisk|selinux|denied/i.test(l)
      );
      if (secLines.length > 0 && secLines.length < stdout.split('\n').length) {
        output = `=== Security-relevant log lines (${secLines.length}/${stdout.split('\n').length}) ===\n` +
          secLines.join('\n') +
          `\n\n[Use tier=full for complete logcat output]`;
      }
    }

    return adbResult('adb_logcat', output, stderr, duration);
  }),

  // ─── Screenshot & Screen Record ──────────────────────────────────────────
  wrap('screenshot', 'Capture device screenshot', {
    output_path: { type: 'string', description: 'Local save path for PNG' },
    serial: { type: 'string', description: 'Device serial' },
  }, [], async ({ output_path, serial }) => {
    const tmpPath = '/sdcard/screenshot_mcp.png';
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'screencap', '-p', tmpPath);
    const { stdout: s1, stderr: e1, duration: d1 } = await execTool(cfg(), args);

    const savePath = output_path || path.join(ensureArtifactsDir(), `screenshot_${Date.now()}.png`);
    const args2: string[] = [];
    if (serial) args2.push('-s', serial);
    args2.push('pull', tmpPath, savePath);
    const { stdout: s2, stderr: e2, duration: d2 } = await execTool(cfg(), args2);

    return {
      tool: 'adb_screenshot',
      success: !e2,
      output: `Screenshot saved to: ${savePath}`,
      summary: `Screenshot saved to: ${savePath}`,
      artifacts: [savePath],
      durationMs: d1 + d2,
      cached: false,
      tier: 'minimal',
      tokensEstimate: estimateTokens(savePath),
      tokensSaved: 0,
    };
  }),

  // ─── Backup ──────────────────────────────────────────────────────────────
  wrap('backup', 'Create full or partial app backup', {
    package: { type: 'string', description: 'Package name' },
    output_path: { type: 'string', description: 'Local save path for .ab file' },
    serial: { type: 'string', description: 'Device serial' },
    include_shared: { type: 'boolean', description: 'Include shared storage (default: false)' },
  }, ['package'], async ({ package: pkg, serial, output_path, include_shared }) => {
    const flags = include_shared ? '-shared' : '-nosystem';
    const savePath = output_path || path.join(ensureArtifactsDir(), `backup_${pkg}_${Date.now()}.ab`);

    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('backup', '-f', savePath, flags, pkg);
    const { stdout, stderr, duration } = await execTool(cfg(), args, '\n'); // auto-confirm

    return {
      tool: 'adb_backup',
      success: true,
      output: `Backup command issued for ${pkg}. File: ${savePath}`,
      summary: `Backup: ${pkg} → ${savePath}`,
      artifacts: [savePath],
      durationMs: duration,
      cached: false,
      tier: 'minimal',
      tokensEstimate: estimateTokens(savePath),
      tokensSaved: 0,
    };
  }),

  // ─── PM / AM Commands ────────────────────────────────────────────────────
  wrap('list_packages', 'List installed packages', {
    serial: { type: 'string', description: 'Device serial' },
    filter: { type: 'string', description: 'Package name filter substring' },
    third_party_only: { type: 'boolean', description: 'Show only 3rd party apps (default: true)' },
    system_only: { type: 'boolean', description: 'Show only system apps (default: false)' },
  }, [], async ({ serial, filter, third_party_only = true, system_only }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'pm', 'list', 'packages');
    if (third_party_only) args.push('-3');
    if (system_only) args.push('-s');
    if (filter) args.push(filter);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_list_packages', stdout, stderr, duration);
  }),

  wrap('clear_data', 'Clear app data (reset)', {
    package: { type: 'string', description: 'Package name' },
    serial: { type: 'string', description: 'Device serial' },
  }, ['package'], async ({ package: pkg, serial }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'pm', 'clear', pkg);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_clear_data', stdout || 'Data cleared', stderr, duration);
  }),

  wrap('start_activity', 'Start an activity explicitly', {
    component: { type: 'string', description: 'Component name (e.g. com.app/.MainActivity)' },
    serial: { type: 'string', description: 'Device serial' },
    extras: { type: 'string', description: 'Intent extras as JSON string' },
    action: { type: 'string', description: 'Intent action (e.g. android.intent.action.VIEW)' },
    data_uri: { type: 'string', description: 'Intent data URI' },
  }, ['component'], async ({ component, serial, extras, action, data_uri }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'am', 'start');
    if (action) args.push('-a', action);
    if (data_uri) args.push('-d', data_uri);
    if (extras) {
      try {
        const extraObj = JSON.parse(extras);
        for (const [key, value] of Object.entries(extraObj)) {
          args.push('--es', key, String(value));
        }
      } catch { /* ignore parse errors */ }
    }
    args.push('-n', component);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_start_activity', stdout, stderr, duration);
  }),

  wrap('start_service', 'Start a service', {
    component: { type: 'string', description: 'Service component name' },
    serial: { type: 'string', description: 'Device serial' },
    action: { type: 'string', description: 'Intent action' },
  }, ['component'], async ({ component, serial, action }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'am', 'startservice');
    if (action) args.push('-a', action);
    args.push('-n', component);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_start_service', stdout, stderr, duration);
  }),

  wrap('broadcast', 'Send a broadcast intent', {
    action: { type: 'string', description: 'Intent action' },
    component: { type: 'string', description: 'Optional component' },
    extras: { type: 'string', description: 'Intent extras as JSON' },
    serial: { type: 'string', description: 'Device serial' },
  }, ['action'], async ({ action, component, extras, serial }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'am', 'broadcast', '-a', action);
    if (component) args.push('-n', component);
    if (extras) {
      try {
        const extraObj = JSON.parse(extras);
        for (const [key, value] of Object.entries(extraObj)) {
          args.push('--es', key, String(value));
        }
      } catch { /* ignore */ }
    }
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_broadcast', stdout, stderr, duration);
  }),

  // ─── Network & Misc ──────────────────────────────────────────────────────
  wrap('port_forward', 'Set up port forwarding', {
    local_port: { type: 'number', description: 'Local port' },
    remote_port: { type: 'number', description: 'Remote/device port' },
    serial: { type: 'string', description: 'Device serial' },
    remove: { type: 'boolean', description: 'Remove forwarding (default: false)' },
  }, ['local_port', 'remote_port'], async ({ local_port, remote_port, serial, remove }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push(remove ? 'forward' : 'forward', remove ? '--remove' : `tcp:${local_port}`, remove ? `tcp:${local_port}` : `tcp:${remote_port}`);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_port_forward', stdout, stderr, duration);
  }),

  wrap('getprop', 'Get system properties (device info, build info, etc.)', {
    prop: { type: 'string', description: 'Property name (empty for all)' },
    serial: { type: 'string', description: 'Device serial' },
  }, [], async ({ prop, serial }) => {
    const args: string[] = [];
    if (serial) args.push('-s', serial);
    args.push('shell', 'getprop', prop || '');
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return adbResult('adb_getprop', stdout, stderr, duration);
  }),
];
