# Desktop App (Electron)

React + Vite renderer, TypeScript main process, and one Rust N-API addon that owns PTY sessions and libgit2 diff/status.

## Structure
- `src/`: Renderer (React, CSS Modules). Never imports `electron`.
- `src/platform/`: The renderer's only bridge to the main process (`api`, `isMac`, PTY stream).
- `electron/main/`: Main process. Window, menu, lifecycle, `app://` protocol, and `ipc/` handlers.
- `electron/preload/`: `contextBridge` surface plus the PTY `MessagePort` handoff.
- `electron/shared/`: `types.ts`, `api.d.ts` (the `CodelegateApi` contract), `channels.ts`.
- `native/`: Rust addon (`src/lib.rs`, `src/pty.rs`, `src/git.rs`) and the checked-in `index.d.ts`.
- `build/`: Packaging resources (`icon.icns`, `icon.png`, `entitlements.mac.plist`).
- `electron.vite.config.ts`, `electron-builder.yml`, `vitest.config.ts`.

Build output lands in `out/` (renderer, preload, main) and installers in `release/`. Both are ignored by Git.

## Prerequisites
- Node 24 (see `.node-version` at the repo root), pnpm 11, Rust stable.
- Linux packaging additionally needs `rpm` for the `.rpm` target.

## Desktop Commands
- `pnpm --filter @codelegate/desktop native:build`: build the Rust addon in release mode. Run this once after install and again after any change under `native/`.
- `pnpm --filter @codelegate/desktop native:build:debug`: same, debug profile, much faster to iterate on.
- `pnpm --filter @codelegate/desktop native:test`: run the Rust tests (`cargo test --features noop`).
- `pnpm --filter @codelegate/desktop dev`: run the app in development.
- `pnpm --filter @codelegate/desktop build`: build renderer, preload, and main into `out/`.
- `pnpm --filter @codelegate/desktop smoke`: headless main-process check against a built `out/`.
- `pnpm --filter @codelegate/desktop test`: run the unit tests (vitest).
- `pnpm --filter @codelegate/desktop typecheck`: typecheck the renderer and node projects.
- `pnpm --filter @codelegate/desktop package`: package installers for the host platform.
- `pnpm --filter @codelegate/desktop package:mac`: macOS `.dmg` and `.zip`.
- `pnpm --filter @codelegate/desktop package:linux`: Linux `.AppImage`, `.deb`, and `.rpm`.

Root command wrappers:
- `pnpm dev:desktop`
- `pnpm build:desktop`
- `pnpm test:desktop`
- `pnpm package:desktop`

## Adding an IPC Method
1. Add the signature to `electron/shared/api.d.ts` and the channel name to `electron/shared/channels.ts`.
2. Implement the handler in the matching `electron/main/ipc/*.ts` and register it in `electron/main/ipc/register.ts`. If it needs Rust, add a `#[napi]` export in `native/src/lib.rs`, rebuild the addon, and commit the regenerated `native/index.d.ts`.
3. Expose it in `electron/preload/index.ts`.
4. Call it from the renderer as `api.yourMethod(...)` via `import { api } from "../platform"`.

Handlers return `{ ok, value }` or `{ ok: false, error }`; the preload rejects with the plain error string.

## App Icon
- Sources: `build/icon.png` (512x512, Linux and master) and `build/icon.icns` (macOS). electron-builder reads both from `directories.buildResources`.
- After replacing `build/icon.png`, regenerate the `.icns` on macOS:

```bash
rm -rf build/Codelegate.iconset && mkdir build/Codelegate.iconset
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" build/icon.png --out "build/Codelegate.iconset/icon_${size}x${size}.png"
  sips -z "$((size * 2))" "$((size * 2))" build/icon.png --out "build/Codelegate.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns build/Codelegate.iconset -o build/icon.icns
rm -rf build/Codelegate.iconset
```

- Verify with a real bundle (`pnpm --filter @codelegate/desktop package:mac`), not the dev app.

## CI
- Build workflow (repo root): `.github/workflows/desktop-build.yml`
- Release workflow: `.github/workflows/desktop-release.yml`
- Local equivalent of the CI sequence:
  1. `pnpm --filter @codelegate/desktop native:test`
  2. `pnpm --filter @codelegate/desktop native:build`
  3. `pnpm --filter @codelegate/desktop test`
  4. `pnpm typecheck`
  5. `pnpm --filter @codelegate/desktop package`

## Local Data
- Settings: `~/.codelegate/config.json`
- Restored sessions: `~/.codelegate/previous_sessions.json`
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`
