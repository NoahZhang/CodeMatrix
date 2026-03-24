# CodeMatrix — Rust Backend

Tauri v2 backend for the CodeMatrix desktop app, supporting macOS and Linux.

## Core Capabilities

### Terminal & Agent Management

Spawn and manage multiple PTY sessions simultaneously. Each AI coding agent (Claude Code, Codex CLI, Gemini CLI, Aider, Amp) runs in its own pseudo-terminal with full I/O control — input, output streaming, resize, pause/resume, and graceful shutdown. Output is batched and base64-encoded for efficient transfer to the frontend, with 64KB scrollback per session.

Installed agents are auto-detected on startup and cached, so the frontend always knows which CLIs are available.

### Git Isolation

Every task gets its own git worktree and branch, created automatically from the main branch. This means multiple agents can work on the same repo at the same time without conflicts. Gitignored directories like `node_modules` are symlinked into each worktree to avoid redundant installs.

Merging back to main is serialized with a lock to prevent concurrent merge conflicts. The backend also handles rebase, push, commit, discard, diff, and branch detection.

### Remote Access

A built-in HTTP + WebSocket server lets you monitor and control all running agents from your phone or tablet. Authentication uses a secure random token (displayed as a QR code in the app). The server streams real-time terminal output and accepts input from remote clients, serving the mobile UI as static files.

### Arena Mode

Competitive benchmarking mode: multiple agents race to solve the same prompt in isolated worktrees. The backend handles worktree creation and cleanup for each competitor.

### Plan File Watching

The backend watches `.plans/` directories inside worktrees for changes. When an agent writes a plan file (`.md`, `.txt`, `.plan`), the content is emitted to the frontend in real-time.

### State Persistence

App state (projects, tasks, settings, window geometry) and arena data are persisted as JSON to the OS data directory. Writes are atomic (temp file + rename) to prevent corruption.

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/com.code-matrix.app/` |
| Linux | `~/.local/share/com.code-matrix.app/` |

## Development

**Prerequisites:** Rust toolchain (stable), Node.js 18+, npm

```bash
# Dev mode (frontend hot-reload + Rust rebuild on change)
npm run tauri:dev

# Production build (macOS .dmg, Linux .appimage/.deb)
npm run tauri:build

# Rust only — type check
cd src-tauri && cargo check

# Rust only — build
cd src-tauri && cargo build
```

## Acknowledgments

This project is based on [Parallel Code](https://github.com/johannesjo/parallel-code) by johannesjo, licensed under the [MIT License](https://github.com/johannesjo/parallel-code/blob/main/LICENSE).
