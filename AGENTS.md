# Agent Notes (Desktop Only)

This repository currently targets **desktop only**. Treat `apps/desktop` as the primary product.

The app is Electron: React + Vite renderer, TypeScript main process, and one Rust N-API addon for PTY sessions and libgit2 diff/status.

## Key Paths
- `apps/desktop/src`: React UI, CSS Modules, app logic. Never imports `electron`.
- `apps/desktop/src/platform`: The renderer's only bridge to the main process (`api`, `isMac`).
- `apps/desktop/electron/main`: Main process, including `ipc/` handlers.
- `apps/desktop/electron/preload`: `contextBridge` surface and PTY `MessagePort` handoff.
- `apps/desktop/electron/shared`: Domain types, `CodelegateApi`, IPC channel constants.
- `apps/desktop/native`: Rust addon (`src/pty.rs`, `src/git.rs`, `src/lib.rs`, checked-in `index.d.ts`).
- `apps/desktop/build`: Packaging resources (`icon.icns`, `icon.png`, `entitlements.mac.plist`).
- `apps/desktop/electron-builder.yml`: Packaging configuration.
- `packages/shared`: Shared TS utilities/icons.
- `apps/desktop/src/assets/logo.png`: UI logo asset.

## Current App Scope
- Multi-session workspace with repo grouping and search.
- Per-session panes: Agent, Git, Terminal.
- Git pane supports staged/unstaged/untracked diffs, commit/amend, and bulk actions.
- Optional worktree-based session startup.
- Close flow supports optional session restore on next launch.

## Data Locations
- Settings: `~/.codelegate/config.json`
- Recent directories are stored under `settings.recentDirs` in the settings file.
- Restored sessions: `~/.codelegate/previous_sessions.json`
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`

## Conventions
- Use **pnpm** (not npm/yarn).
- UI styles are **CSS Modules**; prefer existing tokens in `apps/desktop/src/styles/tokens.css`.
- Keep UI copy concise and consistent with existing tone.
- Renderer code reaches the main process only through `src/platform`. Do not import `electron` from `src/`.
- PTY output and keystrokes ride a dedicated `MessagePort`, not `ipcRenderer`. Flow control lives in Rust.
- When adding a new IPC method:
  - Declare it in `apps/desktop/electron/shared/api.d.ts` and add its channel to `channels.ts`.
  - Implement the handler in `apps/desktop/electron/main/ipc/*.ts` and register it in `register.ts`.
  - If it needs Rust, add a `#[napi]` export in `apps/desktop/native/src/lib.rs`, rebuild the addon, and commit the regenerated `native/index.d.ts`.
  - Expose it in `apps/desktop/electron/preload/index.ts`, then call `api.yourMethod(...)` from the renderer.

## Common Commands
- Install: `pnpm install`
- Build the native addon (once, and after any Rust change): `pnpm --filter @codelegate/desktop native:build`
- Run desktop: `pnpm dev:desktop`
- Typecheck: `pnpm typecheck`
- Test: `pnpm test:desktop` and `pnpm --filter @codelegate/desktop native:test`

## Release/Build
- `pnpm build:desktop` (renderer + preload + main into `apps/desktop/out`)
- `pnpm --filter @codelegate/desktop smoke` (headless main-process check against `out/`)
- `pnpm package:desktop` (installers into `apps/desktop/release`)
- Release version lives in `apps/desktop/package.json`; the `v*` tag must match it.

## CI
- GitHub Actions build verification: `.github/workflows/desktop-build.yml`
- Release: `.github/workflows/desktop-release.yml`
