# Desktop App (Tauri 2)
TypeScript frontend + Rust backend using Tauri 2.

## Structure
- `src/`: Frontend (Vite + TypeScript).
- `src-tauri/`: Tauri backend (Rust) and configuration.

## Desktop Commands
- `pnpm --filter @codelegate/desktop dev`: start Vite frontend dev server.
- `pnpm --filter @codelegate/desktop tauri dev`: run full desktop app in development.
- `pnpm --filter @codelegate/desktop build`: typecheck + build desktop frontend.
- `pnpm --filter @codelegate/desktop preview`: preview built frontend assets.
- `pnpm --filter @codelegate/desktop tauri build`: produce desktop release build.
- `pnpm --filter @codelegate/desktop tauri build --no-bundle`: compile-check Tauri backend without packaging.
- `pnpm --filter @codelegate/desktop typecheck`: typecheck desktop workspace.

Root command wrappers:
- `pnpm dev:desktop`
- `pnpm build:desktop`
- `pnpm tauri:desktop <args>`

## App Icon
- Source icon: `src-tauri/icons/icon.png`
- After icon updates, regenerate all platform icon outputs:

```bash
pnpm --filter @codelegate/desktop tauri icon src-tauri/icons/icon.png
```

- Keep `src-tauri/tauri.conf.json` `bundle.icon` in sync so macOS bundles include `icons/icon.icns`.

## CI
- CI workflow (repo root): `.github/workflows/desktop-build.yml`
- Main CI verification command sequence:
  1. `pnpm typecheck`
  2. `pnpm build:desktop`
  3. `pnpm --filter @codelegate/desktop tauri build --no-bundle`

## Local Data
- Session config is stored locally in `~/.codelegate/config.json`.
