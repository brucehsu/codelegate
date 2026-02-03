# Codelegate Desktop

Codelegate is a Tauri-based desktop app for managing coding agents and terminals side-by-side. This repository currently targets **desktop only**.

## What It Does
- **Multi-session workspace** with searchable sidebar and quick switching.
- **Agent + Terminal tabs** per session, with jump-to-latest controls.
- **Git tab** with staged/unstaged/untracked diffs and syntax highlighting.
- **Worktree support** for isolated work on branches.
- **Settings** for theme, terminal font family/size, and battery saver.
- **Keyboard shortcuts** (hold `Alt` to reveal hints):
  - `Alt` + `A` = Agent tab
  - `Alt` + `G` = Git tab
  - `Alt` + `T` = Terminal tab
  - `Alt` + `1–9` = switch sessions

## Repository Layout
- `apps/desktop`: Tauri 2 desktop app (React frontend + Rust backend).
- `packages/shared`: Shared TypeScript utilities.

## Development
Install dependencies:
```bash
pnpm install
```

Run the desktop app (Tauri + Vite):
```bash
pnpm tauri:desktop dev
```

Run the frontend dev server only:
```bash
pnpm dev:desktop
```

Typecheck:
```bash
pnpm typecheck
```

## Notes
- This repo is currently focused on the desktop app only.
- UI uses CSS Modules and design tokens under `apps/desktop/src/styles`.

## Data Locations
- **Settings file:** `~/.codelegate/config.json`
  - Recent directories are stored under `settings.recentDirs`.
- **Worktrees:** `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`
  - `<repo-slug>` is derived from the repo name (sanitized).
  - `<timestamp>` is `YYYYMMDD-HHMM`.
  - `<agent>` is the selected agent id (e.g. `claude`, `codex`).
