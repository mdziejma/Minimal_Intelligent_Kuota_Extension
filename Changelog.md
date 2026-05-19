# Changelog

All notable changes to the "Minimal Intelligent Kuota Extension" (MIKE-Quota) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-05-19

### Added
* **Dynamic Active-Model Selection:** The status bar items now automatically track the quota of whichever model is currently active/selected in the editor settings.
* **All Available Quotas View:** The `showDetails` view now displays a complete list of all 7 available models, their exact quota percentages, reset times, and visually flags the currently active model with a `● [Active]` marker.
* **Support for Gemini 3.5 Flash:** Added complete pattern matching for both Gemini 3.5 Flash (High) and Gemini 3.5 Flash (Medium) models.
* **Support for Gemini 3.1 Pro Tiers:** Properly differentiates between Gemini 3.1 Pro (High) and Gemini 3.1 Pro (Low) tiers.
* **Auto-Fallback to Critical Quotas:** If your active model is in another category, each status bar item automatically tracks the model in its category with the lowest remaining quota, ensuring you are always warned of potential exhaustion.
* **Pre-configured Debug Launchers:** Added `.vscode/launch.json` and `.vscode/tasks.json` to make running and debugging the extension instant with `F5`.

## [2.0.0] - 2026-03-24

### Critical Fix: Antigravity 1.20.6 Quota Siphon
This release addresses a critical issue where the extension inadvertently triggered "active usage" billing cycles in the background on Antigravity Version 1.20.6, leading to rapid quota depletion and account lockouts (the 80-hour/126-hour bug) for Gemini 3.1 Pro tier users. 

### Changed
* **Switched to Event-Driven Fetching:** Removed the hardcoded 60-second `setInterval` polling loop. The extension now relies strictly on localized IDE events (`onDidSaveTextDocument`, `onDidChangeWindowState`) to trigger UI updates.
* **Implemented Strict Throttling:** Added a hard 10-minute `FETCH_COOLDOWN` constraint to ensure background events do not spam the Language Server.
* **Endpoint Optimization:** Transitioned the primary data source exclusively to `/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigData`. This endpoint strictly reads the localized Language Server cache. 

### Removed
* **Removed Cloud Heartbeat Fallback:** Eliminated the `/exa.language_server_pb.LanguageServerService/GetUserStatus` API call. In the Antigravity 1.20.6 architecture, this endpoint forced a round-trip cloud handshake that registered as billable usage. Removing this guarantees the extension operates as a 100% passive local observer.
