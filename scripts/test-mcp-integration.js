// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Pentest MCP — Integration Test Script
// ═══════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Mobile Pentest MCP integration tests...');

const serverPath = path.join(__dirname, '../dist/index.js');
const server = spawn('node', [serverPath]);

let buffer = '';
let pendingResolve = null;
let currentId = 0;

// Handle stdout (JSON-RPC channel)
server.stdout.on('data', (data) => {
  buffer += data.toString();
  // MCP protocol specifies JSON-RPC over stdio, delimited by newlines
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Keep incomplete line

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const response = JSON.parse(line);
      console.log(`📥 Received response for ID ${response.id}`);
      if (pendingResolve && response.id === currentId) {
        pendingResolve(response);
        pendingResolve = null;
      }
    } catch (err) {
      console.error('❌ Failed to parse JSON-RPC response from stdout:', line);
      console.error(err);
      process.exit(1);
    }
  }
});

// Handle stderr (Logger channel)
server.stderr.on('data', (data) => {
  // Logger output goes to stderr, which is correct and safe
  console.log(`🤖 [Server Log] ${data.toString().trim()}`);
});

server.on('close', (code) => {
  console.log(`🔌 Server process exited with code ${code}`);
});

// Helper to send JSON-RPC request and wait for response
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

// Run the test cases
async function runTests() {
  try {
    // Wait a brief moment for server boot
    await new Promise((r) => setTimeout(r, 1000));

    // Test 1: List all tools
    const toolsList = await sendRequest('tools/list');
    if (!toolsList.result || !toolsList.result.tools) {
      throw new Error('tools/list returned invalid response');
    }
    const tools = toolsList.result.tools;
    console.log(`✅ Success: Found ${tools.length} registered tools.`);
    
    const requiredTools = ['check_tools', 'token_stats', 'pentest_workflow', 'adb_devices', 'apktool_decode'];
    for (const req of requiredTools) {
      if (!tools.some(t => t.name === req)) {
        throw new Error(`Missing expected tool: ${req}`);
      }
    }
    console.log('✅ Success: All core tools registered.');

    // Test 2: Call check_tools
    const checkCall = await sendRequest('tools/call', {
      name: 'check_tools',
      arguments: {}
    });
    
    if (!checkCall.result || !checkCall.result.content || !checkCall.result.content[0]) {
      throw new Error('check_tools call returned invalid response structure');
    }
    
    const contentText = checkCall.result.content[0].text;
    console.log(`✅ Success: check_tools result received.`);
    console.log('─── Output Preview ───');
    console.log(contentText);
    console.log('──────────────────────');

    if (!contentText.includes('OK') && !contentText.includes('NOT FOUND')) {
      throw new Error('check_tools output does not contain expected validation states');
    }

    // Test 3: Call token_stats
    const statsCall = await sendRequest('tools/call', {
      name: 'token_stats',
      arguments: {}
    });
    
    const statsText = statsCall.result.content[0].text;
    console.log(`✅ Success: token_stats result received.`);
    if (!statsText.includes('totalSaved') && !statsText.includes('totalUsed')) {
      throw new Error('token_stats output does not contain expected stats keys');
    }

    console.log('\n🎉 ALL INTEGRATION TESTS PASSED PERFECTLY!');
    server.kill();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test execution failed:', err.message);
    server.kill();
    process.exit(1);
  }
}

runTests();
