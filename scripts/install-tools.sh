#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Mobile Pentest MCP — Dependency Checker & Installer
# ═══════════════════════════════════════════════════════════════════════════════
# This script checks which tools are available and optionally installs them.
# Run: bash scripts/install-tools.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "═══════════════════════════════════════════════════════════════"
echo "  🔥 Mobile Pentest MCP — Tool Dependency Checker"
echo "═══════════════════════════════════════════════════════════════"
echo ""

check_cmd() {
  if command -v "$1" &> /dev/null; then
    version=$($1 --version 2>&1 | head -1)
    echo -e "${GREEN}✅ $1${NC} — $version"
    return 0
  else
    echo -e "${RED}❌ $1${NC} — NOT FOUND"
    return 1
  fi
}

# ─── Check all tools ─────────────────────────────────────────────────────────
echo "── Core Tools ───────────────────────────────────────────────"
ADB_FOUND=$(check_cmd adb || true)
FRIDA_FOUND=$(check_cmd frida || true)
FRIDA_PS_FOUND=$(check_cmd frida-ps || true)
OBJECTION_FOUND=$(check_cmd objection || true)
JADX_FOUND=$(check_cmd jadx || true)
APKTOOL_FOUND=$(check_cmd apktool || true)

echo ""
echo "── Optional: MobSF ──────────────────────────────────────────"
MOBSF_URL="${MOBSF_URL:-http://127.0.0.1:8000}"
if curl -s --connect-timeout 3 "$MOBSF_URL/api/v1/mobsf_rest_api_info" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ MobSF${NC} — $MOBSF_URL"
else
  echo -e "${YELLOW}⚠️  MobSF${NC} — Not reachable at $MOBSF_URL"
fi

echo ""
echo "── Node.js / npm ────────────────────────────────────────────"
NODE_FOUND=$(check_cmd node || true)
NPM_FOUND=$(check_cmd npm || true)

# ─── Installation instructions ───────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Installation Instructions for Missing Tools"
echo "═══════════════════════════════════════════════════════════════"

if ! command -v adb &> /dev/null; then
  echo -e "${YELLOW}ADB (Android Debug Bridge):${NC}"
  echo "  macOS:  brew install --cask android-platform-tools"
  echo "  Ubuntu: sudo apt install adb"
  echo "  Or download from: https://developer.android.com/tools/releases/platform-tools"
  echo ""
fi

if ! command -v frida &> /dev/null; then
  echo -e "${YELLOW}Frida:${NC}"
  echo "  pip install frida-tools"
  echo "  npm install -g frida"
  echo ""
fi

if ! command -v frida-ps &> /dev/null; then
  echo -e "${YELLOW}Frida-PS:${NC}"
  echo "  pip install frida-tools  (includes frida-ps)"
  echo ""
fi

if ! command -v objection &> /dev/null; then
  echo -e "${YELLOW}Objection:${NC}"
  echo "  pip install objection"
  echo ""
fi

if ! command -v jadx &> /dev/null; then
  echo -e "${YELLOW}JADX:${NC}"
  echo "  macOS:  brew install jadx"
  echo "  Linux:  Download from https://github.com/skylot/jadx/releases"
  echo "  sudo apt install jadx (if available)"
  echo ""
fi

if ! command -v apktool &> /dev/null; then
  echo -e "${YELLOW}APKTool:${NC}"
  echo "  macOS:  brew install apktool"
  echo "  Linux:  sudo apt install apktool"
  echo "  Or: wget https://bitbucket.org/Applbug/apktool/downloads/apktool_2.9.3.jar"
  echo ""
fi

echo -e "${BLUE}MobSF (Optional - for automated scanning):${NC}"
echo "  docker run -it -p 8000:8000 opensecurity/mobsf:latest"
echo "  Then set MOBSF_URL=http://localhost:8000 and MOBSF_API_KEY=<key>"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  Quick Install (all Python tools at once):"
echo "  pip install frida-tools objection"
echo ""
echo "  Quick Install (all Homebrew tools at once):"
echo "  brew install adb apktool jadx"
echo "═══════════════════════════════════════════════════════════════"
