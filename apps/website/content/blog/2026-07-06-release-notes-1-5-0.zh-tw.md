---
title: "v1.5.0"
date: 2026-07-06
summary: "同一個 session 現在可以在 Claude Code 與 Codex 之間切換而不遺失脈絡，讓你把同一個任務交給不同 agent 接手，不必再為每個 CLI 各開一個 session"
tag: Release
---

# v1.5.0

一個 session，不只一個 agent。你現在可以隨時把 session 在 Claude Code 與 Codex 之間切換，讓兩者並存，挑當下最合適的那一個來用。每個被切走的 agent 都會留在背景繼續運作，它的對話與捲動紀錄都會停在你離開時的樣子等著你回來。

[按此下載 Codelegate v1.5.0](https://github.com/brucehsu/codelegate/releases/tag/v1.5.0)

## 在同一個 session 內切換 agent

session 不再綁定單一 CLI。在 Agent 分頁裡，用 Mod+ArrowLeft 與 Mod+ArrowRight 就能在 Claude Code 與 Codex 之間輪替，session 會把同一個工作目錄與分支直接交給另一個 agent。想聽聽第二個意見，再也不必為此另開一個 session。

<video src="/videos/agent-switching.mp4" autoplay loop muted playsinline controls></video>

每個 agent 的程序會在你第一次切換過去時才啟動，之後便持續留在背景執行，因此來回切換是即時的，也不會遺失任何內容。讓 Claude 先擬一個做法，切到 Codex 交叉驗證，再切回來，你原本的對話與捲動紀錄都還在。系統也會記住你最後使用的 agent，還原後的 session 會直接停在你離開的地方。

側邊欄也反映了這一點：每個 session 現在會顯示一小疊 agent 圖示，使用中的那個排在最前面，其餘的則從後方稍微露出，讓你一眼就能看出這個 session 跑了哪些 agent、目前是哪一個在檯面上。

## 為每個 CLI 自訂啟動指令

每個 CLI 現在都在設定裡多了一個可編輯的指令欄位，讓你完全照自己的方式啟動 agent。你可以指定某個特定的執行檔，或用類似 `caffeinate -i claude` 的方式把它包起來，讓 agent 工作時電腦不會進入休眠。自訂指令會在啟動時原封不動地執行，而對於單純的指令名稱，Codelegate 仍會偵測其是否可用，讓選單保持準確。

在 session 中途切換 agent 時，也會略過各 session 的設定指令，因為工作目錄早已備妥，切換後便能直接進入 agent。

## 其他改善

- Mod+C 現在可以展開與收合側邊欄。
- 窄軌只會為未讀動態彈出提示，讓狀態變化更為安靜。
- 修正狀態指示燈可能被 CLI 圖示遮住的問題，並統一了側邊欄中 agent 圖示的尺寸。
