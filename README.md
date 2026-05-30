<p align="center">
  <img src="https://img.shields.io/badge/MCP-1.12.1-blue.svg?style=for-the-badge&logo=model-context-protocol" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20WSL-success.svg?style=for-the-badge&logo=android" alt="Platform Compatibility" />
  <img src="https://img.shields.io/badge/Build-Passing-green.svg?style=for-the-badge" alt="Build Status" />
</p>

<h1 align="center">🔥 Ultimate Mobile Pentest MCP — v2.0.0</h1>

<p align="center">
  <b>The first unified Model Context Protocol (MCP) server that bridges the entire mobile application security arsenal into a single, cohesive, AI-orchestrated endpoint.</b>
</p>

<p align="center">
  <i>Enable Claude, Gemini, Cursor, Windsurf, or any compatible AI client to decompile, patch, repack, inspect, bypass protections, and dynamically instrument Android & iOS apps natively.</i>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Wael-Rd/ultimate-mobile-mcp/main/docs/assets/divider.png" alt="" style="max-width: 100%;" />
</p>

<div align="center">
  <pre>
┌────────────────────────────────────────────────────────────┐
│              AI Client (Cursor, Claude, etc.)              │
│                via MCP JSON-RPC over stdio                 │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                Ultimate Mobile Pentest MCP                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │             Token Optimization Pipeline              │  │
│  │  Cache → Tiering → Diffing → Summary → Offloading   │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌────────┬────────┬──────────┬────────┬────────┬───────┐  │
│  │  ADB   │ Frida  │Objection │ MobSF  │  JADX  │APKTool│  │
│  │21 tools│14 tools│ 13 tools │10 tools│9 tools │10 t.  │  │
│  └────────┴────────┴──────────┴────────┴────────┴───────┘  │
└───────┬─────────┬──────────┬─────────┬────────┬───────┬─────┘
        ▼         ▼          ▼         ▼        ▼       ▼
    [Device]   [Memory]  [Runtime]   [Web]   [Java]  [Smali]  
  </pre>
</div>

---

## ⚡ The Context Window Problem — Solved
Decompiler listings, logs, and UI dumps are massive. A single execution of a tool can generate **100KB+ of console output**, costing **over 30,000 tokens**. Running a few commands will completely exhaust your LLM's context window or rack up huge API bills.

### 🛡️ 6-Layer Token Optimization Pipeline
This server runs every tool output through a strict, 6-layer reduction pipeline **before** sending it back to your AI client:

| Layer | Strategy | Rationale & Mechanics | Average Token Savings |
| :--- | :--- | :--- | :--- |
| **1** | **LRU Cache** | Identical calls within the cache window return instantaneously without executing. | **100%** on repeat commands |
| **2** | **Tiered Result Delivery** | AI chooses from `minimal` (status only), `summary` (compressed data), or `full` (raw debug logs). | **60% — 80%** |
| **3** | **Smart Output Diffing** | Compares output differences for repetitious commands (like polling logs or process states). | **85% — 95%** |
| **4** | **Summary Extraction** | Trims irrelevant log boilerplate and uses RegExp matchers to pull high-priority security findings. | **50% — 70%** |
| **5** | **Gzip Compression** | Compresses long strings when storing artifacts, preserving local disk footprint. | **70%** size reduction |
| **6** | **Artifact Offloading** | Large data dumps (>500 lines) are saved locally as markdown/raw files, and the LLM receives the file path, metadata, and summary. | **95%+** context reduction |

---

## 🛠️ Tool Catalog (83 Tools)

### 📲 ADB Engine (21 tools)
*   **Device Management**: `adb_devices`, `adb_getprop`, `adb_port_forward`
*   **Application Operations**: `adb_install`, `adb_uninstall`, `adb_clear_data`, `adb_list_packages`
*   **Security Inspection**: `adb_dump_package`, `adb_list_permissions` (with automatic dangerous permission filters), `adb_list_activities`, `adb_check_debuggable`
*   **Device Shell & File System**: `adb_shell` (executes native shell scripts), `adb_pull`, `adb_push`
*   **Debugging & Monitoring**: `adb_logcat` (with automatic noise-filtering), `adb_screenshot`, `adb_backup`
*   **Intent Manipulation**: `adb_start_activity`, `adb_start_service`, `adb_broadcast`

### 🧪 Frida Instrumentation (14 tools)
*   **Session Management**: `frida_ps`, `frida_ps_apps`, `frida_spawn`, `frida_attach`, `frida_kill`
*   **Scripting & Evaluation**: `frida_eval` (evaluates arbitrary JS directly in process memory), `frida_trace` (traces native methods), `frida_enum_classes`
*   **Built-in Bypass & Hook Injectors**:
    *   `frida_hook_ssl_pinning` (universal SSL pinning bypass)
    *   `frida_hook_root_detection` (rooting checks bypass)
    *   `frida_hook_crypto` (intercepts AES, DES, RSA keys and payloads dynamically)
    *   `frida_hook_intent` (intercepts incoming Android intents)
    *   `frida_hook_shared_prefs` (real-time tracking of SharedPreferences reads/writes)
    *   `frida_dump_ui` (extracts layout structure for security validation)

### 🔍 Objection Runtime exploration (13 tools)
*   **Inspection**: `objection_explore` (runs interactive objection jobs), `objection_env` (enumerates app directories), `objection_clipboard`
*   **Bypasses**: `objection_sslpinning_disable`
*   **File System & Data Extraction**: `objection_ls`, `objection_cat`, `objection_download`, `objection_sqlite_dump` (automatically extracts SQLite database tables), `objection_dump_keys` (dumps keystore contents)
*   **Android/iOS Specifics**: `objection_list_activities`, `objection_list_services`, `objection_list_receivers`, `objection_search_classes`, `objection_list_class_methods`, `objection_plist_read`

### ☁️ MobSF Client (10 tools)
*   `mobsf_upload`, `mobsf_scan`, `mobsf_delete_scan`, `mobsf_recent_scans`
*   `mobsf_report_json` (fetches machine-readable static analysis reports)
*   `mobsf_pdf_report` (downloads visual PDF dossiers)
*   `mobsf_dynamic_start`, `mobsf_dynamic_stop`, `mobsf_frida_logs`, `mobsf_api_info`

### ☕ JADX Decompiler (9 tools)
*   **Decompile Core**: `jadx_decompile` (Java output), `jadx_decompile_resources` (asset/manifest decompile), `jadx_read_source`
*   **Automated Audits**:
    *   `jadx_search_secrets` (scans codebase for hardcoded API tokens, private keys, Firebase database links)
    *   `jadx_search_crypto` (audits codebase for insecure crypto algorithms like MD5, SHA-1, ECB mode)
    *   `jadx_search_urls` (extracts endpoints, domains, IPs from bytecode)
    *   `jadx_search_permissions` (locates code locations invoking security-sensitive permissions)
    *   `jadx_list_classes`, `jadx_show_structure`

### 🔧 APKTool Engine (10 tools)
*   `apktool_decode` (smali + raw resource generation)
*   `apktool_build` (rebuilds target folders back into APK binaries)
*   `apktool_read_manifest`, `apktool_list_resources`, `apktool_read_resource`
*   **Automated Smali Patches**:
    *   `apktool_patch_manifest` (toggle debuggable, change permissions, modify component visibility)
    *   `apktool_read_smali`, `apktool_patch_smali` (find and inject/replace smali opcodes)
    *   `apktool_search_smali` (regex code search across disassembled smali files)
    *   `apktool_patch_and_rebuild` (orchestrates decode ➔ patch ➔ rebuild ➔ sign in one call)

### 📈 Meta & Workflow Tools (6 tools)
*   `pentest_workflow` (executes sequential static analysis in one go)
*   `check_tools` (verifies which local dependencies are configured and available)
*   `token_stats` (dashboard displaying total runtime tokens used vs. saved)
*   `read_artifact` (reads offloaded file payloads)

---

## 🚀 Easy Installation

### 1. Prerequisite Command-Line Tools
Install dependencies based on your operating system:

```bash
# Ubuntu / Kali Linux / WSL Debian
sudo apt install -y adb apktool jadx python3-pip npm
pip3 install frida-tools objection

# macOS
brew install adb apktool jadx
pip3 install frida-tools objection

# Optional: Spawn MobSF via Docker
docker run -it --rm -p 8000:8000 opensecurity/mobsf:latest
```

### 2. Get the Server Code
```bash
git clone https://github.com/Wael-Rd/ultimate-mobile-mcp.git
cd ultimate-mobile-mcp
npm install
npm run build
```

### 3. Automatic Claude Desktop Setup
If you use the official desktop app, register the server automatically using:
```bash
npm run register
```
*This command detects your OS path configurations and appends `mobile-pentest` directly to your client settings. Just restart Claude and start testing!*

---

## ⚙️ Manual Config Reference

Add the server manual entries to your client settings if you are using other hosts:

### Cursor (`mcpServers` settings) or Windsurf
```json
{
  "mcpServers": {
    "mobile-pentest": {
      "command": "node",
      "args": ["/absolute/path/to/ultimate-mobile-mcp/dist/index.js"],
      "env": {
        "MOBSF_URL": "http://127.0.0.1:8000",
        "MOBSF_API_KEY": "YOUR_MOBSF_API_KEY_HERE"
      }
    }
  }
}
```

### Claude Desktop Config Paths
*   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
*   **Linux**: `~/.config/Claude/claude_desktop_config.json`

---

## 💡 Real-World Prompts

### A. Run an Automated Scan
Decompiles the APK, parses the manifest, scans for API tokens, cryptographic weaknesses, and outputs a single markdown dossier:
> "Run a full `pentest_workflow` on `test.apk` and report all high-severity findings."

### B. Bypass SSL Pinning
Spawns the app under Frida, attaches the universal bypass script, and logs output in real time:
> "Launch `frida_hook_ssl_pinning` on process target `com.insecure.bank` so I can proxy the HTTP traffic."

### C. Patch APK and Recompile
Inject debuggable flag into manifest, patch a check in smali, rebuild the APK, and sign it:
> "Read the manifest of the decompiled APK folder. Add the `android:debuggable="true"` attribute and recompile using `apktool_patch_and_rebuild`."

### D. Intercept Encryption Keys
Listen dynamically in memory to cryptographic API endpoints and extract encryption keys:
> "Inject the crypto tracer hooks into `com.insecure.bank` and show me the raw AES keys generated during login."

---

## 📊 Performance Statistics
Run `token_stats` at any point to view optimization charts:
```
┌────────────────────────────────────────────────┐
│             MCP OPTIMIZATION METRICS           │
├───────────────────────┬────────────────────────┤
│ Total Calls Evaluated │ 83                     │
│ Raw Bytes Processed   │ 2.4 MB                 │
│ LLM Context Saved     │ 1,840,000 tokens       │
│ Compression Ratio     │ 88.4%                  │
└───────────────────────┴────────────────────────┘
```

---

## 🛡️ Security Disclaimer
This tool is intended **strictly** for authorized security research, application auditing, and bug bounty evaluations. Any usage of this software against targets without explicit consent is illegal. The author assumes no liability for damages resulting from misuse.

## 📄 License
Licensed under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/Wael-Rd">Wael-Rd</a></sub>
</p>
