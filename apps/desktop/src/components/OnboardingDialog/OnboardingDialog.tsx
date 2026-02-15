import { useCallback, useEffect, useMemo, useState } from "react";
import appLogo from "../../assets/logo.png";
import type { PaneKind, Session } from "../../types";
import type { SessionGroup } from "../../utils/session";
import Button from "../ui/Button/Button";
import Sidebar from "../Sidebar/Sidebar";
import TabButton from "../ui/TabButton/TabButton";
import { getShortcutModifierTokens, matchesShortcutModifierState } from "../../utils/shortcutModifier";
import styles from "./OnboardingDialog.module.css";

interface OnboardingDialogProps {
  shortcutModifier: string;
  onFinish: () => Promise<boolean> | boolean;
}

function createMockSession(
  id: string,
  repoPath: string,
  agent: "claude" | "codex",
  branch: string
): Session {
  return {
    id,
    repo: {
      repoPath,
      agent,
      env: [],
      preCommands: "",
    },
    branch,
    status: "running",
  };
}

const onboardingSessionGroups: SessionGroup[] = [
  {
    key: "/mock/codelegate",
    name: "Codelegate",
    sessions: [
      createMockSession("codelegate-main-codex", "/mock/codelegate", "codex", "main"),
      createMockSession("codelegate-main-claude", "/mock/codelegate", "claude", "main"),
      createMockSession("codelegate-onboarding", "/mock/codelegate", "codex", "feat/onboarding"),
      createMockSession("codelegate-sign-dmg", "/mock/codelegate", "codex", "ci/sign-dmg"),
    ],
  },
  {
    key: "/mock/cctop",
    name: "cctop",
    sessions: [
      createMockSession("cctop-main-codex", "/mock/cctop", "codex", "main"),
      createMockSession("cctop-main-claude", "/mock/cctop", "claude", "main"),
      createMockSession("cctop-opencode", "/mock/cctop", "codex", "feat/opencode-integration"),
    ],
  },
  {
    key: "/mock/opencode",
    name: "opencode",
    sessions: [
      createMockSession("opencode-main-claude", "/mock/opencode", "claude", "main"),
      createMockSession("opencode-codex-support", "/mock/opencode", "claude", "fix/codex-support"),
      createMockSession("opencode-tools", "/mock/opencode", "codex", "feat/tool-router"),
      createMockSession("opencode-refactor", "/mock/opencode", "claude", "refactor/session-tabs"),
      createMockSession("opencode-release", "/mock/opencode", "codex", "chore/release-v2"),
    ],
  },
];

export default function OnboardingDialog({ shortcutModifier, onFinish }: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activePane, setActivePane] = useState<PaneKind>("agent");
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [collapsedRepoGroups, setCollapsedRepoGroups] = useState<Record<string, boolean>>({});
  const [sessionHotkeyPage, setSessionHotkeyPage] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState(onboardingSessionGroups[0]?.sessions[0]?.id ?? null);
  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), []);
  const modifierTokens = useMemo(() => getShortcutModifierTokens(shortcutModifier), [shortcutModifier]);
  const submitKeyLabel = isMac ? "Cmd+Enter" : "Ctrl+Enter";
  const modifierLabel = modifierTokens.length > 0 ? modifierTokens.join(" + ") : "Alt";
  const filteredSessionGroups = useMemo(() => {
    const needle = sidebarFilter.trim().toLowerCase();
    if (!needle) {
      return onboardingSessionGroups;
    }
    return onboardingSessionGroups
      .map((group) => {
        const matchesRepo = group.name.toLowerCase().includes(needle);
        const sessions = matchesRepo
          ? group.sessions
          : group.sessions.filter((session) => (session.branch ?? "").toLowerCase().includes(needle));
        return { ...group, sessions };
      })
      .filter((group) => group.sessions.length > 0);
  }, [sidebarFilter]);
  const visualSessions = useMemo(() => {
    const ordered: Session[] = [];
    filteredSessionGroups.forEach((group) => {
      if (collapsedRepoGroups[group.key]) {
        return;
      }
      ordered.push(...group.sessions.filter((session) => !session.isTabClosed));
    });
    return ordered;
  }, [collapsedRepoGroups, filteredSessionGroups]);
  const hotkeyPageCount = useMemo(() => Math.max(1, Math.ceil(visualSessions.length / 9)), [visualSessions.length]);
  const sessionShortcuts = useMemo(() => {
    const shortcuts: Record<string, string> = {};
    const start = sessionHotkeyPage * 9;
    visualSessions.slice(start, start + 9).forEach((session, index) => {
      shortcuts[session.id] = String(index + 1);
    });
    return shortcuts;
  }, [sessionHotkeyPage, visualSessions]);

  const moveToNextStep = useCallback(async () => {
    if (submitting) {
      return;
    }
    if (step < 2) {
      setStep((prev) => prev + 1);
      return;
    }
    setSubmitting(true);
    try {
      await onFinish();
    } finally {
      setSubmitting(false);
    }
  }, [onFinish, step, submitting]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifierActive = matchesShortcutModifierState(event, shortcutModifier);
      setShowShortcuts(modifierActive);
      const submitModifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (submitModifierPressed && event.key === "Enter") {
        event.preventDefault();
        void moveToNextStep();
        return;
      }
      if (!modifierActive) {
        return;
      }

      if (step === 1) {
        if (event.code === "KeyA") {
          event.preventDefault();
          setActivePane("agent");
        } else if (event.code === "KeyG") {
          event.preventDefault();
          setActivePane("git");
        } else if (event.code === "KeyT") {
          event.preventDefault();
          setActivePane("terminal");
        }
        return;
      }

      if (step === 2) {
        if (!event.repeat && (event.code === "Digit0" || event.code === "Numpad0")) {
          event.preventDefault();
          setSessionHotkeyPage((prev) => (prev + 1) % hotkeyPageCount);
          return;
        }
        const match = event.code.match(/^(Digit|Numpad)([1-9])$/);
        if (!match || event.repeat) {
          return;
        }
        const index = Number(match[2]) - 1;
        const target = visualSessions[sessionHotkeyPage * 9 + index];
        if (!target) {
          return;
        }
        event.preventDefault();
        setActiveSessionId(target.id);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const modifierActive = matchesShortcutModifierState(event, shortcutModifier);
      setShowShortcuts(modifierActive);
      if (!modifierActive) {
        setSessionHotkeyPage(0);
      }
    };
    const handleBlur = () => {
      setShowShortcuts(false);
      setSessionHotkeyPage(0);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [hotkeyPageCount, isMac, moveToNextStep, sessionHotkeyPage, shortcutModifier, step, visualSessions]);

  useEffect(() => {
    if (sessionHotkeyPage >= hotkeyPageCount) {
      setSessionHotkeyPage(0);
    }
  }, [hotkeyPageCount, sessionHotkeyPage]);

  const submitLabel = step === 2 ? "Start" : "Next Step";

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Codelegate onboarding">
        <div className={styles.body}>
          {step === 0 ? (
            <section className={`${styles.section} ${styles.step1Section}`}>
              <img src={appLogo} alt="" className={styles.step1Logo} />
              <h2 className={styles.step1Brand}>Codelegate</h2>
              <p className={styles.step1Welcome}>
                Codelegate is opinionated:<br />
                Wroktree-first, terminal-native, and keyboard-driven.
              </p>
              <p className={styles.step1Welcome}>Most actions support full keyboard navigation.</p>
              <p className={styles.callout}>Press {submitKeyLabel} to move to the next step.</p>
            </section>
          ) : null}

          {step === 1 ? (
            <section className={`${styles.section} ${styles.stepWithBrand} ${styles.step2Section}`}>
              <div className={styles.stepTopBrand}>
              </div>
              <div className={styles.stepContent}>
                <h3>Keyboard Navigation</h3>
                <p>Hold {modifierLabel} to reveal hotkeys.</p>
                <p>Press {modifierLabel} + A/G/T to switch between features.</p>
                <div className={styles.mockTabs}>
                  <TabButton active={activePane === "agent"} hotkey="A" showHotkey={showShortcuts}>
                    Agent
                  </TabButton>
                  <TabButton active={activePane === "git"} hotkey="G" showHotkey={showShortcuts}>
                    Git
                  </TabButton>
                  <TabButton active={activePane === "terminal"} hotkey="T" showHotkey={showShortcuts}>
                    Terminal
                  </TabButton>
                </div>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className={`${styles.section} ${styles.stepWithBrand}`}>
              <div className={styles.stepTopBrand}>
              </div>
              <div className={styles.stepContent}>
                <h3>Session Tab Navigation</h3>
                <div className={styles.step3Layout}>
                  <div className={styles.step3SidebarShell}>
                    <div className={styles.step3SidebarScaled}>
                      <Sidebar
                        filter={sidebarFilter}
                        sessionGroups={filteredSessionGroups}
                        activeSessionId={activeSessionId}
                        onFilterChange={setSidebarFilter}
                        onSelectSession={setActiveSessionId}
                        onNewSession={() => {}}
                        onOpenSettings={() => {}}
                        onRenameSession={() => {}}
                        onTerminateSession={() => {}}
                        agentOutputting={{}}
                        sessionShortcuts={sessionShortcuts}
                        collapsedRepoGroups={collapsedRepoGroups}
                        onToggleRepoGroup={(repoPath) =>
                          setCollapsedRepoGroups((prev) => ({ ...prev, [repoPath]: !prev[repoPath] }))
                        }
                        showShortcutHints={showShortcuts}
                        shortcutModifierTokens={modifierTokens}
                        showSearchInput={false}
                        showFooterActions={false}
                      />
                    </div>
                  </div>
                <div className={styles.step3Meta}>
                  <p>Switch between session using {modifierLabel} + 1-9.</p>
                  <br />
                  <p>If you have more than 9 sessions, use {modifierLabel} + 0 to jump to the next page.</p>
                </div>
              </div>
              </div>
            </section>
          ) : null}
        </div>

        <div className={styles.actions}>
          <span className={styles.submitHint}>{submitKeyLabel}</span>
          <Button variant="primary" onClick={() => void moveToNextStep()} disabled={submitting}>
            {submitting ? "Preparing..." : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
