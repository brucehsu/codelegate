/**
 * `openExternal` with a protocol allowlist.
 *
 * The renderer only ever opens http(s) links detected in terminal output and
 * the occasional mailto:, so anything else (file:, javascript:, custom app
 * schemes) is refused rather than handed to the OS.
 *
 * The opener is injected instead of imported so this module stays free of
 * `electron` at runtime and the unit suite can load it directly.
 */
import { IPC } from "../../shared/channels";
import type { IpcHandle } from "./register";

export const ALLOWED_EXTERNAL_PROTOCOLS = ["http:", "https:", "mailto:"] as const;

export type ExternalOpener = (url: string) => Promise<void>;

export function isAllowedExternalUrl(url: unknown): boolean {
  if (typeof url !== "string" || url.trim().length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (ALLOWED_EXTERNAL_PROTOCOLS as readonly string[]).includes(parsed.protocol);
}

export async function openExternalUrl(url: string, opener: ExternalOpener): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error(`Refusing to open unsupported URL: ${url}`);
  }
  await opener(url);
}

export function registerShellIpc(handle: IpcHandle, opener: ExternalOpener): void {
  handle(IPC.OPEN_EXTERNAL, (_event, url: string) => openExternalUrl(url, opener));
}
