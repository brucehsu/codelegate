---
title: "Release Notes - v1.4.0"
date: 2026-07-04
summary: "Redesigned the sidebar so it can collapse into a slim rail, with pop-out drawers and an unread indicator that keep background sessions in view while you work elsewhere."
tag: Release
---

# v1.4.0

This release is all about the sidebar. It now collapses into a slim rail that hands more room to your panes, and background sessions stay in view even when it's tucked away: a row pops out on its own the moment something happens, and a new unread light flags any session that produced output while your attention was elsewhere.

[Download Codelegate v1.4.0 here](https://github.com/brucehsu/codelegate/releases/tag/v1.4.0)

## A Collapsible Sidebar

Collapse the sidebar into a slim rail with the chevron beside the search box, and each session shrinks to its agent icon and a status dot. A full workspace stays easy to scan, while the Agent, Terminal, and Git panes get room to breathe. Next time you open the app, the sidebar is right where you left it.

![Collapsible sidebar rail with status light pop-outs](/images/v1-4-0-screenshots/collapsible-sidebar.png)

## Sessions That Come to You

A collapsed rail doesn't mean losing track of what your sessions are up to. When a session changes status, its row slides out for a moment to show its repository and branch, then tucks back in. Hover an icon to peek at a single row, or hold the shortcut to fan them all out at once. A session that hits an error stays out until you acknowledge it, so a failure can't slip by unnoticed.

## An Unread Light for Background Sessions

Each session's status light now doubles as an unread cue. When a session you're not focused on produces output, its light turns yellow to signal activity in the background, and it clears the instant you switch over. A busy agent in another tab never slips out of sight, whether the sidebar is open or collapsed.

## Other Improvements

- Untracked folders with only a few files now expand in the diff view instead of showing an error.
- Factory.ai Droid CLI support has been removed.
