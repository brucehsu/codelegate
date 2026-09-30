//! N-API addon for Codelegate Desktop.
//!
//! Two responsibilities, mirroring the Tauri backend this replaces:
//!
//! * `pty`: PTY sessions with the 256 KiB credit-window flow control.
//! * `git`: libgit2 diff/status plus the `git` CLI helpers below.
//!
//! `git.rs` is a byte-for-byte move from the Tauri crate and reaches back into
//! this module for `resolve_repo_root`, so the repo-root/branch/worktree
//! helpers live here rather than in `git.rs`.

use std::path::{Component, Path, PathBuf};

use napi::bindgen_prelude::{AsyncTask, ToNapiValue, TypeName};
use napi::{Env, Error, Task, ValueType};
use napi_derive::napi;

mod git;
// `cargo test --features noop` builds this cdylib as a test harness, where the
// PTY exports have no Rust caller and would all read as dead code.
#[cfg_attr(test, allow(dead_code))]
mod pty;

// ---------------------------------------------------------------------------
// Async plumbing shared by every git export
// ---------------------------------------------------------------------------

/// A `serde_json::Value` that can be resolved out of an [`AsyncTask`].
///
/// `napi` implements `ToNapiValue` for `serde_json::Value` but not `TypeName`,
/// which `Task::JsValue` requires. Every git export overrides the generated
/// TypeScript with `ts_return_type`, so the name reported here is never used.
pub struct JsonValue(pub serde_json::Value);

impl TypeName for JsonValue {
  fn type_name() -> &'static str {
    "unknown"
  }

  fn value_type() -> ValueType {
    ValueType::Unknown
  }
}

impl ToNapiValue for JsonValue {
  unsafe fn to_napi_value(
    env: napi::sys::napi_env,
    val: Self,
  ) -> napi::Result<napi::sys::napi_value> {
    unsafe { serde_json::Value::to_napi_value(env, val.0) }
  }
}

type BlockingJob = Box<dyn FnOnce() -> Result<serde_json::Value, String> + Send>;

/// One generic task for all 13 git exports.
///
/// The closure runs on a libuv worker thread and serializes its payload there
/// too, so neither libgit2 nor `serde_json` ever touches the main thread.
pub struct Blocking(Option<BlockingJob>);

impl Blocking {
  fn new<T, F>(job: F) -> Self
  where
    T: serde::Serialize,
    F: FnOnce() -> Result<T, String> + Send + 'static,
  {
    Self(Some(Box::new(move || {
      let payload = job()?;
      serde_json::to_value(payload)
        .map_err(|error| format!("Failed to serialize git payload: {error}"))
    })))
  }
}

impl Task for Blocking {
  type Output = serde_json::Value;
  type JsValue = JsonValue;

  fn compute(&mut self) -> napi::Result<Self::Output> {
    let job = self
      .0
      .take()
      .ok_or_else(|| Error::from_reason("Blocking task was already run"))?;
    job().map_err(Error::from_reason)
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(JsonValue(output))
  }
}

fn parse_diff_section(section: &str) -> Result<git::GitDiffSection, String> {
  serde_json::from_value(serde_json::Value::String(section.to_string()))
    .map_err(|_| format!("Unknown git diff section '{section}'"))
}

// ---------------------------------------------------------------------------
// Git exports
// ---------------------------------------------------------------------------

#[napi(ts_return_type = "Promise<string>")]
pub fn get_git_branch(path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || get_git_branch_blocking(path)))
}

#[napi(ts_return_type = "Promise<Array<GitBranchInfo>>")]
pub fn list_git_branches(path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || git::list_git_branches(path)))
}

#[napi(ts_return_type = "Promise<string>")]
pub fn rename_git_branch(path: String, name: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || rename_git_branch_blocking(path, name)))
}

#[napi(ts_return_type = "Promise<GitChangeSummaryPayload>")]
pub fn get_git_change_summary(path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || git::get_git_change_summary(path)))
}

#[napi(ts_return_type = "Promise<GitFileDiffPayload>")]
pub fn get_git_file_diff(
  path: String,
  section: String,
  file_path: String,
  old_path: Option<String>,
) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || {
    let section = parse_diff_section(&section)?;
    git::get_git_file_diff(path, section, file_path, old_path)
  }))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn stage_all_changes(path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || git::stage_all_changes(path)))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn unstage_all_changes(path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || git::unstage_all_changes(path)))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn discard_all_changes(path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || git::discard_all_changes(path)))
}

#[napi(ts_return_type = "Promise<GitChangeSummaryPayload>")]
pub fn stage_file_change(path: String, file_path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || {
    git::stage_file_change_with_summary(path, file_path)
  }))
}

#[napi(ts_return_type = "Promise<GitChangeSummaryPayload>")]
pub fn unstage_file_change(path: String, file_path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || {
    git::unstage_file_change_with_summary(path, file_path)
  }))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn commit_git_changes(path: String, message: String, amend: bool) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || {
    git::commit_git_changes(path, message, amend)
  }))
}

#[napi(ts_return_type = "Promise<string>")]
pub fn get_last_commit_message(path: String) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || git::get_last_commit_message(path)))
}

#[napi(ts_return_type = "Promise<void>")]
pub fn remove_session_worktree(
  repo_path: String,
  worktree_path: String,
  branch: Option<String>,
) -> AsyncTask<Blocking> {
  AsyncTask::new(Blocking::new(move || {
    remove_session_worktree_blocking(repo_path, worktree_path, branch)
  }))
}

// ---------------------------------------------------------------------------
// Blocking git helpers (moved verbatim from the Tauri `lib.rs`)
// ---------------------------------------------------------------------------

pub(crate) fn resolve_repo_root(path: String) -> Result<String, String> {
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
    Err(if err.is_empty() {
      "Selected directory is not a git repository".to_string()
    } else {
      err
    })
  }
}

fn get_git_branch_blocking(path: String) -> Result<String, String> {
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
    Err(if err.is_empty() {
      "Selected directory is not a git repository".to_string()
    } else {
      err
    })
  }
}

fn rename_git_branch_blocking(path: String, name: String) -> Result<String, String> {
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
    Err(if err.is_empty() {
      "Failed to rename branch".to_string()
    } else {
      err
    })
  }
}

fn worktrees_root_dir() -> Result<PathBuf, String> {
  let home = std::env::var_os("HOME")
    .map(PathBuf::from)
    .ok_or_else(|| "Unable to locate home directory".to_string())?;
  Ok(home.join(".codelegate").join("worktrees"))
}

/// Canonicalizes the longest existing prefix of `path` and re-appends the components that do not
/// exist yet. A worktree directory that is already gone (the stale case) therefore resolves the
/// same way as one that still exists, so a symlinked `$HOME` cannot make the two disagree.
fn canonicalize_deepest_existing_ancestor(path: &Path) -> PathBuf {
  let mut prefix = path.to_path_buf();
  let mut tail: Vec<std::ffi::OsString> = Vec::new();

  loop {
    if let Ok(canonical) = prefix.canonicalize() {
      let mut resolved = canonical;
      for component in tail.iter().rev() {
        resolved.push(component);
      }
      return resolved;
    }

    let Some(name) = prefix.file_name().map(|value| value.to_os_string()) else {
      return path.to_path_buf();
    };
    tail.push(name);
    if !prefix.pop() {
      return path.to_path_buf();
    }
  }
}

/// True when `worktree` is strictly inside the managed worktrees `root`. Both sides are resolved
/// the same way, so a symlinked root matches whether the caller passed the raw or the canonical
/// form. The root itself is rejected, `..` is rejected outright, and because the comparison is
/// component-wise a lexical sibling such as `<root>-evil` never matches.
fn worktree_is_managed(worktree: &Path, root: &Path) -> bool {
  if !worktree.is_absolute() || !root.is_absolute() {
    return false;
  }
  if worktree
    .components()
    .any(|component| matches!(component, Component::ParentDir))
  {
    return false;
  }

  let resolved_worktree = canonicalize_deepest_existing_ancestor(worktree);
  let resolved_root = canonicalize_deepest_existing_ancestor(root);
  resolved_worktree != resolved_root && resolved_worktree.starts_with(&resolved_root)
}

fn remove_session_worktree_blocking(
  repo_path: String,
  worktree_path: String,
  branch: Option<String>,
) -> Result<(), String> {
  let worktrees_root = worktrees_root_dir()?;
  remove_session_worktree_with_root(&worktrees_root, repo_path, worktree_path, branch)
}

fn remove_session_worktree_with_root(
  worktrees_root: &Path,
  repo_path: String,
  worktree_path: String,
  branch: Option<String>,
) -> Result<(), String> {
  let root = resolve_repo_root(repo_path)?;
  if !Path::new(&root).exists() {
    return Err(format!("Path '{}' does not exist", root));
  }

  let trimmed_worktree = worktree_path.trim();
  if trimmed_worktree.is_empty() {
    return Err("Worktree path cannot be empty".to_string());
  }

  let worktree = PathBuf::from(trimmed_worktree);
  if !worktree.is_absolute() {
    return Err("Worktree path must be absolute".to_string());
  }
  if !worktree_is_managed(&worktree, worktrees_root) {
    return Err("Worktree path is outside managed Codelegate worktrees".to_string());
  }

  let worktree_path = Path::new(trimmed_worktree);
  let worktree_exists_before = worktree_path.exists();

  let remove_output = std::process::Command::new("git")
    .arg("-C")
    .arg(&root)
    .arg("worktree")
    .arg("remove")
    .arg("--force")
    .arg(trimmed_worktree)
    .output()
    .map_err(|error| format!("Failed to run git: {error}"))?;
  if !remove_output.status.success() {
    let stderr = String::from_utf8_lossy(&remove_output.stderr)
      .trim()
      .to_string();
    let is_not_worktree = stderr.contains("is not a working tree");
    let is_missing =
      stderr.contains("No such file or directory") || stderr.contains("does not exist");
    if is_not_worktree && worktree_exists_before {
      return Err(
        "Refusing to delete directory because target is not a registered git worktree".to_string(),
      );
    }
    let ignorable = is_not_worktree || is_missing;
    if !ignorable {
      return Err(if stderr.is_empty() {
        "Failed to remove worktree".to_string()
      } else {
        stderr
      });
    }
  }

  if worktree_path.exists() {
    std::fs::remove_dir_all(worktree_path)
      .map_err(|error| format!("Failed to remove worktree directory: {error}"))?;
  }

  let branch_name = branch.unwrap_or_default().trim().to_string();
  if !branch_name.is_empty() {
    let branch_output = std::process::Command::new("git")
      .arg("-C")
      .arg(&root)
      .arg("branch")
      .arg("-D")
      .arg(&branch_name)
      .output()
      .map_err(|error| format!("Failed to run git: {error}"))?;
    if !branch_output.status.success() {
      let stderr = String::from_utf8_lossy(&branch_output.stderr)
        .trim()
        .to_string();
      let ignorable = stderr.contains("not found");
      if !ignorable {
        return Err(if stderr.is_empty() {
          format!("Failed to delete branch '{}'", branch_name)
        } else {
          stderr
        });
      }
    }
  }

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::process::Command;
  use std::time::{SystemTime, UNIX_EPOCH};

  struct Sandbox(PathBuf);

  impl std::ops::Deref for Sandbox {
    type Target = Path;

    fn deref(&self) -> &Path {
      &self.0
    }
  }

  impl Drop for Sandbox {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  /// Lays out a temp sandbox shaped like the real one:
  ///
  /// ```text
  /// base/worktrees        managed root (real directory)
  /// base/link -> worktrees   symlinked spelling of the same root
  /// base/worktrees-evil   lexical sibling of the root
  /// base/outside          escape target
  /// base/worktrees/escape -> ../outside
  /// ```
  ///
  /// Returns `(base, canonical_base)`.
  fn make_sandbox(name: &str) -> (Sandbox, PathBuf) {
    let suffix = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system time before unix epoch")
      .as_nanos();
    let base = Sandbox(std::env::temp_dir().join(format!("codelegate-wt-{name}-{suffix}")));
    fs::create_dir_all(base.join("worktrees")).expect("create worktrees root");
    fs::create_dir_all(base.join("worktrees-evil")).expect("create sibling");
    fs::create_dir_all(base.join("outside")).expect("create outside");
    #[cfg(unix)]
    {
      std::os::unix::fs::symlink("worktrees", base.join("link")).expect("create root symlink");
      std::os::unix::fs::symlink("../outside", base.join("worktrees").join("escape"))
        .expect("create escaping symlink");
    }
    let canonical_base = base.canonicalize().expect("canonicalize sandbox base");
    (base, canonical_base)
  }

  fn git(args: &[&str]) -> std::process::Output {
    Command::new("git").args(args).output().expect("run git")
  }

  fn make_repo(base: &Path) -> PathBuf {
    let repo = base.join("repo");
    fs::create_dir_all(&repo).expect("create repo dir");
    let repo_str = repo.to_string_lossy().to_string();
    assert!(git(&["-C", &repo_str, "init", "-q"]).status.success());
    fs::write(repo.join("a.txt"), "hello\n").expect("write file");
    assert!(git(&["-C", &repo_str, "add", "-A"]).status.success());
    assert!(
      git(&[
        "-C",
        &repo_str,
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Codelegate Test",
        "commit",
        "-qm",
        "initial",
      ])
      .status
      .success()
    );
    repo
  }

  fn worktree_list(repo: &Path) -> String {
    let repo_str = repo.to_string_lossy().to_string();
    let output = git(&["-C", &repo_str, "worktree", "list"]);
    assert!(output.status.success());
    String::from_utf8_lossy(&output.stdout).to_string()
  }

  fn branch_list(repo: &Path) -> String {
    let repo_str = repo.to_string_lossy().to_string();
    let output = git(&["-C", &repo_str, "branch", "--list"]);
    assert!(output.status.success());
    String::from_utf8_lossy(&output.stdout).to_string()
  }

  #[cfg(unix)]
  #[test]
  fn worktree_guard_accepts_symlinked_root_in_every_spelling() {
    let (base, canonical_base) = make_sandbox("accepts");
    let roots = [base.join("link"), canonical_base.join("worktrees")];

    // The worktree directory is gone (the stale-cleanup case).
    for root in &roots {
      for worktree in [
        base.join("link").join("missing"),
        canonical_base.join("worktrees").join("missing"),
      ] {
        assert!(
          worktree_is_managed(&worktree, root),
          "missing worktree {worktree:?} should be managed under {root:?}"
        );
      }
    }

    // The worktree directory still exists.
    fs::create_dir_all(base.join("worktrees").join("live")).expect("create live worktree dir");
    for root in &roots {
      for worktree in [
        base.join("link").join("live"),
        canonical_base.join("worktrees").join("live"),
      ] {
        assert!(
          worktree_is_managed(&worktree, root),
          "existing worktree {worktree:?} should be managed under {root:?}"
        );
      }
    }
  }

  #[cfg(unix)]
  #[test]
  fn worktree_guard_rejects_the_root_itself() {
    let (base, canonical_base) = make_sandbox("root-itself");
    let roots = [base.join("link"), canonical_base.join("worktrees")];
    for root in &roots {
      for worktree in &roots {
        assert!(
          !worktree_is_managed(worktree, root),
          "root {worktree:?} must not be treated as a managed worktree under {root:?}"
        );
      }
    }
  }

  #[cfg(unix)]
  #[test]
  fn worktree_guard_rejects_parent_dir_components() {
    let (base, canonical_base) = make_sandbox("parent-dir");
    let root = base.join("link");
    let escape = base.join("link").join("wt").join("..").join("..").join("outside");
    assert!(!worktree_is_managed(&escape, &root));
    let escape = canonical_base
      .join("worktrees")
      .join("..")
      .join("worktrees")
      .join("wt");
    assert!(!worktree_is_managed(&escape, &root));
  }

  #[cfg(unix)]
  #[test]
  fn worktree_guard_rejects_lexical_sibling_of_the_root() {
    let (base, canonical_base) = make_sandbox("sibling");
    let roots = [base.join("link"), canonical_base.join("worktrees")];
    fs::create_dir_all(base.join("worktrees-evil").join("live")).expect("create sibling worktree");
    for root in &roots {
      for worktree in [
        base.join("worktrees-evil").join("live"),
        base.join("worktrees-evil").join("missing"),
        canonical_base.join("worktrees-evil"),
      ] {
        assert!(
          !worktree_is_managed(&worktree, root),
          "sibling {worktree:?} must be rejected under {root:?}"
        );
      }
    }
  }

  #[cfg(unix)]
  #[test]
  fn worktree_guard_rejects_symlink_escaping_the_root() {
    let (base, canonical_base) = make_sandbox("escape");
    let roots = [base.join("link"), canonical_base.join("worktrees")];
    for root in &roots {
      for worktree in [
        base.join("link").join("escape"),
        base.join("link").join("escape").join("wt"),
        canonical_base.join("worktrees").join("escape").join("wt"),
      ] {
        assert!(
          !worktree_is_managed(&worktree, root),
          "escaping path {worktree:?} must be rejected under {root:?}"
        );
      }
    }
  }

  #[cfg(unix)]
  #[test]
  fn remove_session_worktree_cleans_up_a_stale_worktree_through_a_symlinked_root() {
    let (base, _canonical_base) = make_sandbox("stale-e2e");
    let repo = make_repo(&base);
    let repo_str = repo.to_string_lossy().to_string();
    let worktree = base.join("link").join("stale-session");
    let worktree_str = worktree.to_string_lossy().to_string();

    assert!(
      git(&["-C", &repo_str, "worktree", "add", &worktree_str, "-b", "stale-branch"])
        .status
        .success()
    );
    // The directory disappears (deleted by hand, or the machine restarted mid-session).
    fs::remove_dir_all(base.join("worktrees").join("stale-session")).expect("delete worktree dir");

    remove_session_worktree_with_root(
      &base.join("link"),
      repo_str.clone(),
      worktree_str,
      Some("stale-branch".to_string()),
    )
    .expect("stale worktree removal should succeed through the symlinked root");

    assert!(!worktree_list(&repo).contains("stale-session"));
    assert!(!branch_list(&repo).contains("stale-branch"));
  }

  #[cfg(unix)]
  #[test]
  fn remove_session_worktree_cleans_up_a_live_worktree_through_a_symlinked_root() {
    let (base, _canonical_base) = make_sandbox("live-e2e");
    let repo = make_repo(&base);
    let repo_str = repo.to_string_lossy().to_string();
    let worktree = base.join("link").join("live-session");
    let worktree_str = worktree.to_string_lossy().to_string();

    assert!(
      git(&["-C", &repo_str, "worktree", "add", &worktree_str, "-b", "live-branch"])
        .status
        .success()
    );
    assert!(base.join("worktrees").join("live-session").exists());

    remove_session_worktree_with_root(
      &base.join("link"),
      repo_str.clone(),
      worktree_str,
      Some("live-branch".to_string()),
    )
    .expect("live worktree removal should succeed through the symlinked root");

    assert!(!base.join("worktrees").join("live-session").exists());
    assert!(!worktree_list(&repo).contains("live-session"));
    assert!(!branch_list(&repo).contains("live-branch"));
  }

  #[cfg(unix)]
  #[test]
  fn remove_session_worktree_refuses_a_path_outside_the_managed_root() {
    let (base, _canonical_base) = make_sandbox("outside-e2e");
    let repo = make_repo(&base);
    let repo_str = repo.to_string_lossy().to_string();
    let victim = base.join("outside").join("precious");
    fs::create_dir_all(&victim).expect("create victim dir");

    let error = remove_session_worktree_with_root(
      &base.join("link"),
      repo_str,
      victim.to_string_lossy().to_string(),
      None,
    )
    .expect_err("path outside the managed root must be refused");
    assert!(error.contains("outside managed Codelegate worktrees"));
    assert!(victim.exists());
  }
}
