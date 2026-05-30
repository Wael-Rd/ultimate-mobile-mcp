const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🔗 Registering Mobile Pentest MCP in Claude Desktop Config...\n');

// 1. Locate the config file based on platform
let configPath = '';
const homeDir = os.homedir();

if (process.platform === 'win32') {
  configPath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
} else if (process.platform === 'darwin') {
  configPath = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
} else {
  // Linux / Other Unix
  configPath = path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
}

console.log(`📂 Config target path: ${configPath}`);

// 2. Build the server target config
const serverName = 'mobile-pentest';
const absoluteEntry = path.resolve(__dirname, '../dist/index.js');
const serverConfig = {
  command: 'node',
  args: [absoluteEntry],
  env: {
    // Optional environment configurations
    MOBSF_URL: process.env.MOBSF_URL || 'http://127.0.0.1:8000',
    MOBSF_API_KEY: process.env.MOBSF_API_KEY || ''
  }
};

// 3. Read and modify configuration
let configData = { mcpServers: {} };

try {
  const parentDir = path.dirname(configPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    if (raw.trim()) {
      configData = JSON.parse(raw);
    }
  }
} catch (err) {
  console.log(`⚠️  Failed reading existing config or directory (starting fresh): ${err.message}`);
}

if (!configData.mcpServers) {
  configData.mcpServers = {};
}

// 4. Update the config entry
configData.mcpServers[serverName] = serverConfig;

try {
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
  console.log(`\n🎉 SUCCESS: Successfully registered "${serverName}" in Claude Desktop!`);
  console.log(`📍 Entry point: ${absoluteEntry}`);
  console.log('🔄 Restart your Claude Desktop App to apply changes.');
} catch (err) {
  console.error(`❌ Failed to write config file: ${err.message}`);
  process.exit(1);
}
