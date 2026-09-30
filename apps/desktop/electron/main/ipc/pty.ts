/**
 * PTY control plane (`spawn`/`resize`/`kill` over `ipcRenderer.invoke`) and
 * data plane (`data`/`exit` out, `write`/`ack` in over one `MessageChannelMain`
 * per window).
 *
 * Batching: the addon's reader thread hands us one callback per `read()`. At
 * full tilt that is thousands of tiny messages per second, and each one costs a
 * structured clone plus a renderer task. `PtyHub` coalesces them per session
 * into at most one message every `FLUSH_INTERVAL_MS`, flushing early once a
 * batch reaches `FLUSH_BYTES`. Because the addon's acks are cumulative, posting
 * only the last `endOffset` of a batch is exact: acking it releases the whole
 * batch in the Rust credit window.
 *
 * Backpressure safety: whenever the page that owned a session is gone (the hub
 * was reset by a committed navigation, the renderer crashed, the window was
 * destroyed, the port closed from the other side) the hub drops that session's
 * buffered bytes and acks them itself, otherwise the 256 KiB credit window in
 * Rust fills and the reader thread parks forever. That mirrors the old
 * `emit().is_err()` self-ack.
 *
 * A session spawned by a page that is still alive is different: the renderer
 * can invoke `spawn` as soon as its scripts run, which is before
 * `did-finish-load` hands the port over, so early output would be destroyed by
 * a self-ack. Those messages are queued instead, in order, and posted when
 * `attachPort` runs. The queue is bounded by the same credit window: at most
 * 256 KiB per live session.
 */
import { performance } from "node:perf_hooks";

import type { BrowserWindow, MessagePortMain } from "electron";

import { IPC } from "../../shared/channels";
import type { SpawnPtyArgs } from "../../shared/types";
import type { NativeAddon } from "../native";
import type { IpcHandle } from "./register";

/** Flush a session's batch as soon as it reaches this many buffered bytes. */
export const FLUSH_BYTES = 64 * 1024;
/** Minimum gap between two posts for one session. */
export const FLUSH_INTERVAL_MS = 8;

/** Renderer to main. */
type InboundMessage =
  | { type: "write"; sessionId: number; data: string }
  | { type: "ack"; sessionId: number; throughOffset: number };

/** Main to renderer. */
type OutboundMessage =
  | { type: "data"; sessionId: number; data: Buffer; endOffset: number }
  | { type: "exit"; sessionId: number };

interface SessionBatch {
  chunks: Buffer[];
  bytes: number;
  endOffset: number;
  timer: NodeJS.Timeout | null;
  /** `performance.now()`, not `Date.now()`: a backwards clock step must not arm a multi-hour timer. */
  lastFlushAt: number;
}

export class PtyHub {
  private readonly native: NativeAddon;
  private port: MessagePortMain | null = null;
  private readonly batches = new Map<number, SessionBatch>();
  /** Sessions whose owning page is still around, so their output is worth queueing. */
  private readonly liveSessions = new Set<number>();
  /** Output produced before the port arrived, in the order it was produced. */
  private pending: OutboundMessage[] = [];

  constructor(native: NativeAddon) {
    this.native = native;
  }

  /**
   * Adopt the main-side end of a fresh channel; any previous one is closed.
   * This is the only place a port is replaced, so a cancelled navigation cannot
   * leave the hub without one. Anything produced while there was no port is
   * handed over here, in order.
   */
  attachPort(port: MessagePortMain): void {
    this.closePort();
    this.port = port;
    port.on("message", (event) => {
      this.handleInbound(event.data as InboundMessage);
    });
    port.on("close", () => {
      if (this.port === port) {
        this.port = null;
        this.drainWithoutPort();
      }
    });
    port.start();

    const queued = this.pending;
    this.pending = [];
    for (const message of queued) port.postMessage(message);
  }

  /**
   * The page went away (committed navigation, crash, window destroyed). Drop
   * the port and every session with it: the renderer that owned them cannot
   * address them any more, and leaving them running would leak shells. Buffered
   * output for those sessions is acked on the way out so the addon's reader
   * threads are never left parked on a full credit window.
   */
  reset(): void {
    this.closePort();
    this.drainWithoutPort();
    this.batches.clear();
    try {
      this.native.shutdownAllPty();
    } catch (error) {
      console.error("[pty] shutdownAllPty failed", error);
    }
  }

  spawn(args: SpawnPtyArgs): number {
    const sessionId = this.native.spawnPty(
      {
        shell: args.shell,
        args: args.args ?? [],
        cwd: args.cwd,
        env: args.env ?? {},
        cols: args.cols,
        rows: args.rows,
      },
      (chunk) => {
        this.onData(chunk.sessionId, chunk.data, chunk.endOffset);
      },
      (exited) => {
        this.onExit(exited);
      },
    );
    this.liveSessions.add(sessionId);
    return sessionId;
  }

  resize(sessionId: number, cols: number, rows: number): void {
    this.native.resizePty(sessionId, cols, rows);
  }

  kill(sessionId: number): void {
    // Push whatever is buffered before the session disappears, then let the
    // addon's exit callback do the bookkeeping.
    this.flush(sessionId);
    this.native.killPty(sessionId);
  }

  private onData(sessionId: number, data: Buffer, endOffset: number): void {
    const batch = this.batchFor(sessionId);
    batch.chunks.push(data);
    batch.bytes += data.byteLength;
    batch.endOffset = endOffset;

    if (batch.bytes >= FLUSH_BYTES) {
      this.flush(sessionId);
      return;
    }

    const elapsed = performance.now() - batch.lastFlushAt;
    if (elapsed >= FLUSH_INTERVAL_MS) {
      this.flush(sessionId);
      return;
    }

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        batch.timer = null;
        this.flush(sessionId);
      }, FLUSH_INTERVAL_MS - elapsed);
    }
  }

  private onExit(sessionId: number): void {
    // Flush first: an exit queued ahead of that session's last bytes would
    // reach the renderer out of order once the port arrives.
    this.flush(sessionId);
    const batch = this.batches.get(sessionId);
    if (batch?.timer) clearTimeout(batch.timer);
    this.batches.delete(sessionId);
    this.post({ type: "exit", sessionId });
    this.liveSessions.delete(sessionId);
  }

  private batchFor(sessionId: number): SessionBatch {
    let batch = this.batches.get(sessionId);
    if (!batch) {
      batch = { chunks: [], bytes: 0, endOffset: 0, timer: null, lastFlushAt: 0 };
      this.batches.set(sessionId, batch);
    }
    return batch;
  }

  private flush(sessionId: number): void {
    const batch = this.batches.get(sessionId);
    if (!batch) return;
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    if (batch.chunks.length === 0) return;

    const data = batch.chunks.length === 1 ? batch.chunks[0] : Buffer.concat(batch.chunks, batch.bytes);
    const endOffset = batch.endOffset;
    batch.chunks = [];
    batch.bytes = 0;
    batch.lastFlushAt = performance.now();

    this.post({ type: "data", sessionId, data, endOffset });
  }

  /**
   * Post now if the renderer is listening, queue if its port has not arrived
   * yet, and self-ack only when the session's page is gone for good.
   */
  private post(message: OutboundMessage): void {
    const port = this.port;
    if (port) {
      port.postMessage(message);
      return;
    }
    if (!this.liveSessions.has(message.sessionId)) {
      if (message.type === "data") this.selfAck(message.sessionId, message.endOffset);
      return;
    }
    this.pending.push(message);
  }

  /** No renderer to ack for us; release the credit window ourselves. */
  private selfAck(sessionId: number, throughOffset: number): void {
    try {
      this.native.ackPtyOutput(sessionId, throughOffset);
    } catch {
      // Session already gone; nothing to release.
    }
  }

  /**
   * The page is gone for good. Nothing buffered or queued can be delivered any
   * more, so drop it and release the credit window for every session it covers.
   * One ack per session: the offsets are cumulative, so the highest wins.
   */
  private drainWithoutPort(): void {
    const acks = new Map<number, number>();
    for (const [sessionId, batch] of this.batches) {
      if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
      }
      batch.chunks = [];
      batch.bytes = 0;
      acks.set(sessionId, batch.endOffset);
    }
    for (const message of this.pending) {
      if (message.type !== "data") continue;
      const highest = acks.get(message.sessionId) ?? 0;
      if (message.endOffset > highest) acks.set(message.sessionId, message.endOffset);
    }
    this.pending = [];
    this.liveSessions.clear();
    for (const [sessionId, throughOffset] of acks) this.selfAck(sessionId, throughOffset);
  }

  private handleInbound(message: InboundMessage): void {
    if (!message || typeof message !== "object") return;
    try {
      if (message.type === "write") {
        this.native.writePty(message.sessionId, message.data);
      } else if (message.type === "ack") {
        this.native.ackPtyOutput(message.sessionId, message.throughOffset);
      }
    } catch (error) {
      // A write to a session that just exited is expected, not fatal.
      console.error(`[pty] ${message.type} failed`, error);
    }
  }

  private closePort(): void {
    if (!this.port) return;
    const port = this.port;
    this.port = null;
    port.removeAllListeners();
    try {
      port.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * `() => new MessageChannelMain()`. Injected rather than imported so this
 * module never pulls in `electron` at runtime and the batching logic above can
 * be unit tested in a plain Node environment.
 */
export type MessageChannelFactory = () => { port1: MessagePortMain; port2: MessagePortMain };

/**
 * Hand the renderer its end of a fresh channel on every load, and tear the PTY
 * world down whenever the page it belonged to goes away.
 *
 * The teardown hook is `did-navigate` (a COMMITTED main-frame navigation), not
 * `did-start-navigation`: the latter fires before `will-navigate` in
 * `window.ts` cancels a foreign navigation, so dropping a file onto the window
 * would have killed every PTY of a page that then stayed exactly where it was,
 * with no further `did-finish-load` to hand it a new port. `did-navigate` also
 * skips same-document navigations, which never replace the renderer's world.
 */
export function attachPtyPort(
  window: BrowserWindow,
  hub: PtyHub,
  createChannel: MessageChannelFactory,
): void {
  const contents = window.webContents;

  contents.on("did-finish-load", () => {
    const channel = createChannel();
    hub.attachPort(channel.port1);
    contents.postMessage(IPC.PTY_PORT, null, [channel.port2]);
  });

  contents.on("did-navigate", () => {
    hub.reset();
  });

  contents.on("render-process-gone", () => {
    hub.reset();
  });

  contents.on("destroyed", () => {
    hub.reset();
  });
}

export function registerPtyIpc(handle: IpcHandle, hub: PtyHub): void {
  handle(IPC.SPAWN_PTY, (_event, args: SpawnPtyArgs) => hub.spawn(args));
  handle(IPC.RESIZE_PTY, (_event, sessionId: number, cols: number, rows: number) => {
    hub.resize(sessionId, cols, rows);
  });
  handle(IPC.KILL_PTY, (_event, sessionId: number) => {
    hub.kill(sessionId);
  });
}
