import { describe, expect, it } from "vitest";
import {
  MAX_PARKED_PTY_IDS,
  PtyEventBuffer,
  type PendingPtyChunk,
  type PtyEventSink,
  type PtyMapping,
} from "./ptyEventBuffer";

type RecordedEvent =
  | { type: "write"; ptyId: number; info: PtyMapping; text: string; endOffset: number }
  | { type: "exit"; ptyId: number; info: PtyMapping }
  | { type: "ack"; ptyId: number; throughOffset: number };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function chunk(text: string, endOffset: number): PendingPtyChunk {
  return { data: encoder.encode(text), endOffset };
}

function bytes(length: number, endOffset: number): PendingPtyChunk {
  return { data: new Uint8Array(length), endOffset };
}

function createSink() {
  const events: RecordedEvent[] = [];
  const sink: PtyEventSink = {
    write(ptyId, info, pendingChunk) {
      events.push({
        type: "write",
        ptyId,
        info,
        text: decoder.decode(pendingChunk.data),
        endOffset: pendingChunk.endOffset,
      });
    },
    exit(ptyId, info) {
      events.push({ type: "exit", ptyId, info });
    },
    ack(ptyId, throughOffset) {
      events.push({ type: "ack", ptyId, throughOffset });
    },
  };
  return { events, sink };
}

const agentMapping: PtyMapping = { sessionId: "session-a", kind: "agent", agentId: "claude" };
const terminalMapping: PtyMapping = { sessionId: "session-b", kind: "terminal" };

describe("PtyEventBuffer", () => {
  it("replays exactly one exit when the exit beats the spawn reply with no output", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink);

    buffer.onExit(7);
    expect(events).toEqual([]);
    expect(buffer.parkedCount).toBe(1);

    buffer.register(7, agentMapping);

    expect(events).toEqual([{ type: "exit", ptyId: 7, info: agentMapping }]);
    expect(buffer.parkedCount).toBe(0);
    // The mapping is gone, so the caller holding the spawn reply can tell the
    // pty is already dead and must not mark it running.
    expect(buffer.mappingFor(7)).toBeUndefined();
  });

  it("replays parked chunks in order and then the parked exit", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink);

    buffer.onOutput(3, chunk("first", 5));
    buffer.onOutput(3, chunk("second", 11));
    buffer.onExit(3);
    expect(events).toEqual([]);

    buffer.register(3, terminalMapping);

    expect(events).toEqual([
      { type: "write", ptyId: 3, info: terminalMapping, text: "first", endOffset: 5 },
      { type: "write", ptyId: 3, info: terminalMapping, text: "second", endOffset: 11 },
      { type: "exit", ptyId: 3, info: terminalMapping },
    ]);
    expect(buffer.parkedCount).toBe(0);
  });

  it("acks and drops output that arrives after the ptyId was retired", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink);

    buffer.retire(9);
    buffer.onOutput(9, chunk("late", 4));

    expect(events).toEqual([{ type: "ack", ptyId: 9, throughOffset: 4 }]);
    expect(buffer.parkedCount).toBe(0);
  });

  it("acks the last parked offset once when a ptyId with parked chunks is retired", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink);

    buffer.onOutput(4, chunk("one", 3));
    buffer.onOutput(4, chunk("two", 6));
    buffer.retire(4);

    expect(events).toEqual([{ type: "ack", ptyId: 4, throughOffset: 6 }]);
    expect(buffer.parkedCount).toBe(0);

    // Retiring again is a no-op: nothing is parked any more.
    buffer.retire(4);
    expect(events).toHaveLength(1);
  });

  it("does not retain a retired ptyId whose exit was already parked", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink);

    buffer.onOutput(4, chunk("one", 3));
    buffer.onOutput(4, chunk("two", 6));
    buffer.onExit(4);
    buffer.retire(4);

    expect(buffer["retired"].size).toBe(0);
    expect(buffer.parkedCount).toBe(0);
    expect(events).toEqual([{ type: "ack", ptyId: 4, throughOffset: 6 }]);
  });

  it("clears a retired ptyId on exit without calling the exit sink", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink);

    buffer.retire(9);
    expect(buffer["retired"].has(9)).toBe(true);
    buffer.onExit(9);

    expect(buffer["retired"].size).toBe(0);
    expect(buffer.parkedCount).toBe(0);
    expect(events).toEqual([]);
  });

  it("keeps the newest chunks when the parked byte cap is exceeded", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink, { maxBytes: 10 });

    buffer.onOutput(1, bytes(4, 4));
    buffer.onOutput(1, bytes(4, 8));
    buffer.onOutput(1, bytes(4, 12));
    buffer.register(1, agentMapping);

    const writes = events.filter((event) => event.type === "write");
    expect(writes.map((event) => (event.type === "write" ? event.endOffset : 0))).toEqual([8, 12]);
    // Acks are cumulative, so the surviving newest chunk still releases the
    // credit held by the dropped one.
    expect(events.some((event) => event.type === "ack")).toBe(false);
  });

  it("evicts the oldest parked ptyId when the parked-id cap is exceeded", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink, { maxParkedIds: 2 });

    buffer.onOutput(11, chunk("a", 1));
    buffer.onOutput(12, chunk("b", 2));
    buffer.onOutput(13, chunk("c", 3));

    expect(buffer.parkedCount).toBe(2);
    // The evicted id's credit is released rather than stranded.
    expect(events).toEqual([{ type: "ack", ptyId: 11, throughOffset: 1 }]);

    // The evicted id has nothing left to replay; the newer ones still do.
    buffer.register(11, agentMapping);
    buffer.register(12, agentMapping);
    const replayed = events.filter((event) => event.type === "write");
    expect(replayed.map((event) => (event.type === "write" ? event.ptyId : 0))).toEqual([12]);

    expect(MAX_PARKED_PTY_IDS).toBe(256);
  });

  it("treats a retired ptyId that is registered again as live", () => {
    const { events, sink } = createSink();
    const buffer = new PtyEventBuffer(sink);

    buffer.retire(5);
    buffer.register(5, agentMapping);
    buffer.onOutput(5, chunk("hello", 5));

    expect(events).toEqual([
      { type: "write", ptyId: 5, info: agentMapping, text: "hello", endOffset: 5 },
    ]);

    buffer.onExit(5);
    expect(events).toEqual([
      { type: "write", ptyId: 5, info: agentMapping, text: "hello", endOffset: 5 },
      { type: "exit", ptyId: 5, info: agentMapping },
    ]);
    expect(buffer.mappingFor(5)).toBeUndefined();
  });
});
