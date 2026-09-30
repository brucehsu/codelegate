import type { AgentId, PaneKind } from "../types";

/** Where a ptyId's output and exit go once its spawn reply has landed. */
export interface PtyMapping {
  sessionId: string;
  kind: PaneKind;
  agentId?: AgentId;
}

/** One batch of PTY output that arrived before the ptyId had a session mapping. */
export interface PendingPtyChunk {
  data: Uint8Array;
  endOffset: number;
}

export interface PendingPtyEvents {
  chunks: PendingPtyChunk[];
  bytes: number;
  /** The PTY exited while still unmapped; replayed after the parked chunks. */
  exited: boolean;
}

/**
 * Everything the buffer does to the outside world. `write` and `exit` are the
 * renderer's live handlers; `ack` releases the addon's credit window for output
 * that will never reach a terminal.
 */
export interface PtyEventSink {
  write(ptyId: number, info: PtyMapping, chunk: PendingPtyChunk): void;
  exit(ptyId: number, info: PtyMapping): void;
  ack(ptyId: number, throughOffset: number): void;
}

export interface PtyEventBufferOptions {
  maxBytes?: number;
  maxParkedIds?: number;
}

// Ceiling on the output parked for a PTY that has no session mapping yet.
// Parked chunks are never acked, so the addon's 256 KiB credit window already
// stops the producer long before this; the cap only bounds the pathological
// case where the spawn reply that would create the mapping never arrives.
export const PENDING_PTY_BUFFER_BYTES = 1024 * 1024;

// Ceiling on how many unmapped ptyIds may be parked at once. An exit that beats
// its spawn reply parks an entry with no bytes at all, so the byte cap above
// cannot bound the id count on its own.
export const MAX_PARKED_PTY_IDS = 256;

/**
 * PTY output and exits ride the MessagePort while the ptyId that maps them to a
 * session comes back on the `spawnPty` invoke reply, a different pipe. The first
 * chunks (and, for a process that dies immediately, the exit) can therefore land
 * before the mapping is registered. This buffer parks them keyed by ptyId and
 * replays them in order the moment the mapping exists. Parked chunks are
 * deliberately left unacked so the credit window applies backpressure instead of
 * the buffer growing.
 */
export class PtyEventBuffer {
  private readonly sink: PtyEventSink;
  private readonly maxBytes: number;
  private readonly maxParkedIds: number;
  private readonly mappings = new Map<number, PtyMapping>();
  private readonly parked = new Map<number, PendingPtyEvents>();
  /**
   * ptyIds killed before (or without) a mapping. Output still in flight for them
   * is acked and dropped rather than parked for a mapping that will never come.
   */
  private readonly retired = new Set<number>();

  constructor(sink: PtyEventSink, options: PtyEventBufferOptions = {}) {
    this.sink = sink;
    this.maxBytes = options.maxBytes ?? PENDING_PTY_BUFFER_BYTES;
    this.maxParkedIds = options.maxParkedIds ?? MAX_PARKED_PTY_IDS;
  }

  /** How many unmapped ptyIds currently hold parked events. */
  get parkedCount() {
    return this.parked.size;
  }

  /**
   * Binds a ptyId to a session pane and drains whatever was parked for it, so
   * output that beat the spawn reply reaches the terminal before anything else
   * and the session starts at byte zero.
   */
  register(ptyId: number, info: PtyMapping) {
    this.mappings.set(ptyId, info);
    this.retired.delete(ptyId);
    this.flush(ptyId);
  }

  mappingFor(ptyId: number): PtyMapping | undefined {
    return this.mappings.get(ptyId);
  }

  unmap(ptyId: number) {
    this.mappings.delete(ptyId);
  }

  /**
   * A PTY killed before (or without) its mapping will never have a terminal to
   * write to, so drop whatever was parked for it and release the credit window.
   * The ptyId stays retired until its exit arrives so chunks still in flight are
   * acked and dropped instead of being parked again.
   */
  retire(ptyId: number) {
    const pending = this.parked.get(ptyId);
    this.parked.delete(ptyId);
    if (!pending?.exited) {
      this.retired.add(ptyId);
    }
    if (pending) {
      this.ackLastChunk(ptyId, pending);
    }
  }

  onOutput(ptyId: number, chunk: PendingPtyChunk) {
    const info = this.mappings.get(ptyId);
    if (info) {
      this.sink.write(ptyId, info, chunk);
      return;
    }
    if (this.retired.has(ptyId)) {
      // Killed before it was ever mapped: nothing will display this, so ack it
      // and drop it instead of parking it for a mapping that never comes.
      this.sink.ack(ptyId, chunk.endOffset);
      return;
    }
    // The spawn reply carrying this ptyId has not landed yet. Park the chunk
    // unacked; `register` replays it. Chunks stay unacked here so the 256 KiB
    // credit window throttles the producer, and the byte cap only matters if the
    // mapping never arrives at all.
    const pending = this.parked.get(ptyId) ?? { chunks: [], bytes: 0, exited: false };
    pending.chunks.push(chunk);
    pending.bytes += chunk.data.byteLength;
    while (pending.bytes > this.maxBytes && pending.chunks.length > 1) {
      // Drop oldest. Acks are cumulative, so writing the newest chunk later
      // still releases everything dropped here.
      const dropped = pending.chunks.shift();
      pending.bytes -= dropped?.data.byteLength ?? 0;
    }
    this.park(ptyId, pending);
  }

  onExit(ptyId: number) {
    const info = this.mappings.get(ptyId);
    if (info) {
      this.emitExit(ptyId, info);
      return;
    }
    const pending = this.parked.get(ptyId);
    if (pending) {
      // The addon holds the exit behind the output that preceded it, so the
      // parked chunks are complete. Replay ends with the normal exit handling.
      pending.exited = true;
      return;
    }
    if (this.retired.has(ptyId)) {
      // Killed before it was ever mapped, and its output is done arriving, so
      // stop retaining its id.
      this.retired.delete(ptyId);
      return;
    }
    // Nothing mapped, parked or retired: the exit beat the spawn reply and the
    // process produced no output at all. Park it so `register` replays it
    // instead of mapping a dead pty as live.
    this.park(ptyId, { chunks: [], bytes: 0, exited: true });
  }

  clear() {
    this.mappings.clear();
    this.parked.clear();
    this.retired.clear();
  }

  /**
   * Replays everything parked for a ptyId that just gained its mapping. The
   * chunks go through the sink's `write`, the same path live output takes, so
   * acks, follow state and unread badges behave identically.
   */
  private flush(ptyId: number) {
    const pending = this.parked.get(ptyId);
    if (!pending) {
      return;
    }
    this.parked.delete(ptyId);
    const info = this.mappings.get(ptyId);
    if (!info) {
      this.ackLastChunk(ptyId, pending);
      return;
    }
    pending.chunks.forEach((chunk) => {
      this.sink.write(ptyId, info, chunk);
    });
    if (pending.exited) {
      this.emitExit(ptyId, info);
    }
  }

  /**
   * Drops every trace of the ptyId before handing the exit to the sink, so a
   * caller that is still holding the spawn reply can tell the mapping is gone.
   */
  private emitExit(ptyId: number, info: PtyMapping) {
    this.mappings.delete(ptyId);
    this.parked.delete(ptyId);
    this.retired.delete(ptyId);
    this.sink.exit(ptyId, info);
  }

  private park(ptyId: number, pending: PendingPtyEvents) {
    this.parked.set(ptyId, pending);
    while (this.parked.size > this.maxParkedIds) {
      // Map iteration is insertion-ordered, so this is the oldest parked id.
      const oldest = this.parked.keys().next();
      if (oldest.done || oldest.value === ptyId) {
        return;
      }
      const evicted = this.parked.get(oldest.value);
      this.parked.delete(oldest.value);
      if (evicted) {
        this.ackLastChunk(oldest.value, evicted);
      }
    }
  }

  private ackLastChunk(ptyId: number, pending: PendingPtyEvents) {
    const lastChunk = pending.chunks[pending.chunks.length - 1];
    if (lastChunk) {
      this.sink.ack(ptyId, lastChunk.endOffset);
    }
  }
}
