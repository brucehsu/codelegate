use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicU32, Ordering}, Arc, Mutex};
use tauri::{AppHandle, Emitter, RunEvent, State, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};
#[cfg(target_os = "macos")]
use tauri::Runtime;

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
  data_base64: String,
}

#[derive(Debug, Serialize, Clone)]
struct PtyExit {
  session_id: u32,
}

#[derive(Debug, Serialize)]
struct GitDiffFile {
  path: String,
  diff: String,
}

#[derive(Debug, Serialize)]
struct GitDiffPayload {
  staged: String,
  unstaged: String,
  untracked: Vec<GitDiffFile>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
  version: u8,
  settings: AppSettings,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvVar {
  key: String,
  value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoDefaults {
  #[serde(default)]
  env: Vec<EnvVar>,
  #[serde(default)]
  pre_commands: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeConfig {
  enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoConfigSnapshot {
  repo_path: String,
  agent: String,
  #[serde(default)]
  env: Vec<EnvVar>,
  #[serde(default)]
  pre_commands: String,
  #[serde(default)]
  worktree: Option<WorktreeConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviousSessionEntry {
  repo: RepoConfigSnapshot,
  #[serde(default)]
  cwd: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviousSessionsPayload {
  #[serde(default)]
  sessions: Vec<PreviousSessionEntry>,
  #[serde(default)]
  active_index: usize,
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
  #[serde(default = "default_shortcut_modifier")]
  shortcut_modifier: String,
  #[serde(default = "default_battery_saver", alias = "backgroundAnimation")]
  battery_saver: bool,
  #[serde(default)]
  repo_defaults: HashMap<String, RepoDefaults>,
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
fn get_home_dir() -> Result<String, String> {
  let home = std::env::var_os("HOME")
    .map(PathBuf::from)
    .ok_or_else(|| "Unable to locate home directory".to_string())?;
  Ok(home.to_string_lossy().to_string())
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
fn get_git_branch(path: String) -> Result<String, String> {
  if !Path::new(&path).exists() {
    return Err(format!("Path '{}' does not exist", path));
  }

  let output = std::process::Command::new("git")
    .arg("-C")
    .arg(&path)
    .arg("rev-parse")
    .arg("--abbrev-ref")
    .arg("HEAD")
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  if output.status.success() {
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
      return Err("Unable to determine git branch".to_string());
    }
    if branch == "HEAD" {
      let detached = std::process::Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("rev-parse")
        .arg("--short")
        .arg("HEAD")
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;
      if detached.status.success() {
        let sha = String::from_utf8_lossy(&detached.stdout).trim().to_string();
        if !sha.is_empty() {
          return Ok(sha);
        }
      }
      return Err("Unable to determine git branch".to_string());
    }
    Ok(branch)
  } else {
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if err.is_empty() { "Selected directory is not a git repository".to_string() } else { err })
  }
}

#[tauri::command]
fn rename_git_branch(path: String, name: String) -> Result<String, String> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err("Branch name cannot be empty".to_string());
  }
  if !Path::new(&path).exists() {
    return Err(format!("Path '{}' does not exist", path));
  }

  let output = std::process::Command::new("git")
    .arg("-C")
    .arg(&path)
    .arg("branch")
    .arg("-m")
    .arg(trimmed)
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  if output.status.success() {
    Ok(trimmed.to_string())
  } else {
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if err.is_empty() { "Failed to rename branch".to_string() } else { err })
  }
}

fn run_git_diff(args: &[&str]) -> Result<String, String> {
  let output = std::process::Command::new("git")
    .args(args)
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  if !output.status.success() && stdout.is_empty() && !stderr.is_empty() {
    return Err(stderr);
  }
  Ok(stdout)
}

fn run_git_command(args: &[&str], fallback_error: &str) -> Result<(), String> {
  let output = std::process::Command::new("git")
    .args(args)
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  if output.status.success() {
    return Ok(());
  }

  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  Err(if !stderr.is_empty() {
    stderr
  } else if !stdout.is_empty() {
    stdout
  } else {
    fallback_error.to_string()
  })
}

fn has_git_head(root: &str) -> Result<bool, String> {
  let output = std::process::Command::new("git")
    .arg("-C")
    .arg(root)
    .arg("rev-parse")
    .arg("--verify")
    .arg("HEAD")
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;
  Ok(output.status.success())
}

fn get_untracked_files(root: &str) -> Result<Vec<String>, String> {
  let output = std::process::Command::new("git")
    .arg("-C")
    .arg(root)
    .arg("status")
    .arg("--porcelain=v1")
    .arg("--untracked-files=all")
    .arg("-z")
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  if !output.status.success() {
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if err.is_empty() { "Failed to get git status".to_string() } else { err });
  }

  let mut files = Vec::new();
  for entry in output.stdout.split(|b| *b == 0) {
    if entry.is_empty() {
      continue;
    }
    if entry.starts_with(b"?? ") {
      let path_bytes = &entry[3..];
      let path = String::from_utf8_lossy(path_bytes).to_string();
      if !path.is_empty() {
        if Path::new(root).join(&path).is_dir() {
          continue;
        }
        files.push(path);
      }
    }
  }
  Ok(files)
}

#[tauri::command]
fn get_git_diff(path: String) -> Result<GitDiffPayload, String> {
  let root = resolve_repo_root(path.clone())?;
  if !Path::new(&root).exists() {
    return Err(format!("Path '{}' does not exist", root));
  }

  let unstaged = run_git_diff(&[
    "-C",
    &root,
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--unified=3",
  ])?;

  let staged = run_git_diff(&[
    "-C",
    &root,
    "diff",
    "--staged",
    "--no-color",
    "--no-ext-diff",
    "--unified=3",
  ])?;

  let mut untracked = Vec::new();
  for file in get_untracked_files(&root)? {
    let file_diff = run_git_diff(&[
      "-C",
      &root,
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "--no-index",
      "--",
      "/dev/null",
      &file,
    ])?;
    untracked.push(GitDiffFile { path: file, diff: file_diff });
  }

  Ok(GitDiffPayload {
    staged,
    unstaged,
    untracked,
  })
}

#[tauri::command]
fn stage_all_changes(path: String) -> Result<(), String> {
  let root = resolve_repo_root(path)?;
  if !Path::new(&root).exists() {
    return Err(format!("Path '{}' does not exist", root));
  }
  run_git_command(&["-C", &root, "add", "--all"], "Failed to stage changes")
}

#[tauri::command]
fn unstage_all_changes(path: String) -> Result<(), String> {
  let root = resolve_repo_root(path)?;
  if !Path::new(&root).exists() {
    return Err(format!("Path '{}' does not exist", root));
  }

  if has_git_head(&root)? {
    run_git_command(
      &["-C", &root, "restore", "--staged", "--", "."],
      "Failed to unstage changes",
    )
  } else {
    run_git_command(
      &["-C", &root, "rm", "--cached", "-r", "--ignore-unmatch", "--", "."],
      "Failed to unstage changes",
    )
  }
}

#[tauri::command]
fn discard_all_changes(path: String) -> Result<(), String> {
  let root = resolve_repo_root(path)?;
  if !Path::new(&root).exists() {
    return Err(format!("Path '{}' does not exist", root));
  }

  let restore_result = run_git_command(
    &["-C", &root, "restore", "--worktree", "--", "."],
    "Failed to discard unstaged changes",
  );
  if let Err(message) = restore_result {
    let ignore_pathspec_error =
      message.contains("did not match any file(s) known to git")
      || message.contains("pathspec '.'");
    if !ignore_pathspec_error {
      return Err(message);
    }
  }

  run_git_command(
    &["-C", &root, "clean", "-fd", "--", "."],
    "Failed to discard untracked changes",
  )
}

#[tauri::command]
fn commit_git_changes(path: String, message: String, amend: bool) -> Result<(), String> {
  let root = resolve_repo_root(path)?;
  if !Path::new(&root).exists() {
    return Err(format!("Path '{}' does not exist", root));
  }

  let trimmed = message.trim();
  if trimmed.is_empty() {
    return Err("Commit message cannot be empty".to_string());
  }

  let mut command = std::process::Command::new("git");
  command
    .arg("-C")
    .arg(&root)
    .arg("commit")
    .arg("-m")
    .arg(trimmed);
  if amend {
    command.arg("--amend");
  }

  let output = command
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  if output.status.success() {
    return Ok(());
  }

  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  Err(if !stderr.is_empty() {
    stderr
  } else if !stdout.is_empty() {
    stdout
  } else {
    "Failed to commit changes".to_string()
  })
}

#[tauri::command]
fn get_last_commit_message(path: String) -> Result<String, String> {
  let root = resolve_repo_root(path)?;
  if !Path::new(&root).exists() {
    return Err(format!("Path '{}' does not exist", root));
  }

  let output = std::process::Command::new("git")
    .arg("-C")
    .arg(&root)
    .arg("log")
    .arg("-1")
    .arg("--pretty=%B")
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Unable to read previous commit message".to_string()
    } else {
      stderr
    });
  }

  let message = String::from_utf8_lossy(&output.stdout)
    .trim_end_matches(['\r', '\n'])
    .to_string();
  if message.is_empty() {
    return Err("Previous commit message is empty".to_string());
  }
  Ok(message)
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
  let file = config_file()?;
  if !file.exists() {
    return Ok(default_config());
  }

  let raw = std::fs::read_to_string(&file)
    .map_err(|error| format!("Failed to read config: {error}"))?;
  let mut value: serde_json::Value = serde_json::from_str(&raw)
    .map_err(|error| format!("Failed to parse config: {error}"))?;
  if let Some(settings) = value.get_mut("settings") {
    let has_battery = settings.get("batterySaver").is_some();
    if !has_battery {
      if let Some(background) = settings.get("backgroundAnimation").and_then(|val| val.as_bool()) {
        settings["batterySaver"] = serde_json::Value::Bool(!background);
      }
    }
  }
  let config: AppConfig = serde_json::from_value(value)
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
fn load_previous_sessions() -> Result<Option<PreviousSessionsPayload>, String> {
  let file = previous_sessions_file()?;
  if !file.exists() {
    return Ok(None);
  }
  let raw = std::fs::read_to_string(&file)
    .map_err(|error| format!("Failed to read previous sessions: {error}"))?;
  let payload: PreviousSessionsPayload = serde_json::from_str(&raw)
    .map_err(|error| format!("Failed to parse previous sessions: {error}"))?;
  Ok(Some(payload))
}

#[tauri::command]
fn save_previous_sessions(payload: PreviousSessionsPayload) -> Result<(), String> {
  let file = previous_sessions_file()?;
  if let Some(parent) = file.parent() {
    std::fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create previous sessions directory: {error}"))?;
  }
  let payload = serde_json::to_string_pretty(&payload)
    .map_err(|error| format!("Failed to serialize previous sessions: {error}"))?;
  std::fs::write(&file, payload)
    .map_err(|error| format!("Failed to write previous sessions: {error}"))?;
  Ok(())
}

#[tauri::command]
fn clear_previous_sessions() -> Result<(), String> {
  let file = previous_sessions_file()?;
  if file.exists() {
    std::fs::remove_file(&file)
      .map_err(|error| format!("Failed to remove previous sessions: {error}"))?;
  }
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
          let data_base64 = general_purpose::STANDARD.encode(&buf[..n]);
          let _ = app.emit("pty-output", PtyOutput { session_id: id, data_base64 });
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
      shortcut_modifier: default_shortcut_modifier(),
      battery_saver: default_battery_saver(),
      repo_defaults: HashMap::new(),
    },
  }
}

fn config_file() -> Result<PathBuf, String> {
  let home = std::env::var_os("HOME")
    .map(PathBuf::from)
    .ok_or_else(|| "Unable to locate home directory".to_string())?;
  Ok(home.join(".codelegate").join("config.json"))
}

fn previous_sessions_file() -> Result<PathBuf, String> {
  let home = std::env::var_os("HOME")
    .map(PathBuf::from)
    .ok_or_else(|| "Unable to locate home directory".to_string())?;
  Ok(home.join(".codelegate").join("previous_sessions.json"))
}

#[cfg(target_os = "macos")]
fn build_macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
  let quit = MenuItemBuilder::with_id("app-quit", "Quit Codelegate")
    .accelerator("Cmd+Q")
    .build(app)?;

  let app_menu = Submenu::with_items(
    app,
    "Codelegate",
    true,
    &[
      &PredefinedMenuItem::about(app, None, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::services(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::hide(app, None)?,
      &PredefinedMenuItem::hide_others(app, None)?,
      &PredefinedMenuItem::show_all(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &quit,
    ],
  )?;

  let edit_menu = Submenu::with_items(
    app,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::undo(app, None)?,
      &PredefinedMenuItem::redo(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::cut(app, None)?,
      &PredefinedMenuItem::copy(app, None)?,
      &PredefinedMenuItem::paste(app, None)?,
      &PredefinedMenuItem::select_all(app, None)?,
    ],
  )?;

  let window_menu = Submenu::with_items(
    app,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(app, None)?,
      &PredefinedMenuItem::fullscreen(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::close_window(app, None)?,
    ],
  )?;

  Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

fn default_terminal_font_family() -> String {
  "\"JetBrains Mono\", \"SF Mono\", \"Fira Code\", monospace".to_string()
}

fn default_terminal_font_size() -> u16 {
  13
}

fn default_battery_saver() -> bool {
  false
}

fn default_shortcut_modifier() -> String {
  "Alt".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      get_default_shell,
      get_home_dir,
      exit_app,
      resolve_repo_root,
      get_git_branch,
      rename_git_branch,
      get_git_diff,
      stage_all_changes,
      unstage_all_changes,
      discard_all_changes,
      commit_git_changes,
      get_last_commit_message,
      load_config,
      save_config,
      load_previous_sessions,
      save_previous_sessions,
      clear_previous_sessions,
      spawn_pty,
      write_pty,
      resize_pty,
      kill_pty,
    ]);

  #[cfg(target_os = "macos")]
  let builder = builder
    .menu(|app| build_macos_menu(app))
    .on_menu_event(|app, event| {
      if event.id() == "app-quit" {
        let _ = app.emit("app-exit-requested", ());
      }
    })
    .enable_macos_default_menu(false);

  let app = builder
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    let emit_exit = || {
      let _ = app_handle.emit("app-exit-requested", ());
    };
    match event {
      RunEvent::ExitRequested { api, .. } => {
        api.prevent_exit();
        emit_exit();
      }
      RunEvent::WindowEvent {
        event: WindowEvent::CloseRequested { api, .. },
        ..
      } => {
        api.prevent_close();
        emit_exit();
      }
      _ => {}
    }
  });
}
