# M.I.K.E.
**Minimal Intelligent Kuota Extension**

<p align="center">
  <img src="MIKE-Quota.png" width="200" alt="M.I.K.E. Logo">
</p>

![Version](https://img.shields.io/badge/version-0.1.5-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Telemetry](https://img.shields.io/badge/telemetry-ZERO-success.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)

M.I.K.E. is an ultra-lightweight, zero-telemetry extension for Antigravity (and compatible VS Code forks) that tracks your local AI agent quota in real time.

No dashboards. No bloated UI. No sending your usage data to third-party servers. Just clean, real-time percentages sitting quietly in your status bar.

## ⚠️ Why This Exists

With recent updates, AI IDE agents can burn through expensive token quotas in the background. Existing marketplace solutions to track this are often bloated, obfuscated, or require sending your IDE telemetry to external servers.

M.I.K.E. was built to do one thing securely: intercept the IDE's local language server traffic to display your remaining quota.

## ✨ Features

- **Zero Telemetry:** 100% of the processing happens locally on your machine. It never makes an external network request.
- **Multi-Model Tracking:** Simultaneously monitors **Pro**, **Flash**, and **External** (Claude/GPT) quotas, each with its own status bar item.
- **Stealth Polling:** Piggybacks on the native Language Server endpoints on `127.0.0.1` — no external API keys or credentials required.
- **Port & Token Auto-Discovery:** Automatically detects the Language Server process, its port, and CSRF token. No manual configuration needed.
- **Live Countdown Timers:** Each status bar item shows a real-time `H:MM:SS` countdown until quota reset.
- **Usage History Plot:** Beautiful, glassmorphic line charts show your quota usage over time for each model category.
- **Smooth Color Gradient:** Status bar colors shift continuously from green (100%) → yellow (50%) → red (0%) using HSL mapping.

- **Critical Alerts:** Background turns red and a warning notification fires when any quota drops to ≤ 15%.
- **Health Checks:** Indicates if the Language Server is offline or a model is not configured.

### Option A: Antigravity Marketplace (Easiest)
1. Open Antigravity.
2. Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **"Minimal Intelligent Kuota Extension"** or **"MIKE"**.
4. Click **Install**.

### Option B: Manual VSIX Installation
1. Download the latest `.vsix` from the [Releases](https://github.com/mdziejma/Minimal_Intelligent_Kuota_Extension/releases) page.
2. Open Antigravity (or VS Code).
3. Go to the Extensions view.
4. Click the `...` at the top right of the panel and select **Install from VSIX…**
5. Select the downloaded file.

### Option C: Build from Source
1. Clone this repository.
2. Run `npm install` to install dependencies.
3. Run `npm run compile` to build.
4. Run `npm run package` to create the `.vsix` file.
5. Install the `.vsix` via Extensions → `...` → **Install from VSIX…**

## ⚙️ Configuration

M.I.K.E. works out of the box with zero configuration across **macOS** and **Windows**. It auto-detects the Language Server process, its listening port, and CSRF token at runtime.

| Setting | Description | Default |
| :--- | :--- | :--- |
| `mikeQuota.refresh` | Command to manually refresh quota data. | — |
| `mikeQuota.showPlot` | Opens the usage history plot visualization. | — |


## 🛠️ How It Works

1. **Process Discovery:** On activation, M.I.K.E. uses platform-specific commands (`ps aux` on macOS/Linux, `Get-WmiObject` on Windows) to locate the running Language Server process and extracts its PID and `--csrf_token` from the command line arguments.
2. **Port Detection:** It then uses `lsof` (macOS/Linux) or `netstat` (Windows) to find the `127.0.0.1` loopback port the Language Server is listening on.
3. **Data Fetch:** A `POST` request is sent to two local HTTPS endpoints:
   - `GetCascadeModelConfigData` — primary source of model quota info.
   - `GetUserStatus` — fallback source for additional models.
4. **Categorization:** The returned model configs are matched by label (e.g., `Gemini 3.1 Pro`, `Gemini 3 Flash`, `Claude`/`GPT`) and their `quotaInfo.remainingFraction` is extracted.
5. **Display:** Three separate status bar items are updated every second with live countdown timers, and fresh data is fetched from the server every 60 seconds.

## 🚢 Deployment (to Antigravity Marketplace)

This extension is published to the **Open VSX Registry**, which powers the marketplace in Antigravity.

1.  **Get a Token:** Create an account at [open-vsx.org](https://open-vsx.org/) and generate a Personal Access Token.
2.  **Publish:** Run the following command (replacing `YOUR_TOKEN`):
    ```bash
    npm run deploy -- --pat YOUR_TOKEN
    ```

## 🤝 Contributing

Since this is a minimalist tool, feature creep is heavily discouraged. However, pull requests that improve port-detection reliability across different operating systems (Windows/WSL/macOS) are highly welcome.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
