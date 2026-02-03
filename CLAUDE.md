# Claude Project Guide (Codelegate Desktop)

This repo is **desktop-only** right now. Assume all work targets `apps/desktop` unless explicitly stated otherwise.

## Where to Work
- UI: `apps/desktop/src`
- Styles: CSS Modules next to components; shared tokens in `apps/desktop/src/styles/tokens.css`
- Backend: `apps/desktop/src-tauri/src/lib.rs`

## Data Locations
- Settings: `~/.codelegate/config.json`
- Recent directories are stored under `settings.recentDirs` in the settings file.
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`

## Development Commands
- `pnpm install`
- `pnpm tauri:desktop dev` (recommended for full desktop experience)
- `pnpm dev:desktop` (frontend only)
- `pnpm typecheck`

## Safe Defaults
- Keep changes scoped; avoid broad refactors unless requested.
- When touching Tauri commands, update permissions in `apps/desktop/src-tauri/permissions/app.toml`.
- Prefer clear, minimal UI copy.
