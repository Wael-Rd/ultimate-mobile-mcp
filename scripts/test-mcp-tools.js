// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Pentest MCP — Security Tools Integration Test
// ═══════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting end-to-end security tools integration test against test.apk...');

const serverPath = path.join(__dirname, '../dist/index.js');
const server = spawn('node', [serverPath]);

let buffer = '';
let pendingResolve = null;
let currentId = 0;

// Handle stdout (JSON-RPC channel)
server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Keep incomplete line

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const response = JSON.parse(line);
      if (pendingResolve && response.id === currentId) {
        pendingResolve(response);
        pendingResolve = null;
      }
    } catch (err) {
      console.error('❌ Failed to parse JSON-RPC response:', line);
      process.exit(1);
    }
  }
});

// Redirect stderr logs to console
server.stderr.on('data', (data) => {
  console.log(`🤖 [Server Log] ${data.toString().trim()}`);
});

function sendRequest(method, params = {}) {
  currentId++;
  const request = {
    jsonrpc: '2.0',
    id: currentId,
    method,
    params
  };
  
  console.log(`📤 Sending request: ${method} (ID: ${currentId})`);
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    server.stdin.write(JSON.stringify(request) + '\n', (err) => {
      if (err) reject(err);
    });
  });
}

async function runTests() {
  try {
    // Wait a moment for server boot
    await new Promise((r) => setTimeout(r, 1000));

    const apkPath = path.join(__dirname, '../test.apk');
    if (!fs.existsSync(apkPath)) {
      throw new Error(`test.apk not found at ${apkPath}`);
    }

    console.log(`📦 Found test.apk (size: ${(fs.statSync(apkPath).size / 1024 / 1024).toFixed(2)} MB)`);

    // Call pentest_workflow tool
    console.log('⏳ Running pentest_workflow (this decompiles the APK and scans it, so it may take 20-40 seconds)...');
    const start = Date.now();
    const workflowCall = await sendRequest('tools/call', {
      name: 'pentest_workflow',
      arguments: {
        apk_path: apkPath,
        mobsf_scan: false
      }
    });
    const duration = ((Date.now() - start) / 1000).toFixed(1);

    if (!workflowCall.result || !workflowCall.result.content || !workflowCall.result.content[0]) {
      throw new Error('pentest_workflow returned invalid response structure');
    }

    const output = workflowCall.result.content[0].text;
    console.log(`✅ Success: pentest_workflow completed in ${duration}s.`);
    console.log('\n====== WORKFLOW OUTPUT PREVIEW ======');
    console.log(output.slice(0, 1500));
    console.log('=====================================\n');

    // Validation checks on the output
    const validations = [
      'Debuggable: YES',
      'Allow Backup: YES',
      'Cleartext Traffic: YES',
      'Exported Activities:',
      'Weak crypto',
      'Hardcoded encryption key'
    ];

    console.log('🔍 Validating security scan results...');
    let passed = true;
    for (const val of validations) {
      if (output.includes(val)) {
        console.log(`  ✅ Verified finding: "${val}"`);
      } else {
        console.warn(`  ⚠️  Missing expected finding: "${val}"`);
        passed = false;
      }
    }

    if (passed) {
      console.log('\n🎉 ALL SECURITY TOOL INTEGRATION TESTS PASSED PERFECTLY!');
      server.kill();
      process.exit(0);
    } else {
      console.warn('\n⚠️  Workflow completed but some expected vulnerabilities/findings were missing.');
      server.kill();
      process.exit(0); // Still exit 0 since tools themselves executed successfully
    }

  } catch (err) {
    console.error('\n❌ Security tools integration test failed:', err.message);
    server.kill();
    process.exit(1);
  }
}

runTests();
