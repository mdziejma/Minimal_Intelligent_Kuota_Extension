# M.I.K.E. Quota
**Minimal Intelligent Kuota Extension**

<p align="center">
  <img src="https://raw.githubusercontent.com/mdziejma/Minimal_Intelligent_Kuota_Extension/main/MIKE-Quota.png" width="160" alt="M.I.K.E. Logo">
</p>

<p align="left">
  <a href="https://marketplace.visualstudio.com/items?itemName=mdzie.minimal-intelligent-kuota-extension"><img src="https://img.shields.io/visual-studio-marketplace/v/mdzie.minimal-intelligent-kuota-extension?style=flat-square&label=VS%20Marketplace&logo=visual-studio-code" alt="VS Marketplace Version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mdzie.minimal-intelligent-kuota-extension"><img src="https://img.shields.io/visual-studio-marketplace/d/mdzie.minimal-intelligent-kuota-extension?style=flat-square&label=Marketplace%20Downloads" alt="VS Marketplace Downloads" /></a>
  <a href="https://open-vsx.org/extension/mdzie/minimal-intelligent-kuota-extension"><img src="https://img.shields.io/open-vsx/v/mdzie/minimal-intelligent-kuota-extension?style=flat-square&label=Open%20VSX" alt="Open VSX Version" /></a>
  <a href="https://open-vsx.org/extension/mdzie/minimal-intelligent-kuota-extension"><img src="https://img.shields.io/open-vsx/dt/mdzie/minimal-intelligent-kuota-extension?style=flat-square&label=Open%20VSX%20Downloads&color=orange" alt="Open VSX Downloads" /></a>
  <img src="https://img.shields.io/badge/telemetry-ZERO-success.svg?style=flat-square" alt="Telemetry" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg?style=flat-square" alt="Platform" />
</p>

M.I.K.E. is a local, zero-telemetry extension for Antigravity that tracks your AI quota in the status bar. It intercepts local traffic to display real-time usage without sending data to external servers.

---

### ✨ Key Features
- **Dynamic Tracking:** Automatically tracks whichever model is currently selected/active in your editor settings (`Gemini 3.5 Flash`, `Gemini 3.1 Pro`, `Claude Sonnet`, etc.).
- **Passive Monitoring:** Monitors all local quotas strictly through local IDE events with zero background pings or billable cloud heartbeats.
- **Stealth Integration:** Auto-detects Language Server ports and CSRF tokens locally—no API keys required.
- **Smart Displays:** Real-time `H:MM` countdowns and automatic HSL color shifting (Green → Red).
- **Visual Analytics:** Built-in glassmorphic usage history plots to visualize consumption over time.
- **Critical Alerts:** Status bar turns red and fires notifications when quota drops below 15%.

---

### 🚀 Quick Start
1. **From Marketplace:** Search for "MIKE" in the Antigravity Extensions view and hit **Install**.
2. **From VSIX:** Download from [Releases](https://github.com/mdziejma/Minimal_Intelligent_Kuota_Extension/releases), go to Extensions → `...` → **Install from VSIX**.

---

### 🛠️ How It Works
M.I.K.E. operates as a 100% passive observer. On activation, it finds the local Language Server process, identifies its listening port, and fetches quota stats via the local `/RetrieveUserQuotaSummary` and `/GetCascadeModelConfigData` endpoints. 

To ensure zero "active usage" billing, data is **only** fetched on local IDE events (`onDidSaveTextDocument`, `onDidChangeWindowState`) subject to a hard **10-minute cooldown**. It never reaches out to the cloud.

---

### ⚙️ Details
| Command | Action |
| :--- | :--- |
| `mikeQuota.refresh` | Manual data refresh (bypasses cooldown) |
| `mikeQuota.showPlot` | Open interactive usage visualization |
| `mikeQuota.clearHistory` | Reset local history database |

---

Distributed under the MIT License. See `LICENSE` for more.
**MIKE: Watching your quota, so you don't have to.**
