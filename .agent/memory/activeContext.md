# M.I.K.E. — Active Context

## Project Overview
**Minimal Intelligent Kuota Extension** — a zero-telemetry VS Code extension that tracks Antigravity AI agent quota usage in real time via the status bar.

## Architecture
- **Language:** TypeScript
- **Bundler:** esbuild → `dist/extension.js`
- **Package Manager:** npm
- **Distribution:** `.vsix` file (manual install or Open VSX)
- **Activation:** `onStartupFinished`

## Core Mechanism
1. Discovers the local Language Server process via `ps aux`
2. Extracts PID + CSRF token from process arguments
3. Resolves the loopback port via `lsof`
4. POSTs to local HTTPS endpoints (`GetCascadeModelConfigData`, `GetUserStatus`)
5. Categorizes models into **Pro**, **Flash**, **External**
6. Renders 3 status bar items with HSL-gradient color, live countdowns, and alert thresholds

## Current State
- **Version:** 0.1.0
- **Status:** Ready for initial publish
- **Publisher:** mdzie
