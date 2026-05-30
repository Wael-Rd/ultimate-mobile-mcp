#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// Post-install dependency check (runs automatically on npm install)
// ═══════════════════════════════════════════════════════════════════════════════

const { execSync } = require('child_process');

const tools = ['adb', 'frida', 'frida-ps', 'objection', 'jadx', 'apktool'];
const found = [];
const missing = [];

for (const tool of tools) {
  try {
    execSync(`which ${tool} 2>/dev/null`, { stdio: 'pipe' });
    found.push(tool);
  } catch {
    missing.push(tool);
  }
}

console.log('\n═══ Mobile Pentest MCP — Dependency Check ═══');
console.log(`Found: ${found.length > 0 ? found.join(', ') : 'none'}`);
if (missing.length > 0) {
  console.log(`Missing: ${missing.join(', ')}`);
  console.log('\nTo install missing tools:');
  console.log('  Python tools: pip install frida-tools objection');
  console.log('  macOS (brew):  brew install adb apktool jadx');
  console.log('  Ubuntu:        sudo apt install adb apktool');
  console.log('\nRun: node scripts/check-deps.js');
} else {
  console.log('All tools available!');
}
console.log('═══════════════════════════════════════════════════\n');

process.exit(0); // Always exit 0 so npm install doesn't fail
