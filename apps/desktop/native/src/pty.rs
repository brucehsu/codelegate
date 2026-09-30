//! PTY sessions.
//!
//! Ported from the Tauri backend. `PtyOutputFlow` (the 256 KiB credit window
//! that keeps a runaway `yes` from drowning the renderer) is copied verbatim,
//! tests included. What changed for Electron:
//!
//! 1. the slave half of the pair is dropped right after spawning, otherwise the
//!    master never sees EOF;
//! 2. the read buffer is 64 KiB rather than 4 KiB;
//! 3. writes go to a per-session writer thread over an `mpsc` channel, so
//!    `writePty` never blocks the main thread while holding a global lock;
//! 4. the read thread reaps the child with `wait()`, and teardown signals the
//!    whole process group, with the grace window and the escalation to
//!    `SIGKILL` running off the calling thread (`PtyChild`);
//! 5. output and exit are delivered through unreferenced, non-blocking
//!    `ThreadsafeFunction`s instead of Tauri events, sequenced by `PtyExitGate`
//!    so exit never overtakes the trailing output.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard, RwLock, TryLockError};
use std::time::Duration;

use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, Status};
use napi_derive::napi;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

const PTY_OUTPUT_WINDOW_BYTES: u64 = 256 * 1024;
const PTY_READ_BUFFER_BYTES: usize = 64 * 1024;
/// How long a `SIGHUP`ed process group gets to leave on its own before
/// `SIGKILL`. Five polls at 50 ms, matching portable-pty's own grace window.
const PTY_KILL_GRACE_POLLS: u32 = 5;
const PTY_KILL_GRACE_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Default)]
struct PtyOutputFlowState {
  sent_offset: u64,
  acked_offset: u64,
  closed: bool,
}

#[derive(Default)]
struct PtyOutputFlow {
  state: Mutex<PtyOutputFlowState>,
  changed: Condvar,
}

impl PtyOutputFlow {
  fn wait_for_capacity(&self) -> bool {
    let mut state = self.state.lock().unwrap();
    while !state.closed
      && state.sent_offset.saturating_sub(state.acked_offset) >= PTY_OUTPUT_WINDOW_BYTES
    {
      state = self.changed.wait(state).unwrap();
    }
    !state.closed
  }

  fn record_sent(&self, byte_length: usize) -> Option<u64> {
    let mut state = self.state.lock().unwrap();
    if state.closed {
      return None;
    }
    state.sent_offset = state.sent_offset.saturating_add(byte_length as u64);
    Some(state.sent_offset)
  }

  fn acknowledge(&self, through_offset: u64) {
    let mut state = self.state.lock().unwrap();
    let next_offset = through_offset.min(state.sent_offset);
    if next_offset <= state.acked_offset {
      return;
    }
    state.acked_offset = next_offset;
    self.changed.notify_all();
  }

  fn close(&self) {
    let mut state = self.state.lock().unwrap();
    state.closed = true;
    self.changed.notify_all();
  }

  #[cfg(test)]
  fn outstanding_bytes(&self) -> u64 {
    let state = self.state.lock().unwrap();
    state.sent_offset.saturating_sub(state.acked_offset)
  }
}

#[cfg(test)]
mod pty_output_flow_tests {
  use super::{PtyOutputFlow, PTY_OUTPUT_WINDOW_BYTES};
  use std::{
    sync::{mpsc, Arc},
    thread,
    time::Duration,
  };

  #[test]
  fn cumulative_acknowledgements_are_monotonic_and_bounded() {
    let flow = PtyOutputFlow::default();
    let first_offset = flow.record_sent(4096).expect("flow should be open");
    let second_offset = flow.record_sent(4096).expect("flow should be open");

    assert_eq!(first_offset, 4096);
    assert_eq!(second_offset, 8192);
    assert_eq!(flow.outstanding_bytes(), 8192);

    flow.acknowledge(first_offset);
    assert_eq!(flow.outstanding_bytes(), 4096);

    flow.acknowledge(first_offset / 2);
    assert_eq!(flow.outstanding_bytes(), 4096);

    flow.acknowledge(second_offset + 4096);
    assert_eq!(flow.outstanding_bytes(), 0);

    flow.acknowledge(second_offset);
    assert_eq!(flow.outstanding_bytes(), 0);
  }

  #[test]
  fn acknowledgement_releases_a_blocked_reader() {
    let flow = Arc::new(PtyOutputFlow::default());
    flow
      .record_sent(PTY_OUTPUT_WINDOW_BYTES as usize)
      .expect("flow should be open");

    let waiting_flow = flow.clone();
    let (sender, receiver) = mpsc::channel();
    let waiter = thread::spawn(move || {
      sender
        .send(waiting_flow.wait_for_capacity())
        .expect("test receiver should stay open");
    });

    assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
    flow.acknowledge(4096);
    assert!(receiver
      .recv_timeout(Duration::from_secs(1))
      .expect("reader should be released"));
    waiter.join().expect("waiter should exit cleanly");
  }

  #[test]
  fn close_releases_a_blocked_reader_and_rejects_new_output() {
    let flow = Arc::new(PtyOutputFlow::default());
    flow
      .record_sent(PTY_OUTPUT_WINDOW_BYTES as usize)
      .expect("flow should be open");

    let waiting_flow = flow.clone();
    let (sender, receiver) = mpsc::channel();
    let waiter = thread::spawn(move || {
      sender
        .send(waiting_flow.wait_for_capacity())
        .expect("test receiver should stay open");
    });

    assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
    flow.close();
    assert!(!receiver
      .recv_timeout(Duration::from_secs(1))
      .expect("closed reader should be released"));
    assert!(flow.record_sent(1).is_none());
    waiter.join().expect("waiter should exit cleanly");
  }
}

// ---------------------------------------------------------------------------
// Child process
// ---------------------------------------------------------------------------

/// The shell spawned into a PTY, killed as a process group.
///
/// portable-pty calls `setsid()` in the child before `exec`, so the shell is a
/// session and process-group leader and its pid doubles as the pgid. Signalling
/// `-pid` therefore reaches the shell *and* everything it forked, which is what
/// the old single-pid `SIGHUP` missed: a backgrounded `nohup sleep 300` or any
/// descendant that ignores `SIGHUP` used to survive the session and, on Linux,
/// keep the master fd open so the reader never saw EOF.
///
/// Reaping is deliberately separate from killing. The reader thread is the sole
/// reaper on the normal path; `kill()` only signals. That matters for pid reuse:
/// a zombie keeps its pgid allocated, so as long as nothing has reaped the
/// leader, `kill(-pid, ...)` can only ever reach this session's own processes.
/// Once reaped the pgid may be recycled, so `reaped` latches and every later
/// `kill()` becomes a no-op. (`has_exited()` calls `try_wait`, which reaps a
/// child that already exited; it latches the same flag, and it never signals
/// afterwards.) The residual window is the instant between another thread's
/// `wait()` returning and this thread reading the flag, which no amount of
/// signal bookkeeping can close without holding the lock across a blocking
/// `wait()`.
struct PtyChild {
  /// pid of the session leader; `0` when the platform did not report one, in
  /// which case signalling is skipped rather than aimed at "every process we
  /// may signal", which is what `kill(0, ...)` would mean.
  pid: u32,
  handle: Mutex<Box<dyn Child + Send + Sync>>,
  reaped: AtomicBool,
}

impl PtyChild {
  fn new(child: Box<dyn Child + Send + Sync>) -> Self {
    let pid = child.process_id().unwrap_or(0);
    Self {
      pid,
      handle: Mutex::new(child),
      reaped: AtomicBool::new(false),
    }
  }

  /// Send `signal` to the child's whole process group. A group that is already
  /// gone (`ESRCH`) is success: the point of the call was that nothing survives.
  fn signal_group(&self, signal: i32) -> Result<(), String> {
    if self.pid == 0 || self.reaped.load(Ordering::SeqCst) {
      return Ok(());
    }
    // Safety: `kill` is async-signal-safe and takes no pointers; a negative pid
    // addresses the process group whose id is its absolute value.
    let sent = unsafe { libc::kill(-(self.pid as i32), signal) };
    if sent == 0 {
      return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
      return Ok(());
    }
    Err(format!(
      "Failed to signal PTY process group {}: {error}",
      self.pid
    ))
  }

  /// Non-blocking liveness check. A busy lock means another thread is parked in
  /// `wait()`, which is only ever the reader draining a child it has not seen
  /// exit yet, so report the child as alive rather than blocking teardown.
  fn has_exited(&self) -> bool {
    let mut handle = match self.handle.try_lock() {
      Ok(handle) => handle,
      Err(TryLockError::Poisoned(error)) => error.into_inner(),
      Err(TryLockError::WouldBlock) => return false,
    };
    match handle.try_wait() {
      Ok(Some(_)) => {
        self.reaped.store(true, Ordering::SeqCst);
        true
      }
      Ok(None) => false,
      // A child that cannot be waited on any more is not coming back.
      Err(_) => {
        self.reaped.store(true, Ordering::SeqCst);
        true
      }
    }
  }

  /// Ask the group to leave. Returns as soon as the signals are queued, so this
  /// is the half of a kill that is safe to run on the Node main thread.
  fn hangup(&self) -> Result<(), String> {
    if self.reaped.load(Ordering::SeqCst) {
      return Ok(());
    }
    let result = self.signal_group(libc::SIGHUP);
    // A stopped process (^Z, SIGTTIN on a background read) never runs its
    // SIGHUP handler and would sit out the whole grace window.
    let _ = self.signal_group(libc::SIGCONT);
    result
  }

  /// Wait out the grace window and `SIGKILL` whatever is still there. Polls
  /// before it sleeps, so a shell that took the `SIGHUP` costs no wall time.
  /// Blocking by nature: only ever called off the Node main thread.
  fn escalate(&self, hangup_result: Result<(), String>) -> Result<(), String> {
    for _ in 0..PTY_KILL_GRACE_POLLS {
      if self.has_exited() {
        return Ok(());
      }
      std::thread::sleep(PTY_KILL_GRACE_INTERVAL);
    }
    if self.has_exited() {
      return Ok(());
    }
    let result = self.signal_group(libc::SIGKILL);
    if hangup_result.is_err() && !self.has_exited() {
      return hangup_result;
    }
    result
  }

  /// `SIGHUP` the group, then `SIGKILL` it if anything is still there after the
  /// grace window. Never reaps: the reader thread owns that.
  fn kill(&self) -> Result<(), String> {
    if self.reaped.load(Ordering::SeqCst) {
      return Ok(());
    }
    let result = self.hangup();
    self.escalate(result)
  }

  /// Blocking reap. Idempotent: a second call finds the exit status cached.
  fn reap(&self) {
    let mut handle = self
      .handle
      .lock()
      .unwrap_or_else(|error| error.into_inner());
    let _ = handle.wait();
    self.reaped.store(true, Ordering::SeqCst);
  }
}

// ---------------------------------------------------------------------------
// Session table
// ---------------------------------------------------------------------------

struct PtySession {
  master: Mutex<Box<dyn MasterPty + Send>>,
  writes: Sender<Vec<u8>>,
  child: Arc<PtyChild>,
  output_flow: Arc<PtyOutputFlow>,
}

static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);
static SESSIONS: LazyLock<RwLock<HashMap<u32, Arc<PtySession>>>> =
  LazyLock::new(|| RwLock::new(HashMap::new()));
// Closed sessions leave SESSIONS immediately, but their escalation workers
// must remain owned until quit has waited for them to finish.
static KILL_WORKERS: Mutex<Vec<std::thread::JoinHandle<()>>> = Mutex::new(Vec::new());

fn sessions_read() -> std::sync::RwLockReadGuard<'static, HashMap<u32, Arc<PtySession>>> {
  SESSIONS.read().unwrap_or_else(|error| error.into_inner())
}

fn sessions_write() -> std::sync::RwLockWriteGuard<'static, HashMap<u32, Arc<PtySession>>> {
  SESSIONS.write().unwrap_or_else(|error| error.into_inner())
}

fn take_session(session_id: u32) -> Option<Arc<PtySession>> {
  sessions_write().remove(&session_id)
}

/// Finish a kill that has already been signalled: sit out the grace window,
/// `SIGKILL` whatever is left, and reap when the caller asks for it. The work
/// goes to a background thread so the caller (the Node main thread, in `killPty`)
/// returns at once. Quit joins it even after the session leaves the live table.
/// A child that is already gone skips the thread entirely, and
/// a thread that cannot be spawned falls back to doing it inline, since a leaked
/// shell is worse than a stalled call.
fn finish_kill_async(
  child: &Arc<PtyChild>,
  reap: bool,
  hangup_result: Result<(), String>,
) -> Result<(), String> {
  if child.has_exited() {
    if reap {
      child.reap();
    }
    return Ok(());
  }
  let worker = child.clone();
  let worker_hangup_result = hangup_result.clone();
  let mut workers = KILL_WORKERS.lock().unwrap_or_else(|error| error.into_inner());
  workers.retain(|worker| !worker.is_finished());
  let spawned = std::thread::Builder::new()
    .name("codelegate-pty-kill".to_string())
    .spawn(move || {
      let _ = worker.escalate(worker_hangup_result);
      if reap {
        worker.reap();
      }
    });
  match spawned {
    Ok(worker) => {
      workers.push(worker);
      Ok(())
    }
    Err(_) => {
      let result = child.escalate(hangup_result);
      if reap {
        child.reap();
      }
      result
    }
  }
}

/// Close the flow and hang up the child's process group, leaving the grace
/// window and any `SIGKILL` to a background thread. Closing one session issues two
/// of these from the Node main thread, so this must not block on a shell that
/// ignores `SIGHUP`. Never called while the session map is locked: the read
/// thread needs the map to drain.
fn terminate(session: &PtySession) -> Result<(), String> {
  session.output_flow.close();
  let result = session.child.hangup();
  finish_kill_async(&session.child, false, result)
}

/// Blocking variant for quit: the process must not exit before its shells are
/// actually gone, and `shutdown_all_pty`'s `thread::scope` join is exactly where
/// that waiting belongs.
fn terminate_blocking(session: &PtySession) -> Result<(), String> {
  session.output_flow.close();
  session.child.kill()
}

// ---------------------------------------------------------------------------
// JS surface
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct PtySpawnOptions {
  pub shell: String,
  pub args: Vec<String>,
  pub cwd: String,
  pub env: HashMap<String, String>,
  pub cols: u16,
  pub rows: u16,
}

#[napi(object)]
pub struct PtyChunk {
  pub session_id: u32,
  pub data: Buffer,
  /// Cumulative byte offset of the end of this chunk.
  pub end_offset: i64,
}

/// `CalleeHandled = false` (no leading `err` argument), `Weak = true` so a live
/// PTY never keeps the Node event loop from exiting.
type OnDataCallback = ThreadsafeFunction<PtyChunk, (), PtyChunk, Status, false, true>;
type OnExitCallback = ThreadsafeFunction<u32, (), u32, Status, false, true>;

/// Holds the exit callback back until the output that preceded it has actually
/// landed on the JS thread.
///
/// `onData` and `onExit` are two independent `ThreadsafeFunction`s, each with
/// its own libuv async handle, and nothing in Node-API orders one queue against
/// the other. Firing the exit straight after the last chunk therefore lets it
/// overtake output still queued behind it, and the renderer forgets the session
/// the moment it sees an exit, so that output would be dropped rather than
/// merely reordered. (The Tauri backend had no such hazard: `pty-output` and
/// `pty-exit` shared one ordered `app.emit` channel.)
///
/// Every chunk is sent with a completion callback that records its offset once
/// the JS callback has run. Whichever happens last, the reader finishing or the
/// final chunk being delivered, fires the exit exactly once. If a completion
/// callback never runs at all - the only way that happens is the environment
/// tearing the threadsafe function down mid-flight - the exit is not delivered,
/// which is harmless because the renderer is going away with it.
struct PtyExitGate {
  on_exit: OnExitCallback,
  state: Mutex<PtyExitGateState>,
}

#[derive(Default)]
struct PtyExitGateState {
  /// Highest offset handed to `onData`.
  sent_offset: i64,
  /// Highest offset whose `onData` call has completed on the JS thread.
  delivered_offset: i64,
  reader_finished: bool,
  fired: bool,
}

impl PtyExitGate {
  fn new(on_exit: OnExitCallback) -> Self {
    Self {
      on_exit,
      state: Mutex::new(PtyExitGateState::default()),
    }
  }

  fn lock(&self) -> MutexGuard<'_, PtyExitGateState> {
    self.state.lock().unwrap_or_else(|error| error.into_inner())
  }

  fn note_sent(&self, end_offset: i64) {
    let mut state = self.lock();
    if end_offset > state.sent_offset {
      state.sent_offset = end_offset;
    }
  }

  /// Called from the JS thread once a chunk's callback returned, and from the
  /// reader thread for a chunk the threadsafe function refused to queue (its
  /// completion callback will never run).
  fn note_delivered(&self, session_id: u32, end_offset: i64) {
    let ready = {
      let mut state = self.lock();
      if end_offset > state.delivered_offset {
        state.delivered_offset = end_offset;
      }
      Self::claim(&mut state)
    };
    if ready {
      self.fire(session_id);
    }
  }

  fn note_reader_finished(&self, session_id: u32) {
    let ready = {
      let mut state = self.lock();
      state.reader_finished = true;
      Self::claim(&mut state)
    };
    if ready {
      self.fire(session_id);
    }
  }

  fn claim(state: &mut PtyExitGateState) -> bool {
    if state.fired || !state.reader_finished || state.delivered_offset < state.sent_offset {
      return false;
    }
    state.fired = true;
    true
  }

  fn fire(&self, session_id: u32) {
    let _ = self
      .on_exit
      .call(session_id, ThreadsafeFunctionCallMode::NonBlocking);
  }
}

/// Give up on a half-built session: forget it if it was already published, hang
/// up the child's group (escalating and reaping on a background thread), then
/// report the failure. Without the reap the shell would be left as a zombie,
/// since the reader thread that normally waits on it is exactly what failed to
/// start.
fn abort_spawn(child: &Arc<PtyChild>, session_id: Option<u32>, message: String) -> Error {
  if let Some(session) = session_id.and_then(take_session) {
    session.output_flow.close();
  }
  let result = child.hangup();
  // The reader thread that normally reaps is exactly what is missing here, so
  // the escalation also reaps; without that the shell is left a zombie.
  let _ = finish_kill_async(child, true, result);
  Error::from_reason(message)
}

#[napi(ts_args_type = "options: PtySpawnOptions, onData: (chunk: PtyChunk) => void, \
                       onExit: (sessionId: number) => void")]
pub fn spawn_pty(
  options: PtySpawnOptions,
  on_data: OnDataCallback,
  on_exit: OnExitCallback,
) -> napi::Result<u32> {
  let PtySpawnOptions {
    shell,
    args,
    cwd,
    env,
    cols,
    rows,
  } = options;

  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: if rows == 0 { 24 } else { rows },
      cols: if cols == 0 { 80 } else { cols },
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| Error::from_reason(format!("Failed to open PTY: {error}")))?;

  let mut cmd = CommandBuilder::new(shell);
  cmd.args(args);
  if !cwd.trim().is_empty() {
    cmd.cwd(cwd);
  }
  for (key, value) in env {
    cmd.env(key, value);
  }

  let child = Arc::new(PtyChild::new(
    pair
      .slave
      .spawn_command(cmd)
      .map_err(|error| Error::from_reason(format!("Failed to spawn shell: {error}")))?,
  ));

  // The parent must not keep a slave handle open, or the master never reports
  // EOF once the child exits and the reader thread hangs forever.
  drop(pair.slave);

  let mut reader = pair.master.try_clone_reader().map_err(|error| {
    abort_spawn(
      &child,
      None,
      format!("Failed to clone PTY reader: {error}"),
    )
  })?;
  let mut writer = pair.master.take_writer().map_err(|error| {
    abort_spawn(&child, None, format!("Failed to open PTY writer: {error}"))
  })?;

  let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
  let output_flow = Arc::new(PtyOutputFlow::default());
  let exit_gate = Arc::new(PtyExitGate::new(on_exit));
  let (writes, pending_writes) = mpsc::channel::<Vec<u8>>();

  sessions_write().insert(
    id,
    Arc::new(PtySession {
      master: Mutex::new(pair.master),
      writes,
      child: child.clone(),
      output_flow: output_flow.clone(),
    }),
  );

  // Writer thread: keeps `writePty` off any blocking `write_all`. Ends when the
  // session is dropped from the table and the sender goes away.
  let writer_flow = output_flow.clone();
  if let Err(error) = std::thread::Builder::new()
    .name(format!("codelegate-pty-write-{id}"))
    .spawn(move || {
      while let Ok(bytes) = pending_writes.recv() {
        let result = match writer.write_all(&bytes) {
          Ok(()) => writer.flush(),
          Err(error) => Err(error),
        };
        // A write failure means input can never reach the child again. Closing
        // the flow ends the session visibly instead of leaving it alive with
        // every later keystroke silently dropped: it releases the reader from
        // the credit window and makes it stop at its next chunk, so `onExit`
        // fires and the renderer learns the session is gone.
        if let Err(error) = result {
          eprintln!("[pty] write failed for session {id}: {error}");
          writer_flow.close();
          break;
        }
      }
    })
  {
    return Err(abort_spawn(
      &child,
      Some(id),
      format!("Failed to start PTY writer thread: {error}"),
    ));
  }

  let reader_child = child.clone();
  if let Err(error) = std::thread::Builder::new()
    .name(format!("codelegate-pty-read-{id}"))
    .spawn(move || {
      let mut buf = vec![0u8; PTY_READ_BUFFER_BYTES];
      loop {
        if !output_flow.wait_for_capacity() {
          break;
        }
        match reader.read(&mut buf) {
          Ok(0) => break,
          Ok(n) => {
            let Some(end_offset) = output_flow.record_sent(n) else {
              break;
            };
            let offset = end_offset as i64;
            let chunk = PtyChunk {
              session_id: id,
              data: Buffer::from(&buf[..n]),
              end_offset: offset,
            };
            exit_gate.note_sent(offset);
            let delivered_gate = exit_gate.clone();
            let status = on_data.call_with_return_value(
              chunk,
              ThreadsafeFunctionCallMode::NonBlocking,
              move |result: napi::Result<()>, _env: Env| {
                // `call_with_return_value` hands a throwing JS callback back
                // here instead of routing it to `napi_fatal_exception`, so log
                // it rather than swallowing it.
                if let Err(error) = result {
                  eprintln!("[pty] onData callback failed for session {id}: {error}");
                }
                delivered_gate.note_delivered(id, offset);
                Ok(())
              },
            );
            // A dropped or closing callback can never ack, so self-ack to keep
            // the credit window from stalling the reader (this mirrors the
            // `emit().is_err()` branch in the Tauri backend). Its completion
            // callback will never run either, so release the gate by hand.
            if status != Status::Ok {
              output_flow.acknowledge(end_offset);
              exit_gate.note_delivered(id, offset);
            }
          }
          // A group kill hangs up the controlling tty, and the master half then
          // reports the child's departure differently per platform: macOS
          // returns `Ok(0)` (EOF), Linux fails the read with `EIO`. Both end
          // the loop, so the exit reaches JS either way.
          Err(_) => break,
        }
      }
      output_flow.close();
      exit_gate.note_reader_finished(id);
      // Dropping the session closes the master and stops the writer thread.
      let _ = take_session(id);
      // Sole reaper on the normal path, and the reason `kill()` only signals.
      reader_child.reap();
    })
  {
    return Err(abort_spawn(
      &child,
      Some(id),
      format!("Failed to start PTY reader thread: {error}"),
    ));
  }

  Ok(id)
}

/// Fire-and-forget: the renderer sends keystrokes over a `MessagePort` and has
/// no channel to receive an error on, so a write to a session that has already
/// exited is dropped rather than thrown.
#[napi]
pub fn write_pty(session_id: u32, data: String) {
  let writes = sessions_read()
    .get(&session_id)
    .map(|session| session.writes.clone());
  if let Some(writes) = writes {
    let _ = writes.send(data.into_bytes());
  }
}

// An unknown id is success, not an error: the session is removed from the
// table by the reader thread the moment the shell exits, while the renderer
// only learns about it once the exit callback lands, so a resize aimed at a
// pane whose shell just exited is a race, not a bug. Real ioctl failures still
// propagate.
#[napi]
pub fn resize_pty(session_id: u32, cols: u16, rows: u16) -> napi::Result<()> {
  let session = sessions_read().get(&session_id).cloned();
  let Some(session) = session else {
    return Ok(());
  };
  let master = session
    .master
    .lock()
    .unwrap_or_else(|error| error.into_inner());
  master
    .resize(PtySize {
      rows: if rows == 0 { 24 } else { rows },
      cols: if cols == 0 { 80 } else { cols },
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| Error::from_reason(format!("Failed to resize PTY: {error}")))
}

/// Cumulative acknowledgement, so a late ack for a session that already exited
/// is simply ignored.
#[napi]
pub fn ack_pty_output(session_id: u32, through_offset: i64) {
  let output_flow = sessions_read()
    .get(&session_id)
    .map(|session| session.output_flow.clone());
  if let Some(output_flow) = output_flow {
    output_flow.acknowledge(through_offset.max(0) as u64);
  }
}

// Idempotent: killing a session that has already gone is success. The renderer
// closes a tab against the state it last saw, so a shell that exited a moment
// earlier must not surface as "Session not found". (A plain comment, not a doc
// comment: `index.d.ts` is a checked-in contract and must not drift.)
#[napi]
pub fn kill_pty(session_id: u32) -> napi::Result<()> {
  let Some(session) = take_session(session_id) else {
    return Ok(());
  };
  terminate(&session).map_err(Error::from_reason)
}

#[napi]
pub fn shutdown_all_pty() {
  let sessions: Vec<Arc<PtySession>> = sessions_write().drain().map(|(_, value)| value).collect();
  // Each `terminate_blocking` can sit out the full grace window, so run them
  // together: N stubborn shells cost one window on quit, not N.
  std::thread::scope(|scope| {
    for session in &sessions {
      scope.spawn(move || {
        let _ = terminate_blocking(session);
      });
    }
  });
  // A recently closed tab (or failed spawn) may only have an escalation worker
  // left. Wait even when the live table was empty, and release the lock before
  // joining so cleanup never waits while holding the worker registry.
  let workers = std::mem::take(
    &mut *KILL_WORKERS.lock().unwrap_or_else(|error| error.into_inner()),
  );
  for worker in workers {
    let _ = worker.join();
  }
}

#[cfg(test)]
mod pty_child_tests {
  use super::{
    finish_kill_async, kill_pty, sessions_write, shutdown_all_pty, PtyChild, PtyOutputFlow,
    PtySession, NEXT_SESSION_ID, PTY_KILL_GRACE_INTERVAL,
  };
  use portable_pty::{native_pty_system, CommandBuilder, PtySize};
  use std::io::{BufRead, BufReader};
  use std::os::unix::process::CommandExt;
  use std::process::{Command, Stdio};
  use std::sync::atomic::Ordering;
  use std::sync::{mpsc, Arc, Mutex};
  use std::time::{Duration, Instant};

  /// Spawn `script` as its own process-group leader, mirroring the `setsid()`
  /// portable-pty performs before `exec`. `std::process::Child` implements
  /// `portable_pty::Child`, so it drops straight into `PtyChild`.
  fn spawn_leader(script: &str, stdout: Stdio) -> Command {
    let mut command = Command::new("/bin/sh");
    command
      .arg("-c")
      .arg(script)
      .process_group(0)
      .stdin(Stdio::null())
      .stdout(stdout)
      .stderr(Stdio::null());
    command
  }

  fn spawn_child(script: &str) -> PtyChild {
    let child = spawn_leader(script, Stdio::null())
      .spawn()
      .expect("test child should spawn");
    PtyChild::new(Box::new(child))
  }

  fn process_is_gone(pid: i32) -> bool {
    if unsafe { libc::kill(pid, 0) } == 0 {
      return false;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
  }

  fn wait_until(timeout: Duration, mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
      if done() {
        return true;
      }
      if Instant::now() >= deadline {
        return false;
      }
      std::thread::sleep(Duration::from_millis(20));
    }
  }

  #[test]
  fn a_sighup_honouring_child_dies_inside_the_grace_window() {
    let child = spawn_child("sleep 30");
    child.kill().expect("kill should succeed");

    assert!(
      wait_until(Duration::from_secs(2), || child.has_exited()),
      "child should be gone after kill"
    );
    child.reap();
  }

  #[test]
  fn a_grandchild_in_the_group_is_killed_with_the_leader() {
    let mut leader = spawn_leader("sleep 30 & echo $!; sleep 30", Stdio::piped())
      .spawn()
      .expect("test child should spawn");
    let stdout = leader.stdout.take().expect("stdout should be piped");
    let mut line = String::new();
    BufReader::new(stdout)
      .read_line(&mut line)
      .expect("grandchild should report its pid");
    let grandchild: i32 = line.trim().parse().expect("pid should parse");
    assert!(!process_is_gone(grandchild), "grandchild should be running");

    let child = PtyChild::new(Box::new(leader));
    child.kill().expect("kill should succeed");
    child.reap();

    assert!(
      wait_until(Duration::from_secs(2), || process_is_gone(grandchild)),
      "grandchild {grandchild} should be gone after the group kill"
    );
  }

  #[test]
  fn a_sighup_ignoring_child_is_killed_after_the_grace_window() {
    let child = spawn_child("trap \"\" HUP; sleep 30");
    // Give the shell a moment to install the trap, so the test exercises the
    // escalation rather than a race with process startup.
    std::thread::sleep(Duration::from_millis(100));
    let pid = child.pid as i32;

    let started = Instant::now();
    child.kill().expect("kill should succeed");
    let elapsed = started.elapsed();

    assert!(
      elapsed >= Duration::from_millis(150),
      "SIGKILL should only follow the grace window, took {elapsed:?}"
    );
    assert!(
      elapsed < Duration::from_secs(5),
      "kill should not hang, took {elapsed:?}"
    );
    child.reap();
    assert!(
      wait_until(Duration::from_secs(2), || process_is_gone(pid)),
      "SIGHUP-ignoring child {pid} should be killed"
    );
  }

  #[test]
  fn killing_a_reaped_child_is_a_no_op() {
    let child = spawn_child("exit 0");
    child.reap();
    child.reap();

    let started = Instant::now();
    child.kill().expect("kill after reap should succeed");
    assert!(
      started.elapsed() < Duration::from_millis(100),
      "kill after reap should not wait out the grace window"
    );
  }

  #[test]
  fn escalation_polls_before_it_sleeps() {
    let child = spawn_child("exit 0");
    assert!(
      wait_until(Duration::from_secs(2), || child.has_exited()),
      "child should exit on its own"
    );

    let started = Instant::now();
    child.escalate(Ok(())).expect("escalate should succeed");
    assert!(
      started.elapsed() < PTY_KILL_GRACE_INTERVAL,
      "an exited child should cost no wall time, took {:?}",
      started.elapsed()
    );
    child.reap();
  }

  #[test]
  fn a_background_kill_returns_at_once_and_still_kills() {
    let child = Arc::new(spawn_child("trap \"\" HUP; sleep 30"));
    // Give the shell a moment to install the trap, so the grace window and the
    // SIGKILL are what end it.
    std::thread::sleep(Duration::from_millis(100));
    let pid = child.pid as i32;

    let started = Instant::now();
    let result = child.hangup();
    finish_kill_async(&child, true, result).expect("background kill should succeed");
    let elapsed = started.elapsed();

    assert!(
      elapsed < PTY_KILL_GRACE_INTERVAL,
      "the caller must not wait out the grace window, took {elapsed:?}"
    );
    assert!(
      wait_until(Duration::from_secs(3), || process_is_gone(pid)),
      "SIGHUP-ignoring child {pid} should still be killed and reaped"
    );
  }

  #[test]
  fn shutdown_waits_for_a_session_already_being_killed() {
    let pair = native_pty_system()
      .openpty(PtySize::default())
      .expect("test PTY should open");
    let mut command = CommandBuilder::new("/bin/sh");
    command.args(["-c", "trap '' HUP; echo ready; while :; do sleep 1; done"]);
    let child = Arc::new(PtyChild::new(
      pair.slave.spawn_command(command).expect("child should spawn"),
    ));
    drop(pair.slave);
    let mut reader = BufReader::new(pair.master.try_clone_reader().expect("reader should open"));
    let mut ready = String::new();
    reader.read_line(&mut ready).expect("child should be ready");

    let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
    let (writes, _pending_writes) = mpsc::channel();
    sessions_write().insert(
      id,
      Arc::new(PtySession {
        master: Mutex::new(pair.master),
        writes,
        child: child.clone(),
        output_flow: Arc::new(PtyOutputFlow::default()),
      }),
    );

    kill_pty(id).expect("close should succeed");
    shutdown_all_pty();
    let exited = wait_until(Duration::from_millis(100), || child.has_exited());
    // Clean up even if shutdown returned before the escalation worker finished.
    child.kill().expect("test cleanup should succeed");
    child.reap();
    assert!(exited, "shutdown must finish killing a previously closed PTY");
    shutdown_all_pty();
  }

  #[test]
  fn has_exited_reports_a_running_child_as_alive() {
    let child = spawn_child("sleep 30");
    assert!(!child.has_exited(), "a sleeping child is still alive");
    child.kill().expect("kill should succeed");
    child.reap();
  }
}

#[cfg(test)]
mod session_table_tests {
  use super::{kill_pty, resize_pty};

  #[test]
  fn killing_an_unknown_session_succeeds() {
    kill_pty(u32::MAX).expect("kill of an already exited session should be a no-op");
  }

  #[test]
  fn resizing_an_unknown_session_succeeds() {
    resize_pty(u32::MAX, 80, 24).expect("resize of an already exited session should be a no-op");
  }
}
