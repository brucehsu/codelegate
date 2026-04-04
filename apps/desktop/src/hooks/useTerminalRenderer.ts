import { useCallback } from "react";
import { Terminal } from "@xterm/xterm";

export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.25;

export interface TerminalAppearance {
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
}

export interface TerminalRendererRuntime {
  term?: Terminal;
}

function refreshTerminalRows(term?: Terminal) {
  if (!term || term.rows <= 0) {
    return;
  }
  term.refresh(0, term.rows - 1);
}

export function useTerminalRenderer() {
  const applyTerminalAppearance = useCallback((runtime: TerminalRendererRuntime, appearance: TerminalAppearance) => {
    const term = runtime.term;
    if (!term) {
      return;
    }
    const lineHeight = appearance.lineHeight ?? DEFAULT_TERMINAL_LINE_HEIGHT;
    term.options.fontFamily = appearance.fontFamily;
    term.options.fontSize = appearance.fontSize;
    term.options.lineHeight = lineHeight;

    const root = term.element;
    if (!root) {
      return;
    }
    const fontSizePx = `${appearance.fontSize}px`;
    const lineHeightCss = `${lineHeight}`;
    root.style.fontFamily = appearance.fontFamily;
    root.style.fontSize = fontSizePx;
    root.style.lineHeight = lineHeightCss;

    const accessibilityTree = root.querySelector(".xterm-accessibility-tree") as HTMLElement | null;
    if (accessibilityTree) {
      accessibilityTree.style.fontFamily = appearance.fontFamily;
      accessibilityTree.style.fontSize = fontSizePx;
      accessibilityTree.style.lineHeight = lineHeightCss;
    }
  }, []);

  return {
    applyTerminalAppearance,
    refreshTerminalRows,
  };
}
