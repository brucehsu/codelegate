---
title: "Release Notes - v1.1.0"
date: 2026-04-05
summary: "Rewrote the Git backend and rendering logic for significantly faster response times, plus several terminal usability improvements."
tag: Release
---

# v1.1.0

After a few weeks of dogfooding Codelegate at work every day, a couple of terminal paper cuts surfaced - and while mitigating a database incident I hit a much bigger problem: the Git subsystem ground to a halt on the large changeset involved. This release is primarily about fixing that by rebuilding the Git subsystem from the ground up.

[Download Codelegate v1.1.0 here](https://github.com/brucehsu/codelegate/releases/tag/v1.1.0)

## Git Subsystem Rewrite

The previous implementation shelled out to `git` and tried to read and render **every** diff upfront. With a large number of changed files or a single massive diff, that meant runaway memory and CPU usage - often enough to freeze the whole app.

The new backend is written against the Rust-native `git2` library while keeping the UI and UX unchanged. File diffs are now fetched lazily and asynchronously so the interface stays responsive, and `@tanstack/react-virtual` handles the heavy lifting for rendering large changesets.

A few related quality-of-life tweaks came along for the ride: only the first 10 files auto-expand when you open the Git pane, files with excessive changes stay collapsed by default, and syntax highlighting is skipped for very large files.

## Terminal Improvements

- **Scroll position memory**: switching sessions no longer loses your place in the scrollback.
- **Selection fix**: terminal text selection was being dropped on state updates; this is now preserved.
- Switched to the default xterm.js renderer, which simplifies the rendering pipeline and fixes incorrect font rendering.
