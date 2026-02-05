import { useCallback } from "react";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.25;

export interface TerminalAppearance {
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
}

export interface TerminalRendererRuntime {
  term?: Terminal;
  webgl?: WebglAddon;
  rendererAttachRaf?: number;
  webglPostInitTimer?: number;
}

function refreshTerminalRows(term?: Terminal) {
  if (!term || term.rows <= 0) {
    return;
  }
  term.refresh(0, term.rows - 1);
}

export function useTerminalRenderer() {
  const loadTerminalFonts = useCallback((appearance: TerminalAppearance) => {
    if (!document.fonts?.load) {
      return Promise.resolve();
    }
    const sample = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const specs = [
      `${appearance.fontSize}px ${appearance.fontFamily}`,
      `italic ${appearance.fontSize}px ${appearance.fontFamily}`,
      `700 ${appearance.fontSize}px ${appearance.fontFamily}`,
      `italic 700 ${appearance.fontSize}px ${appearance.fontFamily}`,
    ];
    return Promise.allSettled(specs.map((spec) => document.fonts.load(spec, sample))).then(() => undefined);
  }, []);

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

  const clearPendingRendererAttach = useCallback((runtime: TerminalRendererRuntime) => {
    if (runtime.rendererAttachRaf !== undefined) {
      window.cancelAnimationFrame(runtime.rendererAttachRaf);
      runtime.rendererAttachRaf = undefined;
    }
    if (runtime.webglPostInitTimer !== undefined) {
      window.clearTimeout(runtime.webglPostInitTimer);
      runtime.webglPostInitTimer = undefined;
    }
  }, []);

  const refreshWebglRenderer = useCallback((runtime: TerminalRendererRuntime) => {
    if (!runtime.webgl) {
      return;
    }
    runtime.webgl.clearTextureAtlas();
    refreshTerminalRows(runtime.term);
  }, []);

  const ensureWebglRenderer = useCallback(
    (runtime: TerminalRendererRuntime, appearance: TerminalAppearance) => {
      const term = runtime.term;
      if (!term) {
        return;
      }
      if (runtime.webgl) {
        refreshWebglRenderer(runtime);
        return;
      }
      clearPendingRendererAttach(runtime);
      void loadTerminalFonts(appearance).then(() => {
        if (runtime.term !== term || runtime.webgl) {
          return;
        }
        runtime.rendererAttachRaf = window.requestAnimationFrame(() => {
          runtime.rendererAttachRaf = window.requestAnimationFrame(() => {
            runtime.rendererAttachRaf = undefined;
            if (runtime.term !== term || runtime.webgl) {
              return;
            }
            try {
              const webgl = new WebglAddon();
              term.loadAddon(webgl);
              runtime.webgl = webgl;
              webgl.onContextLoss(() => {
                if (runtime.webgl === webgl) {
                  runtime.webgl = undefined;
                }
                webgl.dispose();
              });
              refreshWebglRenderer(runtime);
              runtime.webglPostInitTimer = window.setTimeout(() => {
                runtime.webglPostInitTimer = undefined;
                if (runtime.webgl !== webgl) {
                  return;
                }
                refreshWebglRenderer(runtime);
              }, 100);
            } catch {
              // Fallback to canvas renderer when WebGL is unavailable.
            }
          });
        });
      });
    },
    [clearPendingRendererAttach, loadTerminalFonts, refreshWebglRenderer]
  );

  return {
    applyTerminalAppearance,
    clearPendingRendererAttach,
    ensureWebglRenderer,
    loadTerminalFonts,
    refreshTerminalRows,
    refreshWebglRenderer,
  };
}
