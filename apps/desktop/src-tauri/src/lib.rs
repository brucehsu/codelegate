use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicU32, Ordering}, Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

struct AppState {
  next_id: AtomicU32,
  sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      next_id: AtomicU32::new(1),
      sessions: Arc::new(Mutex::new(HashMap::new())),
    }
  }
}

struct PtySession {
  master: Mutex<Box<dyn MasterPty + Send>>,
  writer: Mutex<Box<dyn Write + Send>>,
  killer: Mutex<Box<dyn ChildKiller + Send>>,
}

#[derive(Debug, Serialize, Clone)]
struct PtyOutput {
  session_id: u32,
  data: String,
}

#[derive(Debug, Serialize, Clone)]
struct PtyExit {
  session_id: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
  version: u8,
  settings: AppSettings,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
  theme: String,
  #[serde(default)]
  recent_dirs: Vec<String>,
  #[serde(default = "default_terminal_font_family")]
  terminal_font_family: String,
  #[serde(default = "default_terminal_font_size")]
  terminal_font_size: u16,
}

#[tauri::command]
fn get_default_shell() -> Result<String, String> {
  if let Ok(shell) = std::env::var("SHELL") {
    if !shell.trim().is_empty() {
      return Ok(shell);
    }
  }

  let candidates = ["/bin/zsh", "/bin/bash", "/usr/bin/zsh", "/usr/bin/bash", "/bin/sh"];
  for candidate in candidates {
    let path = Path::new(candidate);
    if path.exists() {
      return Ok(candidate.to_string());
    }
  }

  Err("Unable to determine default shell".to_string())
}

#[tauri::command]
fn exit_app() {
  std::process::exit(0);
}

#[tauri::command]
fn resolve_repo_root(path: String) -> Result<String, String> {
  if !Path::new(&path).exists() {
    return Err(format!("Repository path '{}' does not exist", path));
  }

  let output = std::process::Command::new("git")
    .arg("-C")
    .arg(&path)
    .arg("rev-parse")
    .arg("--show-toplevel")
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  if output.status.success() {
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
      Err("Unable to resolve repository root".to_string())
    } else {
      Ok(root)
    }
  } else {
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if err.is_empty() { "Selected directory is not a git repository".to_string() } else { err })
  }
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
  let file = config_file()?;
  if !file.exists() {
    return Ok(default_config());
  }

  let raw = std::fs::read_to_string(&file)
    .map_err(|error| format!("Failed to read config: {error}"))?;
  let config: AppConfig = serde_json::from_str(&raw)
    .map_err(|error| format!("Failed to parse config: {error}"))?;
  Ok(config)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
  let file = config_file()?;
  if let Some(parent) = file.parent() {
    std::fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create config directory: {error}"))?;
  }
  let payload = serde_json::to_string_pretty(&config)
    .map_err(|error| format!("Failed to serialize config: {error}"))?;
  std::fs::write(&file, payload)
    .map_err(|error| format!("Failed to write config: {error}"))?;
  Ok(())
}

#[tauri::command]
fn spawn_pty(
  app: AppHandle,
  state: State<'_, AppState>,
  shell: String,
  args: Vec<String>,
  cwd: String,
  env: HashMap<String, String>,
  cols: u16,
  rows: u16,
) -> Result<u32, String> {
  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: if rows == 0 { 24 } else { rows },
      cols: if cols == 0 { 80 } else { cols },
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| format!("Failed to open PTY: {error}"))?;

  let mut cmd = CommandBuilder::new(shell);
  cmd.args(args);
  if !cwd.trim().is_empty() {
    cmd.cwd(cwd);
  }
  for (key, value) in env {
    cmd.env(key, value);
  }

  let child = pair
    .slave
    .spawn_command(cmd)
    .map_err(|error| format!("Failed to spawn shell: {error}"))?;

  let mut reader = pair
    .master
    .try_clone_reader()
    .map_err(|error| format!("Failed to clone PTY reader: {error}"))?;
  let writer = pair
    .master
    .take_writer()
    .map_err(|error| format!("Failed to open PTY writer: {error}"))?;

  let id = state.next_id.fetch_add(1, Ordering::Relaxed);
  let sessions = state.sessions.clone();
  sessions.lock().unwrap().insert(
    id,
    PtySession {
      master: Mutex::new(pair.master),
      writer: Mutex::new(writer),
      killer: Mutex::new(child.clone_killer()),
    },
  );

  std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          let data = String::from_utf8_lossy(&buf[..n]).to_string();
          let _ = app.emit("pty-output", PtyOutput { session_id: id, data });
        }
        Err(_) => break,
      }
    }
    let _ = app.emit("pty-exit", PtyExit { session_id: id });
    let _ = sessions.lock().unwrap().remove(&id);
  });

  Ok(id)
}

#[tauri::command]
fn write_pty(state: State<'_, AppState>, session_id: u32, data: String) -> Result<(), String> {
  let sessions = state.sessions.lock().unwrap();
  let session = sessions
    .get(&session_id)
    .ok_or_else(|| "Session not found".to_string())?;
  let mut writer = session.writer.lock().unwrap();
  writer
    .write_all(data.as_bytes())
    .map_err(|error| format!("Failed to write to PTY: {error}"))?;
  writer
    .flush()
    .map_err(|error| format!("Failed to flush PTY: {error}"))?;
  Ok(())
}

#[tauri::command]
fn resize_pty(state: State<'_, AppState>, session_id: u32, cols: u16, rows: u16) -> Result<(), String> {
  let sessions = state.sessions.lock().unwrap();
  let session = sessions
    .get(&session_id)
    .ok_or_else(|| "Session not found".to_string())?;
  let master = session.master.lock().unwrap();
  master
    .resize(PtySize {
      rows: if rows == 0 { 24 } else { rows },
      cols: if cols == 0 { 80 } else { cols },
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| format!("Failed to resize PTY: {error}"))?;
  Ok(())
}

#[tauri::command]
fn kill_pty(state: State<'_, AppState>, session_id: u32) -> Result<(), String> {
  let mut sessions = state.sessions.lock().unwrap();
  let session = sessions
    .remove(&session_id)
    .ok_or_else(|| "Session not found".to_string())?;
  session
    .killer
    .lock()
    .unwrap()
    .kill()
    .map_err(|error| format!("Failed to kill PTY: {error}"))?;
  Ok(())
}

fn default_config() -> AppConfig {
  AppConfig {
    version: 1,
    settings: AppSettings {
      theme: "dark".to_string(),
      recent_dirs: Vec::new(),
      terminal_font_family: default_terminal_font_family(),
      terminal_font_size: default_terminal_font_size(),
    },
  }
}

fn config_file() -> Result<PathBuf, String> {
  let home = std::env::var_os("HOME")
    .map(PathBuf::from)
    .ok_or_else(|| "Unable to locate home directory".to_string())?;
  Ok(home.join(".codelegate").join("config.json"))
}

fn default_terminal_font_family() -> String {
  "\"JetBrains Mono\", \"SF Mono\", \"Fira Code\", monospace".to_string()
}

fn default_terminal_font_size() -> u16 {
  13
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      get_default_shell,
      exit_app,
      resolve_repo_root,
      load_config,
      save_config,
      spawn_pty,
      write_pty,
      resize_pty,
      kill_pty,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
