---
title: "Release Notes - v1.6.0"
date: 2026-08-06
summary: "A full interface refresh brings layered depth and a warmer new palette to Codelegate, while long-running sessions now keep memory in check and inactive terminals lean."
tag: Release
---

# v1.6.0

Codelegate has a new visual rhythm. The whole app has been redrawn around deep navy surfaces, sage accents, and layers that make each pane easier to read without piling on more chrome. Underneath that fresh coat, long-running sessions now stay lighter too: terminal output is kept from outrunning the renderer, and background terminals give memory back when they are out of view.

[Download Codelegate v1.6.0 here](https://github.com/brucehsu/codelegate/releases/tag/v1.6.0)

## A Fresh Look, Built in Layers

The interface no longer feels like one flat sheet of dark UI. The sidebar, main pane, pickers, and dialogs now sit on distinct surfaces, with subtle borders, shadows, and recessed controls separating one layer from the next. A Nippon-inspired palette brings deep navy and muted sage together, giving the app more character while keeping the focus on your work.

![Codelegate's redesigned layered interface](/images/v1-6-0-screenshots/layered-ui.png)

The new system reaches into the details too. Controls share a calmer, more consistent density; Git diffs use clearer additions, deletions, and file states; and the terminal sheds excess framing so the CLI gets more room. Codelegate now commits to one cohesive dark theme, with near-black terminal surfaces left untouched for familiar contrast.

## Long Sessions That Stay Steady

Leave an agent running for hours and a lot can move through its terminal. Codelegate now paces the handoff between the native process and the terminal renderer, so output cannot keep piling up faster than the interface can consume it. Active terminals still retain generous history, while terminals sitting in the background automatically slim down.

Switch back and the terminal returns to the position you expect, even after old lines have been cleared away. Large Git diffs also release rendering data as you move on, and overscroll is kept inside the app instead of pulling the window into macOS rubber-banding. Together, those changes keep a busy workspace more responsive over a long day.

## Other Improvements

- The sidebar collapse button now lines up cleanly with the search field.
