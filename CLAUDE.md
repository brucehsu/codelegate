# Claude Project Guide (Codelegate Desktop)

This repository is **desktop-only**. Treat `apps/desktop` as the primary product.

## Where to Work
- Frontend UI and app logic: `apps/desktop/src`
- Styles: CSS Modules next to components; shared tokens in `apps/desktop/src/styles/tokens.css`
- Tauri backend: `apps/desktop/src-tauri/src/lib.rs`
- App icons/assets:
  - Bundle/app icon: `apps/desktop/src-tauri/icons/icon.png`
  - UI logo asset: `apps/desktop/src/assets/logo.png`

## Current App Scope
- Multi-session workspace grouped by repository.
- Agent/Terminal/Git panes per session.
- Git pane supports diff review, commit/amend, and bulk stage/unstage/discard.
- Optional Git worktree session startup.
- Close confirmation with optional session restore on next launch.

## Data Locations
- Settings: `~/.codelegate/config.json`
- Recent directories: `settings.recentDirs`
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`

## Development Commands
- `pnpm install`
- `pnpm tauri:desktop dev` (full desktop app)
- `pnpm dev:desktop` (frontend only)
- `pnpm typecheck`
- `pnpm build:desktop`
- `pnpm tauri:desktop build`
- `pnpm --filter @codelegate/desktop tauri build --no-bundle` (CI-style build verification)

## CI
- Desktop build verification workflow: `.github/workflows/desktop-build.yml`

## Safe Defaults
- Keep changes scoped; avoid broad refactors unless requested.
- Use **pnpm** (not npm/yarn).
- Keep UI copy concise and consistent with current tone.
- When adding a new Tauri command:
  - Implement in `apps/desktop/src-tauri/src/lib.rs`
  - Register it in the `invoke_handler!` list
  - Add permission entries in `apps/desktop/src-tauri/permissions/app.toml`
