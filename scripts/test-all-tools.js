// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Pentest MCP — Diagnostic Registry Unit Test (Fast Mode)
// ═══════════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');

console.log('🧪 Starting Fast Diagnostic Unit Test of all 83 MCP Tool Registries...\n');

// Load config and initializers
const { loadConfig, ensureArtifactsDir, TOOL_DEFAULTS } = require('../dist/utils/config');
const { initOptimizer } = require('../dist/optimizer');
const { ALL_TOOL_DEFINITIONS } = require('../dist/tools/index');

// Overwrite all tool timeouts to 200ms to fail-fast during network/device waits
for (const key in TOOL_DEFAULTS) {
  TOOL_DEFAULTS[key].timeout = 200;
}

const config = loadConfig();
ensureArtifactsDir();
initOptimizer(config.optimizer);

// Dummy arguments for every single tool to verify argument schemas and handlers
const dummyArgs = {
  // ADB Tools
  adb_devices: {},
  adb_install: { apk_path: 'test.apk' },
  adb_uninstall: { package: 'com.android.insecurebankv2' },
  adb_shell: { command: 'echo hello' },
  adb_dump_package: { package: 'com.android.insecurebankv2' },
  adb_list_permissions: { package: 'com.android.insecurebankv2' },
  adb_list_activities: { package: 'com.android.insecurebankv2' },
  adb_check_debuggable: { package: 'com.android.insecurebankv2' },
  adb_pull: { remote_path: '/sdcard/test.txt', local_path: 'test.txt' },
  adb_push: { local_path: 'test.txt', remote_path: '/sdcard/test.txt' },
  adb_logcat: { lines: 10 },
  adb_screenshot: { output_path: 'screenshot.png' },
  adb_backup: { package: 'com.android.insecurebankv2', output_path: 'backup.ab' },
  adb_list_packages: {},
  adb_start_activity: { package: 'com.android.insecurebankv2', activity: 'MainActivity' },
  adb_start_service: { package: 'com.android.insecurebankv2', service: 'MyService' },
  adb_broadcast: { action: 'MY_ACTION' },
  adb_port_forward: { local_port: 8080, device_port: 8080 },
  adb_getprop: { property: 'ro.build.version.release' },
  adb_clear_data: { package: 'com.android.insecurebankv2' },

  // Frida Tools
  frida_ps: {},
  frida_ps_apps: {},
  frida_spawn: { package: 'com.android.insecurebankv2' },
  frida_attach: { target: 'com.android.insecurebankv2' },
  frida_eval: { target: 'com.android.insecurebankv2', code: 'console.log("hello");' },
  frida_trace: { target: 'com.android.insecurebankv2', methods: 'MainActivity.onCreate' },
  frida_hook_ssl_pinning: { target: 'com.android.insecurebankv2' },
  frida_hook_root_detection: { target: 'com.android.insecurebankv2' },
  frida_hook_crypto: { target: 'com.android.insecurebankv2' },
  frida_hook_intent: { target: 'com.android.insecurebankv2' },
  frida_hook_shared_prefs: { target: 'com.android.insecurebankv2' },
  frida_enum_classes: { target: 'com.android.insecurebankv2', pattern: 'com.android.*' },
  frida_dump_ui: { target: 'com.android.insecurebankv2' },
  frida_kill: { target: 'com.android.insecurebankv2' },

  // Objection Tools
  objection_explore: { package: 'com.android.insecurebankv2' },
  objection_sslpinning_disable: { package: 'com.android.insecurebankv2' },
  objection_dump_keys: { package: 'com.android.insecurebankv2' },
  objection_list_activities: { package: 'com.android.insecurebankv2' },
  objection_list_services: { package: 'com.android.insecurebankv2' },
  objection_list_receivers: { package: 'com.android.insecurebankv2' },
  objection_search_classes: { package: 'com.android.insecurebankv2', pattern: 'com.android.*' },
  objection_list_class_methods: { package: 'com.android.insecurebankv2', class: 'MainActivity' },
  objection_ls: { package: 'com.android.insecurebankv2' },
  objection_cat: { package: 'com.android.insecurebankv2', path: 'shared_prefs/MainActivity.xml' },
  objection_download: { package: 'com.android.insecurebankv2', remote_path: 'shared_prefs/MainActivity.xml' },
  objection_sqlite_dump: { package: 'com.android.insecurebankv2', db_path: 'databases/mydb.db' },

  // MobSF Tools
  mobsf_upload: { file_path: 'test.apk' },
  mobsf_scan: { hash: 'dummy_hash' },
  mobsf_report_json: { hash: 'dummy_hash' },
  mobsf_pdf_report: { hash: 'dummy_hash' },
  mobsf_dynamic_start: { package: 'com.android.insecurebankv2' },
  mobsf_dynamic_stop: { package: 'com.android.insecurebankv2' },
  mobsf_frida_logs: { package: 'com.android.insecurebankv2' },
  mobsf_recent_scans: {},
  mobsf_delete_scan: { hash: 'dummy_hash' },
  mobsf_api_info: {},

  // JADX Tools
  jadx_decompile: { apk_path: 'test.apk' },
  jadx_decompile_resources: { apk_path: 'test.apk' },
  jadx_search_secrets: { source_dir: 'dummy_dir' },
  jadx_search_crypto: { source_dir: 'dummy_dir' },
  jadx_search_urls: { source_dir: 'dummy_dir' },
  jadx_search_permissions: { source_dir: 'dummy_dir' },
  jadx_read_source: { file_path: 'dummy_file.java' },
  jadx_list_classes: { source_dir: 'dummy_dir' },
  jadx_show_structure: { source_dir: 'dummy_dir' },

  // APKTool Tools
  apktool_decode: { apk_path: 'test.apk' },
  apktool_build: { input_dir: 'dummy_dir' },
  apktool_read_manifest: { decoded_dir: 'dummy_dir' },
  apktool_patch_manifest: { decoded_dir: 'dummy_dir', patches: '[]' },
  apktool_read_smali: { smali_path: 'dummy_path.smali' },
  apktool_patch_smali: { smali_path: 'dummy_path.smali', find: 'foo', replace: 'bar' },
  apktool_search_smali: { decoded_dir: 'dummy_dir', pattern: 'foo' },
  apktool_read_resource: { resource_path: 'dummy_path.xml' },
  apktool_list_resources: { decoded_dir: 'dummy_dir' },
  apktool_patch_and_rebuild: { apk_path: 'test.apk' },

  // Meta Tools
  pentest_workflow: { apk_path: 'test.apk', mobsf_scan: false },
  check_tools: {},
  token_stats: {},
  read_artifact: { file_path: 'dummy_path.txt' }
};

async function testAll() {
  let passedCount = 0;
  let failedCrashCount = 0;
  const results = [];

  for (const toolDef of ALL_TOOL_DEFINITIONS) {
    const args = dummyArgs[toolDef.name] || {};
    const startTime = Date.now();
    let statusText = '';
    let hasCrashed = false;
    let result = null;

    try {
      // Execute the tool handler
      result = await toolDef.handler(args);
      
      // Check that response complies with the ToolResult structure
      if (
        result &&
        typeof result.success === 'boolean' &&
        typeof result.output === 'string' &&
        typeof result.summary === 'string' &&
        Array.isArray(result.artifacts)
      ) {
        statusText = result.success 
          ? '✅ OK (Success)' 
          : '⚠️  OK (Handled Failure)';
        passedCount++;
      } else {
        statusText = '❌ Invalid ToolResult structure';
        failedCrashCount++;
      }
    } catch (err) {
      statusText = `💥 CRASHED: ${err.message}`;
      hasCrashed = true;
      failedCrashCount++;
    }

    results.push({
      name: toolDef.name,
      status: statusText,
      durationMs: Date.now() - startTime,
      crashed: hasCrashed,
      tokensEstimate: result ? result.tokensEstimate : 0
    });
  }

  // Print results table
  console.log('┌────────────────────────────────────────────────────────┬─────────────────────────────┬─────────────┐');
  console.log('│ Tool Name                                              │ Test Status                 │ Duration    │');
  console.log('├────────────────────────────────────────────────────────┼─────────────────────────────┼─────────────┤');
  for (const r of results) {
    const namePad = r.name.padEnd(54);
    const statusPad = r.status.padEnd(27);
    const durPad = `${r.durationMs}ms`.padStart(9);
    console.log(`│ ${namePad} │ ${statusPad} │ ${durPad} │`);
  }
  console.log('└────────────────────────────────────────────────────────┴─────────────────────────────┴─────────────┘');

  console.log(`\n📊 Diagnostic Summary:`);
  console.log(`  - Total Tools Registered: ${ALL_TOOL_DEFINITIONS.length}`);
  console.log(`  - Total Tools Passed:     ${passedCount}`);
  console.log(`  - Total Crashes/Errors:   ${failedCrashCount}`);

  if (failedCrashCount === 0) {
    console.log('\n🎉 SUCCESS: All tool wrappers handle execution and inputs flawlessly without crashing!');
    process.exit(0);
  } else {
    console.error('\n❌ FAILURE: Some tool wrappers crashed or returned invalid structures.');
    process.exit(1);
  }
}

testAll();
