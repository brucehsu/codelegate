# Claude Project Guide (Codelegate Desktop)

This repository is **desktop-only**. Treat `apps/desktop` as the primary product.

The app is Electron: React + Vite renderer, TypeScript main process, and one Rust N-API addon for PTY sessions and libgit2 diff/status.

## Where to Work
- Renderer UI and app logic: `apps/desktop/src`
- Renderer bridge to the main process: `apps/desktop/src/platform` (`api`, `isMac`); never import `electron` from `src/`
- Styles: CSS Modules next to components; shared tokens in `apps/desktop/src/styles/tokens.css`
- Main process: `apps/desktop/electron/main` (window, menu, lifecycle, `app://` protocol, `ipc/` handlers)
- Preload bridge: `apps/desktop/electron/preload/index.ts`
- Shared contract: `apps/desktop/electron/shared/{api.d.ts,channels.ts,types.ts}`
- Rust addon: `apps/desktop/native/src/{lib.rs,pty.rs,git.rs}`
- Packaging: `apps/desktop/electron-builder.yml`
- App icons/assets:
  - Bundle icons: `apps/desktop/build/icon.icns` and `apps/desktop/build/icon.png`
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
- Restored sessions: `~/.codelegate/previous_sessions.json`
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`

## Development Commands
- `pnpm install`
- `pnpm --filter @codelegate/desktop native:build` (once, and after any Rust change)
- `pnpm dev:desktop`
- `pnpm typecheck`
- `pnpm test:desktop`
- `pnpm --filter @codelegate/desktop native:test`
- `pnpm build:desktop`
- `pnpm --filter @codelegate/desktop smoke`
- `pnpm package:desktop`

## Prerequisites
- Node 24 (`.node-version`), pnpm 11, Rust stable
- Linux packaging also needs `rpm`

## CI
- Desktop build verification workflow: `.github/workflows/desktop-build.yml`
- Release workflow: `.github/workflows/desktop-release.yml`

## Safe Defaults
- Keep changes scoped; avoid broad refactors unless requested.
- Use **pnpm** (not npm/yarn).
- Keep UI copy concise and consistent with current tone.
- When adding a new IPC method:
  - Declare it in `apps/desktop/electron/shared/api.d.ts` and add its channel to `channels.ts`
  - Implement the handler in `apps/desktop/electron/main/ipc/*.ts` and register it in `register.ts`
  - Add a `#[napi]` export in `apps/desktop/native/src/lib.rs` if it needs Rust, then rebuild and commit `native/index.d.ts`
  - Expose it in `apps/desktop/electron/preload/index.ts` and call it as `api.yourMethod(...)` from the renderer
