# Desktop App (Tauri 2)
TypeScript frontend + Rust backend using Tauri 2.

## Structure
- `src/`: Frontend (Vite + TypeScript).
- `src-tauri/`: Tauri backend (Rust) and configuration.

## Notes
- Run `pnpm --filter @codelegate/desktop dev` to start Vite.
- Run `pnpm --filter @codelegate/desktop tauri dev` to launch the desktop app.
- Add app icons in `src-tauri/icons` before bundling for release.
- Session config is stored locally in `~/.codelegate/config.json`.
