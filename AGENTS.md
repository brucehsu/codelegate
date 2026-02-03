# Agent Notes (Desktop Only)

This repository currently targets **desktop only**. Treat `apps/desktop` as the primary product.

## Key Paths
- `apps/desktop/src`: React UI, CSS Modules, app logic.
- `apps/desktop/src-tauri`: Rust backend, Tauri commands/permissions.
- `packages/shared`: Shared TS utilities.

## Data Locations
- Settings: `~/.codelegate/config.json`
- Recent directories are stored under `settings.recentDirs` in the settings file.
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`

## Conventions
- Use **pnpm** (not npm/yarn).
- UI styles are **CSS Modules**; prefer existing tokens in `apps/desktop/src/styles/tokens.css`.
- Keep UI copy concise and consistent with existing tone.
- When adding a new Tauri command:
  - Implement in `apps/desktop/src-tauri/src/lib.rs`.
  - Register in the `invoke_handler!` list.
  - Add to `apps/desktop/src-tauri/permissions/app.toml`.

## Common Commands
- Install: `pnpm install`
- Run desktop (Tauri): `pnpm tauri:desktop dev`
- Frontend only: `pnpm dev:desktop`
- Typecheck: `pnpm typecheck`

## Release/Build
- `pnpm build:desktop`
- `pnpm tauri:desktop build`
