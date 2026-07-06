---
title: "Release Notes - v1.5.0"
date: 2026-07-06
summary: "A single session can now switch between Claude Code and Codex without losing context, so you can hand the same task off between agents instead of juggling one session per CLI."
tag: Release
---

# v1.5.0

One session, more than one agent. You can now flip a session between Claude Code and Codex on the spot, keep both running side by side, and pick whichever one fits the moment. Every switched-away agent stays alive in the background, so its conversation and scrollback are waiting exactly where you left them.

[Download Codelegate v1.5.0 here](https://github.com/brucehsu/codelegate/releases/tag/v1.5.0)

## Switch Agents Inside a Session

A session is no longer tied to a single CLI. In the Agent tab, cycle between Claude Code and Codex with Mod+ArrowLeft and Mod+ArrowRight, and the session hands the same working directory and branch straight to the other agent. There is no need to open a second session just to get a second opinion.

<video src="/videos/agent-switching.mp4" autoplay loop muted playsinline controls></video>

Each agent's process is spawned the first time you switch to it and then kept running in the background afterward, so round-trips are instant and nothing is lost. Ask Claude to draft an approach, flip to Codex to cross-check it, and flip back to find your original conversation and scrollback intact. The last agent you used is remembered, so a restored session reopens right where you were.

The sidebar reflects this too: sessions now show a small stack of agent icons, with the active one in front and the others peeking out behind it, so you can see at a glance which agents a session is running and which one has the floor.

## A Custom Launch Command per CLI

Each CLI now has an editable Command field in Settings, so you can run an agent exactly how you want. Point it at a specific binary, or wrap it in something like `caffeinate -i claude` to keep your machine awake while an agent works. Custom commands run verbatim at spawn, and Codelegate still probes availability for plain command names so the picker stays accurate.

Switching agents mid-session also skips the per-session setup commands, since the working directory is already prepared, so a switch drops you straight into the agent.

## Other Improvements

- Mod+C now expands and collapses the sidebar.
- The rail only pops a drawer out for unread activity, keeping status changes quieter.
- Fixed a status indicator that could be hidden behind the CLI icons, and aligned the agent icon sizing across the sidebar.
