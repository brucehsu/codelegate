import { useEffect } from "react";
import { ChevronDown, Command, Plus } from "lucide-react";
import { initApp } from "./app";

function ClaudeLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l7 4v8l-7 4-7-4v-8l7-4z" fill="currentColor" opacity="0.2" />
      <path d="M12 5.2l4.9 2.8v5.9L12 16.7 7.1 14V8l4.9-2.8z" fill="currentColor" />
    </svg>
  );
}

function CodexLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a6 6 0 106 6h-2.2A3.8 3.8 0 1112 6.2V4z" fill="currentColor" />
      <path
        d="M12 20a6 6 0 10-6-6h2.2A3.8 3.8 0 0012 17.8V20z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}

export default function App() {
  useEffect(() => {
    initApp().catch((error) => {
      console.error("Failed to init app", error);
    });
  }, []);

  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-controls">
            <input className="input" id="session-filter" placeholder="Search sessions" />
          </div>
          <div id="session-list" className="session-list" />
          <button className="fab" id="new-session" type="button" aria-label="New session">
            <Plus aria-hidden="true" />
          </button>
        </aside>
        <main className="main">
          <div id="banner" className="banner hidden" />
          <div className="tab-pane hidden" id="tab-pane">
            <div className="tab-strip">
              <button className="tab active" type="button" disabled>
                Agent
              </button>
            </div>
            <div className="tab-body">
              <div id="terminal-stack" className="terminal-stack" />
            </div>
          </div>
          <div id="empty-state" className="empty-state">
            <div className="empty-logo">
              <Command aria-hidden="true" />
            </div>
            <h1>Codelegate</h1>
          </div>
        </main>
      </div>

      <dialog id="session-dialog" className="dialog">
        <form id="session-form" className="dialog-form">
          <div className="dialog-header">
            <div>
              <h3>New Session</h3>
              <p>Launch a local agent session for a repository.</p>
            </div>
            <button type="button" className="ghost" data-close>
              Close
            </button>
          </div>

          <div className="form-grid">
            <div className="field full">
              <span>Agent CLI</span>
              <div className="agent-picker" id="agent-picker">
                <button type="button" className="agent-card" data-agent="claude">
                  <span className="agent-logo claude">
                    <ClaudeLogo />
                  </span>
                  <span className="agent-label">Claude Code</span>
                </button>
                <button type="button" className="agent-card" data-agent="codex">
                  <span className="agent-logo codex">
                    <CodexLogo />
                  </span>
                  <span className="agent-label">Codex CLI</span>
                </button>
              </div>
              <span className="field-hint" id="agent-hint" />
            </div>

            <label className="field full">
              <span>Repository path</span>
              <div className="input-row">
                <div className="select-field" id="repo-picker">
                  <button type="button" className="select-trigger placeholder" id="repo-trigger">
                    <span id="repo-trigger-label">Select a directory</span>
                    <ChevronDown className="select-icon" aria-hidden="true" />
                  </button>
                  <div className="select-menu" id="repo-menu" />
                </div>
                <button type="button" className="ghost" id="browse-repo">
                  Browse
                </button>
              </div>
              <span className="field-hint" id="repo-hint" />
            </label>

            <label className="field checkbox full">
              <input type="checkbox" id="worktree-toggle" />
              <span>Create git worktree</span>
            </label>

            <div id="worktree-fields" className="worktree-fields hidden full">
              <label className="field">
                <span>Worktree path</span>
                <input id="worktree-path" className="input" placeholder="/path/to/worktree" />
              </label>
              <label className="field">
                <span>Branch (optional)</span>
                <input id="worktree-branch" className="input" placeholder="feature/my-branch" />
              </label>
            </div>

            <div className="field full">
              <span>Environment variables (optional)</span>
              <div id="env-list" className="env-list" />
              <button type="button" className="ghost" id="add-env">
                Add variable
              </button>
            </div>

            <label className="field full">
              <span>Commands to run before agent (optional)</span>
              <textarea
                id="pre-commands"
                className="input"
                rows={3}
                placeholder="# e.g. setup commands\nnpm install"
              />
            </label>
          </div>

          <div className="dialog-actions">
            <button type="button" className="ghost" data-close>
              Cancel
            </button>
            <button type="submit" className="primary" id="start-session" disabled>
              Start
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
