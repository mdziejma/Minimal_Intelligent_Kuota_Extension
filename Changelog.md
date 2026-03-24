# Changelog

All notable changes to the "Minimal Intelligent Kuota Extension" (MIKE-Quota) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-03-24

### Critical Fix: Antigravity 1.20.6 Quota Siphon
This release addresses a critical issue where the extension inadvertently triggered "active usage" billing cycles in the background on Antigravity Version 1.20.6, leading to rapid quota depletion and account lockouts (the 80-hour/126-hour bug) for Gemini 3.1 Pro tier users. 

### Changed
* **Switched to Event-Driven Fetching:** Removed the hardcoded 60-second `setInterval` polling loop. The extension now relies strictly on localized IDE events (`onDidSaveTextDocument`, `onDidChangeWindowState`) to trigger UI updates.
* **Implemented Strict Throttling:** Added a hard 10-minute `FETCH_COOLDOWN` constraint to ensure background events do not spam the Language Server.
* **Endpoint Optimization:** Transitioned the primary data source exclusively to `/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigData`. This endpoint strictly reads the localized Language Server cache. 

### Removed
* **Removed Cloud Heartbeat Fallback:** Eliminated the `/exa.language_server_pb.LanguageServerService/GetUserStatus` API call. In the Antigravity 1.20.6 architecture, this endpoint forced a round-trip cloud handshake that registered as billable usage. Removing this guarantees the extension operates as a 100% passive local observer.
