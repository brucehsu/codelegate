# Codelegate Desktop

Codelegate is a Tauri 2 desktop app for running coding-agent sessions and repository workflows in one place.  
This repository currently targets **desktop only** (`apps/desktop`).

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
- `apps/desktop`: Desktop app (React + Vite frontend, Tauri + Rust backend)
- `apps/desktop/src`: Frontend UI and app logic (CSS Modules)
- `apps/desktop/src-tauri`: Backend commands, permissions, and Tauri config
- `packages/shared`: Shared TypeScript utilities/icons
- `.github/workflows/desktop-build.yml`: CI workflow that verifies desktop build

## Prerequisites
- Node.js 20+
- `pnpm`
- Rust stable toolchain
- On Linux, Tauri system dependencies (WebKitGTK/GTK stack) are required for desktop builds.

## Command Reference
Workspace-level scripts (`package.json`):

| Command | Purpose |
| --- | --- |
| `pnpm build` | Run root TypeScript build (`tsc -b`). |
| `pnpm build:desktop` | Build desktop frontend (`@codelegate/desktop`). |
| `pnpm build:website` | Build website app workspace (if present). |
| `pnpm clean` | Clean TypeScript build artifacts (`tsc -b --clean`). |
| `pnpm dev:desktop` | Start desktop frontend Vite dev server. |
| `pnpm dev:website` | Start website dev server (if present). |
| `pnpm tauri:desktop <args>` | Run Tauri CLI in desktop workspace. |
| `pnpm typecheck` | Typecheck all workspaces via TS project references. |

Desktop workspace scripts (`apps/desktop/package.json`):

| Command | Purpose |
| --- | --- |
| `pnpm --filter @codelegate/desktop dev` | Start Vite dev server for desktop UI. |
| `pnpm --filter @codelegate/desktop build` | Typecheck desktop TS + build frontend assets. |
| `pnpm --filter @codelegate/desktop preview` | Preview built desktop frontend assets. |
| `pnpm --filter @codelegate/desktop tauri <args>` | Run Tauri CLI directly in desktop workspace. |
| `pnpm --filter @codelegate/desktop typecheck` | Typecheck desktop workspace only. |

Common desktop workflows:

1. Install dependencies:

```bash
pnpm install
```

2. Run full desktop app (Tauri + Vite):

```bash
pnpm tauri:desktop dev
```

3. Run frontend only:

```bash
pnpm dev:desktop
```

4. Typecheck:

```bash
pnpm typecheck
```

5. Frontend desktop build:

```bash
pnpm build:desktop
```

6. Full desktop app build (bundle enabled):

```bash
pnpm tauri:desktop build
```

7. App-only macOS bundle (skip DMG):

```bash
pnpm --filter @codelegate/desktop tauri build --bundles app
```

8. CI-style backend compile check without packaging:

```bash
pnpm --filter @codelegate/desktop tauri build --no-bundle
```

## App Icon (Desktop Bundle)
- Icon source image: `apps/desktop/src-tauri/icons/icon.png`.
- Generate platform icon assets after icon changes:

```bash
pnpm --filter @codelegate/desktop tauri icon src-tauri/icons/icon.png
```

- `apps/desktop/src-tauri/tauri.conf.json` must include `bundle.icon` entries (including `icons/icon.icns` for macOS).
- For release verification on macOS, build a bundled app (`pnpm tauri:desktop build` or `pnpm --filter @codelegate/desktop tauri build --bundles app`).
- `--no-bundle` only verifies compile and does not produce packaged app icon metadata/resources.

## CI Integration
- Workflow file: `.github/workflows/desktop-build.yml`
- Triggers:
  - `pull_request`
  - `push` on `main`
  - `workflow_dispatch` (manual run)
- Runner: `ubuntu-24.04`
- CI pipeline steps:
  1. Checkout repository (`actions/checkout@v4`)
  2. Setup pnpm (`pnpm/action-setup@v4`, version 9)
  3. Setup Node.js (`actions/setup-node@v4`, node 20, pnpm cache)
  4. Setup Rust (`dtolnay/rust-toolchain@stable`)
  5. Install Linux Tauri dependencies (`apt-get` packages for GTK/WebKit and bundling tools)
  6. Install dependencies: `pnpm install --frozen-lockfile`
  7. Typecheck: `pnpm typecheck`
  8. Build desktop frontend: `pnpm build:desktop`
  9. Build desktop app without bundle: `pnpm --filter @codelegate/desktop tauri build --no-bundle`

Core CI verification commands:

```bash
pnpm typecheck
pnpm build:desktop
pnpm --filter @codelegate/desktop tauri build --no-bundle
```

## Data Locations
- Settings: `~/.codelegate/config.json`
  - Recent directories are stored under `settings.recentDirs`.
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`
