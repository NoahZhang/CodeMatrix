# CodeMatrix

Tauri v2 desktop app — React 19 frontend, Rust backend. Published for **macOS and Linux only** (no Windows).

## Stack

- **Frontend:** React 19, TypeScript (strict), Vite, Zustand + immer
- **Backend:** Rust (Tauri v2, portable-pty, axum)
- **Package manager:** npm

## Commands

- `npm run tauri:dev` — start Tauri app in dev mode (frontend hot-reload + Rust rebuild)
- `npm run tauri:build` — build production app (macOS .dmg, Linux .appimage/.deb)
- `npm run typecheck` — run TypeScript type checking
- `npm run build:remote` — build mobile remote UI to `dist-remote/`

## Project Structure

- `src/` — React frontend (components, store, IPC, lib)
- `src/lib/` — frontend utilities (IPC wrappers, window management, drag, zoom)
- `src/store/` — Zustand app state management (immer middleware)
- `src/remote/` — Mobile remote UI (separate Vite build)
- `src-tauri/` — Rust backend (Tauri v2; see `src-tauri/README.md`)
- `src-tauri/src/` — Rust modules: pty, git, tasks, agents, plans, remote, persistence, validate

## Conventions

- Functional components only (React hooks, no classes)
- Tauri IPC for all frontend-backend communication
- IPC channel names defined in `src/lib/channels.ts` (shared enum)
- Frontend calls Rust via `invoke()` from `src/lib/ipc.ts`
- Streaming data (PTY output) uses Channel pattern over Tauri events
- `strict: true` TypeScript, no `any`
