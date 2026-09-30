import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, MessagePortMain } from "electron";

import type { NativeAddon } from "../native";
import { FLUSH_BYTES, FLUSH_INTERVAL_MS, PtyHub, attachPtyPort } from "./pty";

/**
 * `performance` on top of the vitest defaults: the batch pacing reads
 * `performance.now()` (a monotonic clock, so a backwards system clock cannot
 * arm an hours-long timer), and an unfaked one would make the coalescing
 * assertions depend on how fast the machine runs the test.
 */
const FAKE_TIMERS = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "Date",
  "performance",
] as const;

type PortMessage = { type: string; [key: string]: unknown };

class FakePort {
  readonly posted: PortMessage[] = [];
  closed = false;
  started = false;
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    this.closed = true;
  }

  postMessage(message: PortMessage): void {
    this.posted.push(message);
  }

  /** Pretend the renderer sent something. */
  send(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  /** Pretend the remote end went away. */
  disconnect(): void {
    for (const listener of this.listeners.get("close") ?? []) listener();
  }

  asPort(): MessagePortMain {
    return this as unknown as MessagePortMain;
  }
}

interface SpawnedSession {
  onData: (chunk: { sessionId: number; data: Buffer; endOffset: number }) => void;
  onExit: (sessionId: number) => void;
}

function fakeNative() {
  const sessions = new Map<number, SpawnedSession>();
  let nextId = 1;
  const calls = {
    writes: [] as { sessionId: number; data: string }[],
    acks: [] as { sessionId: number; throughOffset: number }[],
    kills: [] as number[],
    shutdowns: 0,
  };

  const native = {
    spawnPty: vi.fn(
      (
        _options: unknown,
        onData: SpawnedSession["onData"],
        onExit: SpawnedSession["onExit"],
      ) => {
        const id = nextId++;
        sessions.set(id, { onData, onExit });
        return id;
      },
    ),
    writePty: vi.fn((sessionId: number, data: string) => {
      calls.writes.push({ sessionId, data });
    }),
    resizePty: vi.fn(),
    ackPtyOutput: vi.fn((sessionId: number, throughOffset: number) => {
      calls.acks.push({ sessionId, throughOffset });
    }),
    killPty: vi.fn((sessionId: number) => {
      calls.kills.push(sessionId);
    }),
    shutdownAllPty: vi.fn(() => {
      calls.shutdowns += 1;
    }),
  };

  return { native: native as unknown as NativeAddon, sessions, calls, spy: native };
}

const spawnArgs = { shell: "/bin/zsh", args: [], cwd: "/tmp", env: {}, cols: 80, rows: 24 };

let cursor = 0;
function emit(session: SpawnedSession, sessionId: number, text: string): void {
  cursor += text.length;
  session.onData({ sessionId, data: Buffer.from(text, "utf8"), endOffset: cursor });
}

beforeEach(() => {
  cursor = 0;
  vi.useFakeTimers({ toFake: [...FAKE_TIMERS] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PtyHub batching", () => {
  it("posts the first chunk immediately", () => {
    const { native, sessions } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());

    const id = hub.spawn(spawnArgs);
    emit(sessions.get(id)!, id, "hello");

    expect(port.started).toBe(true);
    expect(port.posted).toHaveLength(1);
    expect(port.posted[0]).toMatchObject({ type: "data", sessionId: id, endOffset: 5 });
    expect((port.posted[0].data as Buffer).toString("utf8")).toBe("hello");
  });

  it("coalesces chunks inside the flush window into one message", () => {
    const { native, sessions } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());
    const id = hub.spawn(spawnArgs);
    const session = sessions.get(id)!;

    emit(session, id, "a"); // leading edge
    emit(session, id, "b");
    emit(session, id, "c");
    expect(port.posted).toHaveLength(1);

    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(port.posted).toHaveLength(2);
    expect((port.posted[1].data as Buffer).toString("utf8")).toBe("bc");
    // Cumulative acks make the last offset of the batch sufficient.
    expect(port.posted[1].endOffset).toBe(3);
  });

  it("flushes early once a batch reaches the byte threshold", () => {
    const { native, sessions } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());
    const id = hub.spawn(spawnArgs);
    const session = sessions.get(id)!;

    emit(session, id, "x"); // leading edge
    emit(session, id, "y".repeat(FLUSH_BYTES));

    expect(port.posted).toHaveLength(2);
    expect((port.posted[1].data as Buffer).byteLength).toBe(FLUSH_BYTES);
  });

  it("keeps sessions independent", () => {
    const { native, sessions } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());
    const first = hub.spawn(spawnArgs);
    const second = hub.spawn(spawnArgs);

    emit(sessions.get(first)!, first, "one");
    emit(sessions.get(second)!, second, "two");

    expect(port.posted.map((message) => message.sessionId)).toEqual([first, second]);
  });
});

describe("PtyHub flow control without a renderer", () => {
  it("holds output produced before the port arrives and delivers it on attach", () => {
    const { native, sessions, calls } = fakeNative();
    const hub = new PtyHub(native);
    // The renderer can invoke spawn as soon as its scripts run, which is before
    // did-finish-load hands the port over.
    const id = hub.spawn(spawnArgs);
    emit(sessions.get(id)!, id, "hello");

    expect(calls.acks).toEqual([]);

    const port = new FakePort();
    hub.attachPort(port.asPort());

    expect(port.posted).toHaveLength(1);
    expect(port.posted[0]).toMatchObject({ type: "data", sessionId: id, endOffset: 5 });
    expect((port.posted[0].data as Buffer).toString("utf8")).toBe("hello");
    // The renderer acks for itself now.
    expect(calls.acks).toEqual([]);
  });

  it("keeps an exit behind that session's queued output", () => {
    const { native, sessions } = fakeNative();
    const hub = new PtyHub(native);
    const id = hub.spawn(spawnArgs);
    const session = sessions.get(id)!;

    emit(session, id, "done"); // leading edge, but nowhere to post it yet
    emit(session, id, "!"); // still buffered behind the flush timer
    session.onExit(id);

    const port = new FakePort();
    hub.attachPort(port.asPort());

    expect(port.posted.map((message) => message.type)).toEqual(["data", "data", "exit"]);
    expect((port.posted[0].data as Buffer).toString("utf8")).toBe("done");
    expect((port.posted[1].data as Buffer).toString("utf8")).toBe("!");
    expect(port.posted[2]).toMatchObject({ type: "exit", sessionId: id });
  });

  it("acks and drops output from a session whose page is gone", () => {
    const { native, sessions, calls } = fakeNative();
    const hub = new PtyHub(native);
    const id = hub.spawn(spawnArgs);
    const session = sessions.get(id)!;

    hub.reset();
    emit(session, id, "late"); // a callback still in flight when the page went

    expect(calls.acks).toEqual([{ sessionId: id, throughOffset: 4 }]);
  });

  it("acks buffered bytes when the renderer disconnects mid-batch", () => {
    const { native, sessions, calls } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());
    const id = hub.spawn(spawnArgs);
    const session = sessions.get(id)!;

    emit(session, id, "a"); // leading edge, posted
    emit(session, id, "bc"); // buffered behind the timer
    port.disconnect();

    expect(calls.acks).toEqual([{ sessionId: id, throughOffset: 3 }]);
  });
});

describe("PtyHub port protocol", () => {
  it("forwards writes and acks to the addon", () => {
    const { native, calls } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());

    port.send({ type: "write", sessionId: 7, data: "ls\r" });
    port.send({ type: "ack", sessionId: 7, throughOffset: 4096 });
    port.send({ type: "nonsense" });
    port.send(null);

    expect(calls.writes).toEqual([{ sessionId: 7, data: "ls\r" }]);
    expect(calls.acks).toEqual([{ sessionId: 7, throughOffset: 4096 }]);
  });

  it("flushes pending output before announcing an exit", () => {
    const { native, sessions } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());
    const id = hub.spawn(spawnArgs);
    const session = sessions.get(id)!;

    emit(session, id, "a"); // leading edge
    emit(session, id, "bye"); // still buffered
    session.onExit(id);

    expect(port.posted.map((message) => message.type)).toEqual(["data", "data", "exit"]);
    expect((port.posted[1].data as Buffer).toString("utf8")).toBe("bye");
  });

  it("replaces a stale port on reload", () => {
    const { native } = fakeNative();
    const hub = new PtyHub(native);
    const first = new FakePort();
    const second = new FakePort();
    hub.attachPort(first.asPort());
    hub.attachPort(second.asPort());

    expect(first.closed).toBe(true);
    expect(second.started).toBe(true);
  });
});

describe("PtyHub reset", () => {
  it("closes the port and shuts every session down", () => {
    const { native, sessions, calls } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());
    const id = hub.spawn(spawnArgs);
    emit(sessions.get(id)!, id, "a");

    hub.reset();

    expect(port.closed).toBe(true);
    expect(calls.shutdowns).toBe(1);
  });

  it("still acks output it never managed to deliver", () => {
    const { native, sessions, calls } = fakeNative();
    const hub = new PtyHub(native);
    const id = hub.spawn(spawnArgs);
    emit(sessions.get(id)!, id, "hello"); // queued: the port never arrived

    hub.reset();

    expect(calls.acks).toEqual([{ sessionId: id, throughOffset: 5 }]);
    expect(calls.shutdowns).toBe(1);
  });

  it("pushes buffered output before killing a session", () => {
    const { native, sessions, calls } = fakeNative();
    const hub = new PtyHub(native);
    const port = new FakePort();
    hub.attachPort(port.asPort());
    const id = hub.spawn(spawnArgs);
    const session = sessions.get(id)!;

    emit(session, id, "a"); // leading edge
    emit(session, id, "tail"); // buffered
    hub.kill(id);

    expect((port.posted.at(-1)?.data as Buffer).toString("utf8")).toBe("tail");
    expect(calls.kills).toEqual([id]);
  });
});

class FakeContents {
  readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  readonly delivered: { channel: string; transfer: unknown[] }[] = [];

  on(event: string, listener: (...args: unknown[]) => void): this {
    const existing = this.handlers.get(event) ?? [];
    existing.push(listener);
    this.handlers.set(event, existing);
    return this;
  }

  postMessage(channel: string, _message: unknown, transfer: unknown[]): void {
    this.delivered.push({ channel, transfer });
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.handlers.get(event) ?? []) listener(...args);
  }

  asWindow(): BrowserWindow {
    return { webContents: this } as unknown as BrowserWindow;
  }
}

describe("attachPtyPort", () => {
  function setup() {
    const { native, sessions, calls } = fakeNative();
    const hub = new PtyHub(native);
    const contents = new FakeContents();
    const ports: FakePort[] = [];
    attachPtyPort(contents.asWindow(), hub, () => {
      const port1 = new FakePort();
      const port2 = new FakePort();
      ports.push(port1);
      return { port1: port1.asPort(), port2: port2.asPort() };
    });
    return { hub, contents, ports, sessions, calls };
  }

  it("hands the renderer a fresh port on every load", () => {
    const { contents, ports } = setup();

    contents.emit("did-finish-load");
    contents.emit("did-finish-load");

    expect(ports).toHaveLength(2);
    expect(ports[0].closed).toBe(true); // replaced by the second one
    expect(ports[1].started).toBe(true);
    expect(contents.delivered.map((entry) => entry.channel)).toEqual(["pty:port", "pty:port"]);
  });

  it("survives a navigation that never commits", () => {
    const { hub, contents, ports, sessions, calls } = setup();
    contents.emit("did-finish-load");
    const id = hub.spawn(spawnArgs);

    // A file dropped on the window: did-start-navigation fires, then
    // will-navigate cancels it and the page stays put. Nothing may be torn
    // down, and the port has to keep working.
    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    emit(sessions.get(id)!, id, "still here");

    expect(calls.shutdowns).toBe(0);
    expect(ports[0].closed).toBe(false);
    expect(ports[0].posted).toHaveLength(1);
  });

  it("tears the PTY world down once a navigation commits", () => {
    const { contents, ports, calls } = setup();
    contents.emit("did-finish-load");

    contents.emit("did-navigate");

    expect(calls.shutdowns).toBe(1);
    expect(ports[0].closed).toBe(true);
  });

  it("tears down on a lost renderer and on window destruction", () => {
    const { contents, calls } = setup();
    contents.emit("did-finish-load");

    contents.emit("render-process-gone");
    contents.emit("destroyed");

    expect(calls.shutdowns).toBe(2);
  });
});
