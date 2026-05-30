// ─── Frida Tool Wrapper ───────────────────────────────────────────────────────
// Dynamic instrumentation: attach, spawn, trace, enumerate, and script execution.
// Supports both frida CLI and direct script injection.

import { execTool, generateSummary, estimateTokens, writeArtifact } from '../utils/helpers';
import { TOOL_DEFAULTS } from '../utils/config';
import type { MCPToolDefinition, ToolResult } from '../types';

const cfg = () => ({ ...TOOL_DEFAULTS.frida, timeout: 120000 }); // Frida needs longer timeout

function wrap(name: string, desc: string, schema: Record<string, unknown>, required: string[] = [],
  handler: (args: any) => Promise<ToolResult>): MCPToolDefinition {
  return {
    name: `frida_${name}`,
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

export const fridaTools: MCPToolDefinition[] = [
  // ─── Enumerate ───────────────────────────────────────────────────────────
  wrap('ps', 'List running processes on device (via frida-ps)', {
    device: { type: 'string', description: 'Device ID (usb/local/remote)' },
    full: { type: 'boolean', description: 'Show full command line (default: true)' },
    filter: { type: 'string', description: 'Filter by name substring' },
  }, [], async ({ device, full = true, filter }) => {
    const args: string[] = [];
    if (device) args.push('-D', device);
    if (full) args.push('-a');
    args.push('ps');
    if (filter) args.push(filter);

    // frida-ps is a separate binary
    const { stdout, stderr, duration } = await execTool({ ...cfg(), name: 'frida-ps' }, args);
    return result('frida_ps', stdout, stderr, duration);
  }),

  wrap('ps_apps', 'List only installed apps (via frida-ps)', {
    device: { type: 'string', description: 'Device ID' },
    filter: { type: 'string', description: 'Filter by app name' },
  }, [], async ({ device, filter }) => {
    const args: string[] = [];
    if (device) args.push('-D', device);
    args.push('-ai');
    if (filter) args.push(filter);
    const { stdout, stderr, duration } = await execTool({ ...cfg(), name: 'frida-ps' }, args);
    return result('frida_ps_apps', stdout, stderr, duration);
  }),

  // ─── Spawn & Attach ──────────────────────────────────────────────────────
  wrap('spawn', 'Spawn an app with Frida attached (suspended start)', {
    package: { type: 'string', description: 'Package name to spawn' },
    device: { type: 'string', description: 'Device ID' },
    script: { type: 'string', description: 'JavaScript hook code to inject' },
    no_pause: { type: 'boolean', description: 'Resume immediately (default: true)' },
    runtime: { type: 'string', description: 'Runtime: qjs or v8 (default: qjs)', enum: ['qjs', 'v8'] },
  }, ['package'], async ({ package: pkg, device, script, no_pause = true, runtime = 'qjs' }) => {
    const args: string[] = ['-f', pkg];
    if (device) args.push('-D', device);
    if (no_pause) args.push('--no-pause');
    if (runtime) args.push('--runtime', runtime);

    if (script) {
      // Write script to temp file
      const scriptPath = writeArtifact(`frida_hook_${pkg.replace(/\./g, '_')}_${Date.now()}.js`, script);
      args.push('-l', scriptPath);
    }

    const { stdout, stderr, duration } = await execTool(cfg(), args);
    const artifacts = script ? [writeArtifact(`frida_output_${Date.now()}.txt`, stdout)] : [];
    return result('frida_spawn', stdout, stderr, duration, artifacts);
  }),

  wrap('attach', 'Attach to a running process', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
    script: { type: 'string', description: 'JavaScript hook code to inject' },
    runtime: { type: 'string', description: 'Runtime: qjs or v8', enum: ['qjs', 'v8'] },
  }, ['target'], async ({ target, device, script, runtime }) => {
    const args: string[] = ['-n', target];
    if (device) args.push('-D', device);
    if (runtime) args.push('--runtime', runtime);

    if (script) {
      const scriptPath = writeArtifact(`frida_hook_${target}_${Date.now()}.js`, script);
      args.push('-l', scriptPath);
    }

    const { stdout, stderr, duration } = await execTool(cfg(), args);
    const artifacts = script ? [writeArtifact(`frida_output_${Date.now()}.txt`, stdout)] : [];
    return result('frida_attach', stdout, stderr, duration, artifacts);
  }),

  // ─── Script Execution ────────────────────────────────────────────────────
  wrap('eval', 'Evaluate JavaScript on a live target', {
    target: { type: 'string', description: 'Process name or PID' },
    code: { type: 'string', description: 'JavaScript code to evaluate' },
    device: { type: 'string', description: 'Device ID' },
    expression: { type: 'string', description: 'One-liner expression (alternative to code)' },
  }, ['target'], async ({ target, code, device, expression }) => {
    const scriptContent = expression
      ? `console.log(JSON.stringify(${expression}));`
      : code || '';

    const scriptPath = writeArtifact(`frida_eval_${Date.now()}.js`, scriptContent);

    const args: string[] = ['-n', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);

    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_eval', stdout, stderr, duration, [scriptPath]);
  }),

  // ─── Trace ───────────────────────────────────────────────────────────────
  wrap('trace', 'Trace function calls (method invocation tracking)', {
    target: { type: 'string', description: 'Process name or PID' },
    methods: { type: 'string', description: 'Methods to trace (Java notation: com.app.Class.method)' },
    device: { type: 'string', description: 'Device ID' },
    depth: { type: 'number', description: 'Backtrace depth (default: 8)' },
  }, ['target', 'methods'], async ({ target, methods, device, depth = 8 }) => {
    const methodList = methods.split(',').map((m: string) => m.trim());
    const args: string[] = ['-n', target, '-i', ...methodList];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);

    const artifactPath = writeArtifact(`frida_trace_${target}_${Date.now()}.txt`, stdout);
    return result('frida_trace', stdout, stderr, duration, [artifactPath]);
  }),

  // ─── Built-in Hooks Library ──────────────────────────────────────────────
  wrap('hook_ssl_pinning', 'Bypass SSL pinning (universal hook)', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
  }, ['target'], async ({ target, device }) => {
    const sslBypass = `
// Universal SSL Pinning Bypass
Java.perform(function() {
  console.log("[*] SSL Pinning Bypass - Loading...");

  // TrustManager bypass
  var TrustManager = Java.registerClass({
    name: 'com.frida.TrustManager',
    implements: [Java.use('javax.net.ssl.X509TrustManager')],
    methods: {
      checkClientTrusted: function(chain, authType) {},
      checkServerTrusted: function(chain, authType) {},
      getAcceptedIssuers: function() { return []; }
    }
  });

  // OkHttpClient
  try {
    var OkHttpClient = Java.use('okhttp3.OkHttpClient');
    OkHttpClient.newBuilder.implementation = function() {
      return this.newBuilder()
        .sslSocketFactory(Java.use('javax.net.ssl.SSLSocketFactory').getDefault())
        .hostnameVerifier(Java.registerClass({
          name: 'com.frida.HostVerifier',
          implements: [Java.use('javax.net.ssl.HostnameVerifier')],
          methods: { verify: function(h, s) { return true; } }
        }).$new());
    };
    console.log("[+] OkHttp3 bypass loaded");
  } catch(e) {}

  // WebViewClient
  try {
    var WebViewClient = Java.use('android.webkit.WebViewClient');
    WebViewClient.onReceivedSslError.implementation = function(webView, handler, error) {
      handler.proceed();
      console.log("[+] SSL error bypassed in WebView");
    };
  } catch(e) {}

  // CertificatePinner
  try {
    var CertPinner = Java.use('okhttp3.CertificatePinner');
    CertPinner.check.overload('java.lang.String', 'java.util.List').implementation = function(host, certs) {
      console.log("[+] Certificate pin bypassed for: " + host);
    };
  } catch(e) {}

  console.log("[*] SSL Pinning Bypass Complete");
});
`;
    const scriptPath = writeArtifact(`ssl_bypass_${Date.now()}.js`, sslBypass);
    const args: string[] = ['-f', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_ssl_bypass', stdout, stderr, duration, [scriptPath]);
  }),

  wrap('hook_root_detection', 'Bypass root detection', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
  }, ['target'], async ({ target, device }) => {
    const rootBypass = `
Java.perform(function() {
  console.log("[*] Root Detection Bypass - Loading...");

  // File.exists bypass
  var File = Java.use('java.io.File');
  File.exists.implementation = function() {
    var path = this.getAbsolutePath();
    var rootPaths = ['/system/app/Superuser.apk', '/sbin/su', '/system/bin/su',
      '/system/xbin/su', '/data/local/xbin/su', '/data/local/bin/su',
      '/system/sd/xbin/su', '/system/bin/failsafe/su', '/system/bin/.ext/.su',
      '/system/usr/we-need-root/su-backup', '/system/xbin/daemonsu',
      '/magisk/.core/bin/su', '/system/etc/init.d/99SuperSUDaemon'];
    if (rootPaths.indexOf(path) !== -1) {
      console.log("[+] Blocked root check: " + path);
      return false;
    }
    return this.exists.call(this);
  };

  // Runtime.exec bypass
  var Runtime = Java.use('java.lang.Runtime');
  Runtime.exec.overload('[Ljava.lang.String;').implementation = function(cmds) {
    var cmd = cmds.join(' ');
    if (/which su|su |busybox|magisk|supersu|Superuser/i.test(cmd)) {
      console.log("[+] Blocked root command: " + cmd);
      return Java.use('java.lang.Process').$new();
    }
    return this.exec(cmds);
  };

  // Package Manager root app check
  try {
    var PackageManager = Java.use('android.app.ApplicationPackageManager');
    PackageManager.getPackageInfo.overload('java.lang.String', 'int').implementation = function(pkg, flags) {
      var rootPkgs = ['com.noshufou.android.su', 'com.koushikdutta.superuser',
        'eu.chainfire.supersu', 'com.topjohnwu.magisk'];
      if (rootPkgs.indexOf(pkg) !== -1) {
        console.log("[+] Blocked package check for: " + pkg);
        throw Java.use('android.content.pm.PackageManager$NameNotFoundException').$new(pkg);
      }
      return this.getPackageInfo(pkg, flags);
    };
  } catch(e) {}

  console.log("[*] Root Detection Bypass Complete");
});
`;
    const scriptPath = writeArtifact(`root_bypass_${Date.now()}.js`, rootBypass);
    const args: string[] = ['-f', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_root_bypass', stdout, stderr, duration, [scriptPath]);
  }),

  wrap('hook_crypto', 'Hook cryptographic operations (key extraction)', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
    log_keys: { type: 'boolean', description: 'Log encryption/decryption keys (default: true)' },
  }, ['target'], async ({ target, device, log_keys = true }) => {
    const cryptoHook = `
Java.perform(function() {
  console.log("[*] Crypto Hook - Loading...");

  // Cipher
  var Cipher = Java.use('javax.crypto.Cipher');
  Cipher.doFinal.overload('[B').implementation = function(input) {
    var algo = this.getAlgorithm();
    var result = this.doFinal(input);
    console.log("[CIPHER] " + algo + " | input: " + bytesToHex(input).slice(0,64) + " | output: " + bytesToHex(result).slice(0,64));
    ${log_keys ? `try { var key = this.j.value; console.log("[KEY] " + algo + " key: " + bytesToHex(key.getEncoded())); } catch(e) {}` : ''}
    return result;
  };

  // SecretKeySpec
  var SecretKeySpec = Java.use('javax.crypto.spec.SecretKeySpec');
  SecretKeySpec.$init.overload('[B', 'java.lang.String').implementation = function(key, algo) {
    console.log("[SECRET KEY] Algorithm: " + algo + " | Key: " + bytesToHex(key));
    return this.$init(key, algo);
  };

  // IvParameterSpec
  var IvParameterSpec = Java.use('javax.crypto.spec.IvParameterSpec');
  IvParameterSpec.$init.overload('[B').implementation = function(iv) {
    console.log("[IV] " + bytesToHex(iv));
    return this.$init(iv);
  };

  // MessageDigest
  var MessageDigest = Java.use('java.security.MessageDigest');
  MessageDigest.digest.overload('[B').implementation = function(input) {
    var result = this.digest(input);
    console.log("[HASH] " + this.getAlgorithm() + " | " + bytesToHex(result) + " | input: " + bytesToHex(input).slice(0,64));
    return result;
  };

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < Math.min(bytes.length, 256); i++) {
      hex += ('0' + (bytes[i] & 0xFF).toString(16)).slice(-2);
    }
    return hex;
  }

  console.log("[*] Crypto Hook Complete");
});
`;
    const scriptPath = writeArtifact(`crypto_hook_${Date.now()}.js`, cryptoHook);
    const args: string[] = ['-f', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_crypto_hook', stdout, stderr, duration, [scriptPath]);
  }),

  wrap('hook_intent', 'Hook and log all intent broadcasts/actions', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
  }, ['target'], async ({ target, device }) => {
    const intentHook = `
Java.perform(function() {
  var Activity = Java.use('android.app.Activity');
  Activity.startActivity.overload('android.content.Intent').implementation = function(intent) {
    console.log("[INTENT] " + intent.getAction() + " | " + intent.getData() + " | " + intent.getComponent());
    this.startActivity(intent);
  };
  Activity.startActivityForResult.overload('android.content.Intent', 'int').implementation = function(intent, code) {
    console.log("[INTENT-FOR-RESULT] " + intent.getAction() + " | " + intent.getComponent() + " | requestCode: " + code);
    this.startActivityForResult(intent, code);
  };

  var Context = Java.use('android.content.Context');
  Context.sendBroadcast.implementation = function(intent) {
    console.log("[BROADCAST] " + intent.getAction() + " | extras: " + intent.getExtras());
    this.sendBroadcast(intent);
  };
});
`;
    const scriptPath = writeArtifact(`intent_hook_${Date.now()}.js`, intentHook);
    const args: string[] = ['-f', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_intent_hook', stdout, stderr, duration, [scriptPath]);
  }),

  wrap('hook_shared_prefs', 'Hook SharedPreferences to intercept read/write', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
  }, ['target'], async ({ target, device }) => {
    const spHook = `
Java.perform(function() {
  var SharedPreferencesImpl = Java.use('android.app.SharedPreferencesImpl');

  SharedPreferencesImpl.getString.implementation = function(key, defValue) {
    var val = this.getString(key, defValue);
    console.log("[SP-READ] " + key + " = " + val);
    return val;
  };

  SharedPreferencesImpl.edit.implementation = function() {
    var editor = this.edit();
    var Editor = Java.use('android.app.SharedPreferencesImpl$EditorImpl');

    Editor.putString.implementation = function(key, value) {
      console.log("[SP-WRITE] " + key + " = " + value);
      return this.putString(key, value);
    };

    Editor.commit.implementation = function() {
      console.log("[SP-COMMIT]");
      return this.commit();
    };

    return editor;
  };
});
`;
    const scriptPath = writeArtifact(`sharedprefs_hook_${Date.now()}.js`, spHook);
    const args: string[] = ['-f', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_shared_prefs_hook', stdout, stderr, duration, [scriptPath]);
  }),

  wrap('enum_classes', 'Enumerate loaded classes matching a pattern', {
    target: { type: 'string', description: 'Process name or PID' },
    pattern: { type: 'string', description: 'Class name pattern (e.g. "com.app.*")' },
    device: { type: 'string', description: 'Device ID' },
  }, ['target', 'pattern'], async ({ target, pattern, device }) => {
    const script = `
Java.perform(function() {
  var classes = Java.enumerateLoadedClasses({
    onMatch: function(name) {
      if (name.indexOf('${pattern}') !== -1) {
        console.log(name);
      }
    },
    onComplete: function() {}
  });
});
`;
    const scriptPath = writeArtifact(`enum_classes_${Date.now()}.js`, script);
    const args: string[] = ['-n', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_enum_classes', stdout, stderr, duration, [scriptPath]);
  }),

  wrap('dump_ui', 'Dump the current UI view hierarchy', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
  }, ['target'], async ({ target, device }) => {
    const script = `
Java.perform(function() {
  var Activity = Java.use('android.app.Activity');
  var current = Activity.currentActivity();
  if (current) {
    var view = current.getWindow().getDecorView();
    console.log("[UI] Activity: " + current.getClass().getName());
    console.log("[UI] Root view: " + view.getClass().getName());
    dumpView(view, 0);
  } else {
    console.log("[UI] No current activity found");
  }

  function dumpView(v, depth) {
    if (depth > 10) return;
    var indent = '  '.repeat(depth);
    console.log(indent + v.getClass().getName() +
      " id=" + (v.getId() ? v.getResources().getResourceEntryName(v.getId()) : 'none') +
      " visible=" + v.getVisibility());
    try {
      var vg = Java.cast(v, Java.use('android.view.ViewGroup'));
      for (var i = 0; i < vg.getChildCount(); i++) {
        dumpView(vg.getChildAt(i), depth + 1);
      }
    } catch(e) {}
  }
});
`;
    const scriptPath = writeArtifact(`dump_ui_${Date.now()}.js`, script);
    const args: string[] = ['-n', target, '-l', scriptPath, '--no-pause'];
    if (device) args.push('-D', device);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    const artifactPath = writeArtifact(`ui_dump_${Date.now()}.txt`, stdout);
    return result('frida_dump_ui', stdout, stderr, duration, [scriptPath, artifactPath]);
  }),

  // ─── Kill / Reload ───────────────────────────────────────────────────────
  wrap('kill', 'Kill a Frida session or process', {
    target: { type: 'string', description: 'Process name or PID' },
    device: { type: 'string', description: 'Device ID' },
  }, ['target'], async ({ target, device }) => {
    const args: string[] = [];
    if (device) args.push('-D', device);
    args.push('-k');
    args.push(target);
    const { stdout, stderr, duration } = await execTool(cfg(), args);
    return result('frida_kill', stdout, stderr, duration);
  }),
];
