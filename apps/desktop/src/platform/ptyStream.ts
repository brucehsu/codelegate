/**
 * PTY data plane.
 *
 * PTY output, exits, keystrokes and flow-control acks do not travel over
 * `ipcRenderer`: they ride a single `MessageChannelMain` port that the main
 * process posts to the preload on `did-finish-load`. The preload holds that
 * port and transfers it into this (main) world when this module asks for it.
 *
 * Port protocol (see the plan's "PTY port protocol"):
 *   main -> renderer: `{ type: "data", sessionId, data, endOffset }`
 *                     `{ type: "exit", sessionId }`
 *   renderer -> main: `{ type: "write", sessionId, data }`
 *                     `{ type: "ack", sessionId, throughOffset }`
 *
 * The port arrives asynchronously, so writes and acks issued before it lands
 * are buffered and flushed in order once it does.
 */
import type { PtyExitEvent, PtyOutputEvent } from "../../electron/shared/types";

/** Sent to the preload once, at module init. */
const PORT_REQUEST = "codelegate:pty-port-request";
/** Sent back by the preload, carrying the transferred port. */
const PORT_DELIVERY = "codelegate:pty-port";

type OutgoingMessage =
  | { type: "write"; sessionId: number; data: string }
  | { type: "ack"; sessionId: number; throughOffset: number };

type IncomingMessage =
  | { type: "data"; sessionId: number; data: Uint8Array | ArrayBuffer; endOffset: number }
  | { type: "exit"; sessionId: number };

let port: MessagePort | null = null;
const pending: OutgoingMessage[] = [];
const outputListeners = new Set<(event: PtyOutputEvent) => void>();
const exitListeners = new Set<(event: PtyExitEvent) => void>();

function post(message: OutgoingMessage) {
  if (port) {
    port.postMessage(message);
    return;
  }
  pending.push(message);
}

function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function handlePortMessage(event: MessageEvent) {
  const message = event.data as IncomingMessage | null;
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "data") {
    const payload: PtyOutputEvent = {
      sessionId: message.sessionId,
      data: toBytes(message.data),
      endOffset: message.endOffset,
    };
    outputListeners.forEach((listener) => listener(payload));
    return;
  }
  if (message.type === "exit") {
    const payload: PtyExitEvent = { sessionId: message.sessionId };
    exitListeners.forEach((listener) => listener(payload));
  }
}

function attachPort(next: MessagePort) {
  if (port) {
    port.close();
  }
  port = next;
  next.onmessage = handlePortMessage;
  next.start();
  const queued = pending.splice(0, pending.length);
  for (const message of queued) {
    next.postMessage(message);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source && event.source !== window) {
      return;
    }
    const data = event.data as { type?: unknown } | null;
    if (!data || typeof data !== "object" || data.type !== PORT_DELIVERY) {
      return;
    }
    const received = event.ports?.[0];
    if (received) {
      attachPort(received);
    }
  });
  window.postMessage({ type: PORT_REQUEST }, "*");
}

/** Fire and forget: keystrokes for a running PTY. */
export function writePty(sessionId: number, data: string): void {
  post({ type: "write", sessionId, data });
}

/**
 * Fire and forget: credit-window acknowledgement. Offsets are cumulative, so a
 * dropped ack only stalls the bounded window; it never loses data.
 */
export function ackPtyOutput(sessionId: number, throughOffset: number): void {
  post({ type: "ack", sessionId, throughOffset });
}

export function onPtyOutput(callback: (event: PtyOutputEvent) => void): () => void {
  outputListeners.add(callback);
  return () => {
    outputListeners.delete(callback);
  };
}

export function onPtyExit(callback: (event: PtyExitEvent) => void): () => void {
  exitListeners.add(callback);
  return () => {
    exitListeners.delete(callback);
  };
}
