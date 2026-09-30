# Codelegate Desktop

Codelegate is an Electron desktop app for running coding-agent sessions and repository workflows in one place.
This repository currently targets **desktop only** (`apps/desktop`).

The renderer is React + Vite. The main process is TypeScript on Node. PTY sessions and libgit2 diff/status run in a single Rust N-API addon (`apps/desktop/native`) loaded by the main process.

## Desktop Features
- Multi-session workspace grouped by repository, with sidebar search and quick switching.
- New Session flow with agent selection (`Claude Code` or `Codex CLI`), repository picker + recent directories, optional Git worktree mode, optional environment variables, and optional pre-agent setup commands.
- Per-session panes:
  - **Agent** terminal
  - **Git** pane with staged/unstaged/untracked diff view, syntax highlighting, commit/amend, and bulk stage/unstage/discard actions
  - **Terminal** pane
- Session lifecycle actions: rename branch, terminate session, and close confirmation with optional "remember sessions" restore behavior.
- Settings in UI: terminal font family, terminal font size, shortcut modifier key, battery saver (reduced animation), and per-agent CLI args.

## Keyboard Shortcuts
`<Modifier>` defaults to `Alt` and is configurable in Settings.

- `<Modifier> + A` = Agent pane
- `<Modifier> + G` = Git pane
- `<Modifier> + T` = Terminal pane
- `<Modifier> + N` = New session
- `<Modifier> + P` = Settings
- `<Modifier> + R` = Rename active branch
- `<Modifier> + W` = Terminate active session
- `<Modifier> + S` = Focus session search
- `<Modifier> + 1..9` = Select session from current hotkey page
- `<Modifier> + 0` = Next hotkey page
- `Ctrl + Tab` = Cycle sessions

## Repository Layout
- `apps/desktop/src`: Renderer UI and app logic (React, CSS Modules). Never imports `electron`.
- `apps/desktop/src/platform`: The only renderer entry point to the main process (`api`, `isMac`).
- `apps/desktop/electron/main`: Main process (window, menu, lifecycle, `app://` protocol, IPC handlers).
- `apps/desktop/electron/preload`: `contextBridge` surface plus the PTY `MessagePort` handoff.
- `apps/desktop/electron/shared`: Domain types, the `CodelegateApi` interface, and IPC channel constants.
- `apps/desktop/native`: Rust N-API addon (`src/pty.rs`, `src/git.rs`, `src/lib.rs`).
- `apps/desktop/build`: Packaging resources (`icon.icns`, `icon.png`, `entitlements.mac.plist`).
- `apps/desktop/electron-builder.yml`: Packaging configuration.
- `packages/shared`: Shared TypeScript utilities/icons.
- `.github/workflows/desktop-build.yml`: CI workflow that builds and packages the desktop app.
- `.github/workflows/desktop-release.yml`: Release workflow.

## Prerequisites
- Node.js 24 (see `.node-version`)
- pnpm 11 (pinned by `packageManager` in the root `package.json`)
- Rust stable toolchain
- On Linux, `rpm` is required to produce the `.rpm` package (`sudo apt-get install -y rpm`). No GTK or WebKit development packages are needed.

## Command Reference
Workspace-level scripts (`package.json`):

| Command | Purpose |
| --- | --- |
| `pnpm build` | Run root TypeScript build (`tsc -b`). |
| `pnpm build:desktop` | Build renderer, preload, and main into `apps/desktop/out`. |
| `pnpm build:website` | Build website app workspace (if present). |
| `pnpm clean` | Clean TypeScript build artifacts (`tsc -b --clean`). |
| `pnpm dev:desktop` | Start the desktop app in development. |
| `pnpm dev:website` | Start website dev server (if present). |
| `pnpm package:desktop` | Build and package installers for the host platform. |
| `pnpm test:desktop` | Run the desktop unit tests. |
| `pnpm typecheck` | Typecheck all workspaces via TS project references. |

Desktop workspace scripts (`apps/desktop/package.json`):

| Command | Purpose |
| --- | --- |
| `pnpm --filter @codelegate/desktop dev` | Run the app in development (electron-vite). |
| `pnpm --filter @codelegate/desktop build` | Build renderer, preload, and main. |
| `pnpm --filter @codelegate/desktop native:build` | Build the Rust addon in release mode. |
| `pnpm --filter @codelegate/desktop native:build:debug` | Build the Rust addon in debug mode (much faster). |
| `pnpm --filter @codelegate/desktop native:test` | Run the Rust test suite (`cargo test --features noop`). |
| `pnpm --filter @codelegate/desktop test` | Run the desktop unit tests. |
| `pnpm --filter @codelegate/desktop typecheck` | Typecheck the renderer and node projects. |
| `pnpm --filter @codelegate/desktop smoke` | Headless main-process smoke check against a built `out/`. |
| `pnpm --filter @codelegate/desktop package` | Package installers for the host platform. |
| `pnpm --filter @codelegate/desktop package:mac` | Package macOS `.dmg` and `.zip`. |
| `pnpm --filter @codelegate/desktop package:linux` | Package Linux `.AppImage`, `.deb`, and `.rpm`. |

Common desktop workflows:

1. Install dependencies:

```bash
pnpm install
```

2. Build the native addon once (and again whenever `apps/desktop/native` changes):

```bash
pnpm --filter @codelegate/desktop native:build
```

3. Run the app:

```bash
pnpm dev:desktop
```

4. Typecheck:

```bash
pnpm typecheck
```

5. Test:

```bash
pnpm test:desktop
pnpm --filter @codelegate/desktop native:test
```

6. Build without packaging:

```bash
pnpm build:desktop
```

7. Package installers for the host platform:

```bash
pnpm package:desktop
```

Build output goes to `apps/desktop/out`, installers to `apps/desktop/release`. Both are ignored by Git.

## Adding an IPC Method
The renderer never imports `electron`. Every main-process capability goes through four files:

1. Declare the signature in `apps/desktop/electron/shared/api.d.ts` and add the channel name to `apps/desktop/electron/shared/channels.ts`.
2. Implement the handler in the matching `apps/desktop/electron/main/ipc/*.ts` file and register it in `register.ts`. If it needs Rust, add a `#[napi]` export in `apps/desktop/native/src/lib.rs`, rebuild the addon, and check in the regenerated `apps/desktop/native/index.d.ts`.
3. Expose it in `apps/desktop/electron/preload/index.ts`.
4. Call it from the renderer as `api.yourMethod(...)` via `import { api } from "../platform"`.

Shared payload types live in `apps/desktop/electron/shared/types.ts`, which `src/types.ts` and `src/utils/gitDiff.ts` re-export.

## App Icon (Desktop Bundle)
- Icon sources: `apps/desktop/build/icon.png` (512x512, used by Linux and as the master) and `apps/desktop/build/icon.icns` (macOS).
- electron-builder picks both up automatically from `directories.buildResources`.
- After replacing `icon.png`, regenerate `icon.icns` on macOS:

```bash
cd apps/desktop
rm -rf build/Codelegate.iconset && mkdir build/Codelegate.iconset
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" build/icon.png --out "build/Codelegate.iconset/icon_${size}x${size}.png"
  sips -z "$((size * 2))" "$((size * 2))" build/icon.png --out "build/Codelegate.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns build/Codelegate.iconset -o build/icon.icns
rm -rf build/Codelegate.iconset
```

- Verify the result by packaging a real bundle (`pnpm --filter @codelegate/desktop package:mac`) rather than by running the dev app.

## CI Integration
- Workflow file: `.github/workflows/desktop-build.yml`
- Triggers:
  - `pull_request`
  - `push` on `main`
  - `workflow_dispatch` (manual run)
- Runners: `ubuntu-24.04` and `macos-latest`
- CI pipeline steps:
  1. Checkout repository (`actions/checkout@v4`)
  2. Setup pnpm (`pnpm/action-setup@v4`, version taken from `packageManager`)
  3. Setup Node.js (`actions/setup-node@v4`, `node-version-file: .node-version`, pnpm cache)
  4. Setup Rust (`dtolnay/rust-toolchain@stable`) and restore the Cargo cache (`swatinem/rust-cache@v2`)
  5. Install `rpm` on Linux
  6. Install dependencies: `pnpm install --frozen-lockfile`
  7. Rust tests and release build of the native addon
  8. On macOS, verify the addon does not link Homebrew libraries
  9. Unit tests and typecheck
  10. Package installers with `CSC_IDENTITY_AUTO_DISCOVERY=false`
  11. On macOS, verify the packaged app ships the addon under `app.asar.unpacked/native`
  12. On Linux, run the headless smoke check under `xvfb-run`
  13. Upload the packaged artifacts

Core local equivalents:

```bash
pnpm --filter @codelegate/desktop native:test
pnpm --filter @codelegate/desktop native:build
pnpm test:desktop
pnpm typecheck
pnpm package:desktop
```

## Desktop Releases
- Release workflow: `.github/workflows/desktop-release.yml`
- Trigger: push a Git tag matching `v*` such as `v0.1.0`
- Manual run: start the workflow from the Actions tab and provide `release_tag` with the same tag value, such as `v0.1.0`
- The pushed tag must match `version` in `apps/desktop/package.json`
- Runners: `ubuntu-24.04` (x64), `macos-26` (arm64), `macos-26-intel` (x64), one at a time
- Each runner builds the native addon for its own target, packages with electron-builder, and uploads to the same GitHub Release with generated release notes
- macOS bundles are signed with a Developer ID identity, notarized, stapled, and verified with `codesign`, `spctl`, and `stapler validate`
- Linux `.AppImage`, `.deb`, and `.rpm` are built on Ubuntu and published to the same Release

Published assets:

| Asset | Platform |
| --- | --- |
| `Codelegate-<version>-arm64.dmg` / `.zip` | macOS Apple Silicon |
| `Codelegate-<version>-x64.dmg` / `.zip` | macOS Intel |
| `Codelegate-<version>-x86_64.AppImage` | Linux x64 |
| `Codelegate-<version>-amd64.deb` | Linux x64 |
| `Codelegate-<version>-x86_64.rpm` | Linux x64 |

Required GitHub Actions secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` signing certificate exported from Keychain Access. |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` certificate. |
| `KEYCHAIN_PASSWORD` | Password for the temporary macOS keychain created during CI signing. |
| `APPLE_API_KEY` | App Store Connect API Key ID. |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID. |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded contents of `AuthKey_<KEY_ID>.p8`. |

Release steps:

1. Update `version` in `apps/desktop/package.json` to the release version.
2. Commit the version change and push it to the branch you want to release from.
3. Create and push the matching tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

After the tag is pushed, GitHub Actions runs the desktop release workflow on GitHub-hosted macOS and Linux runners, builds the native addon and installers per platform, signs and notarizes the macOS artifacts with the configured Apple credentials, then publishes all generated assets to the GitHub Release page for that tag.

## Data Locations
- Settings: `~/.codelegate/config.json`
  - Recent directories are stored under `settings.recentDirs`.
- Restored sessions: `~/.codelegate/previous_sessions.json`
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`
