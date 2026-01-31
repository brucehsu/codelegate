# codelegate
Monorepo for Codelegate, the multi-platform, multi-paradigm coding agent manager.

## Layout
- `apps/desktop`: Tauri 2 desktop app (TypeScript frontend + Rust backend).
- `apps/`: Reserved for future app targets (server, android, etc.).
- `packages/shared`: Shared TypeScript utilities for all platforms.

## Workspace
This repo uses pnpm workspaces with `apps/*` and `packages/*`. Add new targets
under `apps/` and shared libs under `packages/` when ready.

## Desktop dev
- `pnpm install`
- `pnpm --filter @codelegate/desktop tauri dev`
