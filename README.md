# M.I.K.E. Quota
**Minimal Intelligent Kuota Extension**

<p align="center">
  <img src="MIKE-Quota.png" width="160" alt="M.I.K.E. Logo">
</p>

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Telemetry](https://img.shields.io/badge/telemetry-ZERO-success.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)

M.I.K.E. is a local, zero-telemetry extension for Antigravity that tracks your AI quota in the status bar. It intercepts local traffic to display real-time usage without sending data to external servers.

---

### ✨ Key Features
- **Passive Monitoring:** Tracks **Pro**, **Flash**, and **External** (Claude/GPT) quotas with zero background pings.
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
M.I.K.E. operates as a 100% passive observer. On activation, it finds the local Language Server process, identifies its listening port, and fetches quota stats via the local `/GetCascadeModelConfigData` endpoint. 

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
