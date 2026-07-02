---
title: "Release Notes - v1.3.0"
date: 2026-07-02
summary: "Added an existing-branch picker for worktree sessions and a unified diff view, and fixed a memory blowup when opening the Git pane on repos with huge untracked trees."
tag: Release
---

# v1.3.0

The main changes in this release center on branches and the Git pane. Worktree sessions can now check out an existing branch instead of always creating a new one, the diff view gains a unified mode alongside the existing split layout, and we fixed a memory blowup that could crash the app when opening the Git pane on repos with huge untracked trees.

The remaining changes are focused on making everyday operations smoother:

- Session tabs now keep their branch names up to date when the branch changes outside the app.
- Cmd+click on a link in any terminal pane opens it with your system's default application.

[Download Codelegate v1.3.0 here](https://github.com/brucehsu/codelegate/releases/tag/v1.3.0)

## Check Out an Existing Branch in Worktree Sessions

The New Session dialog now includes a branch picker for worktree sessions. Instead of always starting from an auto-created branch, you can pick any local branch and the session worktree checks it out directly, leaving your original repository checkout untouched. Branches already checked out elsewhere appear disabled and labeled with where they are in use, so the same branch never ends up active in two places.

Session cleanup follows the same rule: removing a worktree session deletes only auto-created branches and preserves the ones you picked yourself. The persisted worktree configuration keeps this behavior consistent across restarts.

## Unified Diff View

The Git pane's diff area now offers a unified view alongside the existing split view, switchable with a Split/Unified toggle next to the diff stats. Unified mode merges both sides into a single column with old and new line numbers in the gutter. It reuses the same syntax highlighting and virtualized rendering as the split view, so large diffs stay fast in either mode.

## Fixing Memory Blowups on Huge Untracked Trees

Opening the Git pane on a repository with large untracked directories (a package store, an embedded database) or oversized files used to read every untracked byte into memory on each scan, and every per-file diff request repeated that full scan. With diff cards auto-opening, this could stack up to roughly twenty concurrent full-repository scans and crash the app.

This release reworks that path:

- Untracked directories are collapsed to a single entry, matching how `git status` presents them, and staged in one operation.
- Untracked file reads are capped at 2 MiB behind a shared gate, binaries are detected from the first 8 KiB, and tracked files over 2 MiB are treated as binary.
- Per-file diff requests are scoped to the file itself instead of rescanning the whole section.
- Diff payloads are capped at 4000 rows, with a notice shown when a diff is truncated.
- Diff cards are materialized lazily as they scroll into view, and concurrent summary loads are coalesced into a single follow-up run.

As a data point, a summary scan of a tree with 20,000 untracked files plus a 286 MB log file now completes in 185 ms with a 29.5 MB peak memory footprint.

## Other Improvements

- **Session branch monitoring**: each session's branch name is refreshed periodically and whenever the window regains focus, so a branch switch made by an agent or in another terminal shows up in the tab without a manual refresh.
- **Cmd+click to open terminal links**: holding Cmd (Ctrl on other platforms) and clicking a URL in any pane opens it with your system's default application. A plain click no longer triggers navigation.
