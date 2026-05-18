---
title: "Release Notes - v1.2.0"
date: 2026-05-18
summary: "Redesigned the Git pane with a two-column file-tree layout, added Factory.ai Droid CLI support with agent detection, and smoothed out several everyday workflows."
tag: Release
---

# v1.2.0

The main change in this release is a redesign of the Git pane: instead of a single flat list of files, it now uses a two-column layout with a file tree on the left and the selected file's diff on the right, making it much more intuitive to browse and compare across large changesets. This release also adds support for Factory.ai's Droid CLI, giving you more flexibility in which agent to run.

The remaining changes are focused on making everyday operations smoother:

- Switching between sessions now remembers the pane you last had open instead of jumping back to the default.
- Untracked directories are now recognized correctly.
- After an amend, the Git pane returns to the correct commit state.

[Download Codelegate v1.2.0 here](https://github.com/brucehsu/codelegate/releases/tag/v1.2.0)

## Git Pane Two-Column Redesign with a File Tree

The Git pane now uses a two-column layout: a file tree organized by directory structure on the left, and the actual diff for the selected file on the right. The tree is built on `@pierre/trees` and lists changes with natural sorting (numbers in filenames sort by value rather than lexically), color-coded by status for added, modified, deleted, and untracked entries, with a palette that follows the app's existing theme.

![Git pane two-column file-tree layout](/images/v1-2-0-screenshots/git-tree-view.png)

The left-hand tree can be freely resized by dragging. It defaults to 320px and clamps itself between a minimum width and a share of the pane, so the diff area on the right always keeps enough room to read comfortably.

## Factory.ai Droid CLI Support

The agent picker now includes Factory.ai's Droid CLI, which can be launched in a session just like Claude Code and Codex CLI.

This release also adds agent detection: when you create a new session, each agent's command is checked against your login shell's PATH, so the picker reflects which agents are actually available in your environment and you avoid picking a tool that isn't installed yet.

## Other Improvements

- **Last focused pane memory**: switching back to a session restores whichever Agent, Terminal, or Git pane that tab last had open, instead of always jumping back to the default. New sessions still start on the Agent pane.
- **Proper untracked directory handling**: the Git pane now recognizes untracked directories correctly and no longer produces a broken diff for a whole new directory.
- **Amend state fix**: after an amend, the Git pane resets correctly to that commit's state. Single-file stage/unstage now returns the latest change summary directly, including renames produced by the action, so the view updates more accurately.
