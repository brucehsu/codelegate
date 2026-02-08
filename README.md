# Codelegate Desktop

Codelegate is a Tauri 2 desktop app for running coding-agent sessions and repository workflows in one place.  
This repository currently targets **desktop only** (`apps/desktop`).

## Features
- Multi-session workspace grouped by repository, with sidebar search and quick switching.
- New Session dialog with:
  - Agent selection (`Claude Code` or `Codex CLI`)
  - Repository picker + recent directories
  - Optional Git worktree mode
  - Optional environment variables
  - Optional pre-agent setup commands
- Per-session panes:
  - **Agent** terminal
  - **Git** pane with staged/unstaged/untracked diff view, syntax highlighting, commit/amend, and bulk stage/unstage/discard actions
  - **Terminal** pane
- Session lifecycle flows:
  - Rename branch
  - Terminate session
  - Close confirmation with optional "remember sessions" restore behavior
- Settings currently exposed in UI:
  - Terminal font family
  - Terminal font size
  - Shortcut modifier key
  - Battery saver (reduced animation)
  - Per-agent CLI args

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

## Development
Install dependencies:

```bash
pnpm install
```

Run desktop app (Tauri + Vite):

```bash
pnpm tauri:desktop dev
```

Run frontend only:

```bash
pnpm dev:desktop
```

Typecheck:

```bash
pnpm typecheck
```

## Build and Verification
Frontend desktop build:

```bash
pnpm build:desktop
```

Full desktop app build:

```bash
pnpm tauri:desktop build
```

CI-style backend compile check without packaging:

```bash
pnpm --filter @codelegate/desktop tauri build --no-bundle
```

## Data Locations
- Settings: `~/.codelegate/config.json`
  - Recent directories are stored under `settings.recentDirs`.
- Worktrees: `~/.codelegate/worktrees/<repo-slug>/<timestamp>-<agent>`
