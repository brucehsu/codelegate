use git2::{
  build::CheckoutBuilder, Commit, Delta, Diff, DiffFormat, DiffLineType, DiffOptions, Error, IndexAddOption,
  Patch, Repository, Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_UNTRACKED_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DIFF_BLOB_SIZE: i64 = MAX_UNTRACKED_PREVIEW_BYTES as i64;
const MAX_DIFF_ROWS: usize = 4000;
const BINARY_SNIFF_BYTES: usize = 8192;
const MAX_UNTRACKED_DIR_FILES: usize = 15;
const MAX_UNTRACKED_DIR_WALK_ENTRIES: usize = 512;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitDiffSection {
  Staged,
  Unstaged,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitFileStatus {
  Modified,
  Added,
  Deleted,
  Renamed,
  Untracked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeSummary {
  pub path: String,
  pub old_path: Option<String>,
  pub new_path: Option<String>,
  pub additions: usize,
  pub deletions: usize,
  pub changed_line_count: usize,
  pub is_binary: bool,
  pub is_directory: bool,
  pub is_untracked: bool,
  pub from_untracked_dir: bool,
  pub status: GitFileStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeSummaryPayload {
  pub staged: Vec<GitChangeSummary>,
  pub unstaged: Vec<GitChangeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiffPayload {
  pub path: String,
  pub old_path: Option<String>,
  pub new_path: Option<String>,
  pub additions: usize,
  pub deletions: usize,
  pub changed_line_count: usize,
  pub is_binary: bool,
  pub is_directory: bool,
  pub is_untracked: bool,
  pub from_untracked_dir: bool,
  pub status: GitFileStatus,
  pub rows: Vec<GitDiffRow>,
  pub truncated: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitDiffLineType {
  Context,
  Add,
  Del,
  Empty,
  Meta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffCell {
  pub text: String,
  #[serde(rename = "type")]
  pub line_type: GitDiffLineType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRow {
  pub left: GitDiffCell,
  pub right: GitDiffCell,
  pub left_line: Option<usize>,
  pub right_line: Option<usize>,
}

#[derive(Debug, Clone)]
struct ParsedDiffFile {
  rows: Vec<GitDiffRow>,
  old_path: Option<String>,
  new_path: Option<String>,
  status: GitFileStatus,
}

pub fn get_git_change_summary(path: String) -> Result<GitChangeSummaryPayload, String> {
  let repo = open_repository(&path)?;
  get_git_change_summary_for_repo(&repo)
}

fn get_git_change_summary_for_repo(repo: &Repository) -> Result<GitChangeSummaryPayload, String> {
  let staged = get_staged_summaries(&repo)?;
  let unstaged = get_unstaged_summaries(&repo)?;
  Ok(GitChangeSummaryPayload { staged, unstaged })
}

#[cfg(test)]
pub fn get_git_change_summary_for_path(
  path: String,
  file_path: String,
) -> Result<GitChangeSummaryPayload, String> {
  let repo = open_repository(&path)?;
  let summary = get_git_change_summary_for_repo(&repo)?;
  Ok(GitChangeSummaryPayload {
    staged: summary
      .staged
      .into_iter()
      .filter(|entry| summary_matches_path(entry, &file_path))
      .collect(),
    unstaged: summary
      .unstaged
      .into_iter()
      .filter(|entry| summary_matches_path(entry, &file_path))
      .collect(),
  })
}

pub fn get_git_file_diff(
  path: String,
  section: GitDiffSection,
  file_path: String,
  old_path: Option<String>,
) -> Result<GitFileDiffPayload, String> {
  let repo = open_repository(&path)?;

  let mut pathspecs = vec![file_path.as_str()];
  if let Some(old) = old_path.as_deref() {
    if old != file_path {
      pathspecs.push(old);
    }
  }

  let mut diff = match section {
    GitDiffSection::Staged => staged_diff(&repo, &pathspecs)?,
    GitDiffSection::Unstaged => unstaged_diff(&repo, &pathspecs)?,
  };
  find_similar(&mut diff)?;

  let summary = collect_summaries(&repo, &diff, section, &pathspecs)?
    .into_iter()
    .find(|entry| entry.path == file_path)
    .or_else(|| synthesize_untracked_summary(&repo, section, &file_path))
    .ok_or_else(|| format!("Unable to find diff for '{}'", file_path))?;

  let diff_text = if summary.is_untracked {
    render_untracked_diff(&repo, &summary.path)?
  } else {
    render_diff(&diff)?
  };

  let parsed_files = parse_diff_text(&diff_text, summary.is_untracked);
  let parsed = if summary.status == GitFileStatus::Renamed {
    parsed_files
      .into_iter()
      .find(|file| parsed_file_matches_summary(file, &summary))
  } else {
    parsed_files.into_iter().next()
  };
  let is_binary = summary.is_binary && parsed.as_ref().map(|file| file.rows.is_empty()).unwrap_or(true);
  let old_path_final = parsed.as_ref().and_then(|file| file.old_path.clone()).or(summary.old_path);
  let new_path_final = parsed.as_ref().and_then(|file| file.new_path.clone()).or(summary.new_path);
  let status_final = parsed.as_ref().map(|file| file.status).unwrap_or(summary.status);
  let mut rows = parsed.map(|file| file.rows).unwrap_or_default();
  let truncated = rows.len() > MAX_DIFF_ROWS;
  if truncated {
    rows.truncate(MAX_DIFF_ROWS);
  }

  Ok(GitFileDiffPayload {
    path: summary.path,
    old_path: old_path_final,
    new_path: new_path_final,
    additions: summary.additions,
    deletions: summary.deletions,
    changed_line_count: summary.changed_line_count,
    is_binary,
    is_directory: summary.is_directory,
    is_untracked: summary.is_untracked,
    from_untracked_dir: summary.from_untracked_dir,
    status: status_final,
    rows,
    truncated,
  })
}

pub fn stage_all_changes(path: String) -> Result<(), String> {
  let repo = open_repository(&path)?;
  let unstaged = get_unstaged_summaries(&repo)?;
  let mut index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;

  for entry in unstaged {
    stage_index_entry(&mut index, &entry)?;
  }

  index.write().map_err(|error| git_error("Failed to write git index", error))
}

#[cfg(test)]
pub fn stage_file_change(path: String, file_path: String) -> Result<(), String> {
  stage_file_change_with_summary(path, file_path).map(|_| ())
}

pub fn stage_file_change_with_summary(
  path: String,
  file_path: String,
) -> Result<GitChangeSummaryPayload, String> {
  let repo = open_repository(&path)?;
  let entry = get_unstaged_summaries(&repo)?
    .into_iter()
    .find(|entry| entry.path == file_path)
    .ok_or_else(|| format!("Unable to find unstaged change for '{}'", file_path))?;
  let mut index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;
  stage_index_entry(&mut index, &entry)?;
  index.write().map_err(|error| git_error("Failed to write git index", error))?;
  get_git_change_summary_for_repo(&repo)
}

pub fn unstage_all_changes(path: String) -> Result<(), String> {
  let repo = open_repository(&path)?;
  let staged = get_staged_summaries(&repo)?;
  if staged.is_empty() {
    return Ok(());
  }

  unstage_entries(&repo, &staged)
}

#[cfg(test)]
pub fn unstage_file_change(path: String, file_path: String) -> Result<(), String> {
  unstage_file_change_with_summary(path, file_path).map(|_| ())
}

pub fn unstage_file_change_with_summary(
  path: String,
  file_path: String,
) -> Result<GitChangeSummaryPayload, String> {
  let repo = open_repository(&path)?;
  let entry = get_staged_summaries(&repo)?
    .into_iter()
    .find(|entry| entry.path == file_path)
    .ok_or_else(|| format!("Unable to find staged change for '{}'", file_path))?;
  unstage_entries(&repo, std::slice::from_ref(&entry))?;
  get_git_change_summary_for_repo(&repo)
}

#[cfg(test)]
fn summary_matches_path(entry: &GitChangeSummary, path: &str) -> bool {
  entry.path == path || entry.old_path.as_deref() == Some(path) || entry.new_path.as_deref() == Some(path)
}

fn stage_index_entry(index: &mut git2::Index, entry: &GitChangeSummary) -> Result<(), String> {
  if entry.is_directory {
    let trimmed = entry.path.trim_end_matches('/');
    index
      .add_all([trimmed].iter(), IndexAddOption::DEFAULT, None)
      .map_err(|error| git_error("Failed to stage directory", error))?;
    return Ok(());
  }

  match entry.status {
    GitFileStatus::Deleted => {
      index
        .remove_path(Path::new(&entry.path))
        .map_err(|error| git_error("Failed to stage deleted file", error))?;
    }
    GitFileStatus::Renamed => {
      if let Some(old_path) = entry.old_path.as_deref() {
        let _ = index.remove_path(Path::new(old_path));
      }
      index
        .add_path(Path::new(&entry.path))
        .map_err(|error| git_error("Failed to stage renamed file", error))?;
    }
    GitFileStatus::Modified | GitFileStatus::Added | GitFileStatus::Untracked => {
      index
        .add_path(Path::new(&entry.path))
        .map_err(|error| git_error("Failed to stage file", error))?;
    }
  }
  Ok(())
}

fn unstage_entries(repo: &Repository, staged: &[GitChangeSummary]) -> Result<(), String> {
  if let Some(head_commit) = head_commit(&repo)? {
    let target = head_commit.as_object();
    let mut pathspecs = Vec::new();
    for entry in staged {
      pathspecs.push(entry.path.clone());
      if entry.status == GitFileStatus::Renamed {
        if let Some(old_path) = entry.old_path.as_ref() {
          pathspecs.push(old_path.clone());
        }
      }
    }
    repo
      .reset_default(Some(target), pathspecs.iter().map(String::as_str))
      .map_err(|error| git_error("Failed to unstage changes", error))?;
    return Ok(());
  }

  let mut index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;
  for entry in staged {
    index
      .remove_path(Path::new(&entry.path))
      .map_err(|error| git_error("Failed to remove file from git index", error))?;
    if entry.status == GitFileStatus::Renamed {
      if let Some(old_path) = entry.old_path.as_ref() {
        let _ = index.remove_path(Path::new(old_path));
      }
    }
  }
  index.write().map_err(|error| git_error("Failed to write git index", error))
}

pub fn discard_all_changes(path: String) -> Result<(), String> {
  let repo = open_repository(&path)?;

  if head_commit(&repo)?.is_some() {
    let mut checkout = CheckoutBuilder::new();
    checkout.force().remove_untracked(true);
    repo
      .checkout_head(Some(&mut checkout))
      .map_err(|error| git_error("Failed to discard changes", error))?;
    return Ok(());
  }

  for entry in get_unstaged_summaries(&repo)? {
    let full_path = repo
      .workdir()
      .ok_or_else(|| "Repository does not have a worktree".to_string())?
      .join(&entry.path);
    if !full_path.exists() {
      continue;
    }
    if full_path.is_dir() {
      fs::remove_dir_all(&full_path)
        .map_err(|error| format!("Failed to remove '{}': {error}", entry.path))?;
    } else {
      fs::remove_file(&full_path)
        .map_err(|error| format!("Failed to remove '{}': {error}", entry.path))?;
    }
  }

  Ok(())
}

pub fn commit_git_changes(path: String, message: String, amend: bool) -> Result<(), String> {
  let trimmed = message.trim();
  if trimmed.is_empty() {
    return Err("Commit message cannot be empty".to_string());
  }

  let root = super::resolve_repo_root(path)?;
  let mut command = Command::new("git");
  command.current_dir(&root).arg("commit");

  if amend {
    command.arg("--amend");
  }
  command.arg("-m").arg(trimmed);

  let output = command
    .output()
    .map_err(|error| format!("Failed to run git commit: {error}"))?;

  if output.status.success() {
    return Ok(());
  }

  Err(command_error("git commit failed", &output))
}

pub fn get_last_commit_message(path: String) -> Result<String, String> {
  let root = super::resolve_repo_root(path)?;
  let output = Command::new("git")
    .current_dir(&root)
    .args(["log", "-1", "--pretty=%B"])
    .output()
    .map_err(|error| format!("Failed to read previous commit message: {error}"))?;

  if !output.status.success() {
    return Err(command_error(
      "Unable to read previous commit message",
      &output,
    ));
  }

  let message = String::from_utf8_lossy(&output.stdout)
    .trim_end_matches(['\r', '\n'])
    .to_string();
  if message.is_empty() {
    return Err("Previous commit message is empty".to_string());
  }
  Ok(message)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
  pub name: String,
  /// Set when the branch is checked out in a worktree (including the primary checkout).
  pub worktree_path: Option<String>,
}

pub fn list_git_branches(path: String) -> Result<Vec<GitBranchInfo>, String> {
  let output = Command::new("git")
    .arg("-C")
    .arg(&path)
    .args([
      "for-each-ref",
      "refs/heads",
      "--sort=-committerdate",
      // %(worktreepath) (git >= 2.22) is non-empty when the branch is
      // checked out in any worktree, including the main checkout.
      "--format=%(refname:short)%00%(worktreepath)",
    ])
    .output()
    .map_err(|error| format!("Failed to list branches: {error}"))?;

  if !output.status.success() {
    return Err(command_error("Failed to list branches", &output));
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let branches = stdout
    .lines()
    .filter_map(|line| {
      let mut parts = line.splitn(2, '\0');
      let name = parts.next()?.trim();
      if name.is_empty() {
        return None;
      }
      let worktree_path = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        // A registration whose directory is gone is stale; `worktree prune`
        // runs before `worktree add`, so the branch is still selectable.
        .filter(|value| Path::new(value).exists());
      Some(GitBranchInfo {
        name: name.to_string(),
        worktree_path: worktree_path.map(str::to_string),
      })
    })
    .collect();

  Ok(branches)
}

fn open_repository(path: &str) -> Result<Repository, String> {
  let root = super::resolve_repo_root(path.to_string())?;
  Repository::open(&root).map_err(|error| git_error("Failed to open repository", error))
}

fn head_commit(repo: &Repository) -> Result<Option<Commit<'_>>, String> {
  match repo.head() {
    Ok(head) => head
      .peel_to_commit()
      .map(Some)
      .map_err(|error| git_error("Failed to read HEAD commit", error)),
    Err(error) if error.code() == git2::ErrorCode::UnbornBranch || error.code() == git2::ErrorCode::NotFound => Ok(None),
    Err(error) => Err(git_error("Failed to read HEAD", error)),
  }
}

fn parsed_file_matches_summary(file: &ParsedDiffFile, summary: &GitChangeSummary) -> bool {
  let candidates = [
    Some(summary.path.as_str()),
    summary.old_path.as_deref(),
    summary.new_path.as_deref(),
  ];

  candidates.into_iter().flatten().any(|candidate| {
    file.old_path.as_deref() == Some(candidate) || file.new_path.as_deref() == Some(candidate)
  })
}

fn get_staged_summaries(repo: &Repository) -> Result<Vec<GitChangeSummary>, String> {
  let mut diff = staged_diff(repo, &[])?;
  find_similar(&mut diff)?;
  collect_summaries(repo, &diff, GitDiffSection::Staged, &[])
}

fn get_unstaged_summaries(repo: &Repository) -> Result<Vec<GitChangeSummary>, String> {
  let mut diff = unstaged_diff(repo, &[])?;
  find_similar(&mut diff)?;
  let summaries = collect_summaries(repo, &diff, GitDiffSection::Unstaged, &[])?;
  Ok(expand_untracked_dir_summaries(repo, summaries))
}

fn staged_diff<'repo>(repo: &'repo Repository, pathspecs: &[&str]) -> Result<Diff<'repo>, String> {
  let index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;
  let head_tree = head_commit(repo)?
    .map(|commit| commit.tree().map_err(|error| git_error("Failed to load HEAD tree", error)))
    .transpose()?;
  let mut options = diff_options(pathspecs, false);
  repo
    .diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut options))
    .map_err(|error| git_error("Failed to generate staged diff", error))
}

fn unstaged_diff<'repo>(repo: &'repo Repository, pathspecs: &[&str]) -> Result<Diff<'repo>, String> {
  let index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;
  let mut options = diff_options(pathspecs, true);
  repo
    .diff_index_to_workdir(Some(&index), Some(&mut options))
    .map_err(|error| git_error("Failed to generate unstaged diff", error))
}

fn diff_options(pathspecs: &[&str], include_untracked: bool) -> DiffOptions {
  let mut options = DiffOptions::new();
  options
    .include_typechange(true)
    .include_untracked(include_untracked)
    .recurse_untracked_dirs(false)
    .include_unmodified(false)
    .max_size(MAX_DIFF_BLOB_SIZE);
  for pathspec in pathspecs {
    options.pathspec(*pathspec);
  }
  options
}

fn find_similar(diff: &mut Diff<'_>) -> Result<(), String> {
  diff.find_similar(None)
    .map_err(|error| git_error("Failed to detect renamed files", error))
}

fn collect_summaries(
  repo: &Repository,
  diff: &Diff<'_>,
  section: GitDiffSection,
  pathspecs: &[&str],
) -> Result<Vec<GitChangeSummary>, String> {
  let untracked_paths = if section == GitDiffSection::Unstaged {
    get_untracked_paths(repo, pathspecs)?
  } else {
    HashSet::new()
  };

  diff
    .deltas()
    .enumerate()
    .map(|(index, delta)| build_summary(repo, diff, index, delta, section, &untracked_paths))
    .collect::<Result<Vec<_>, _>>()
}

/// Replaces each collapsed untracked-directory entry with individual file entries when the
/// directory is small enough to enumerate safely; otherwise keeps it collapsed. Runs only for the
/// unstaged section, where untracked directories can appear.
fn expand_untracked_dir_summaries(
  repo: &Repository,
  summaries: Vec<GitChangeSummary>,
) -> Vec<GitChangeSummary> {
  let mut expanded = Vec::with_capacity(summaries.len());
  for summary in summaries {
    if summary.is_untracked && summary.is_directory {
      // Expansion is best-effort: if the directory can't be enumerated or any file can't be
      // summarized, fall back to the original collapsed entry so one problem directory collapses
      // only itself instead of failing the whole Git summary.
      if let Some(entries) = try_expand_untracked_dir(repo, &summary.path) {
        expanded.extend(entries);
        continue;
      }
    }
    expanded.push(summary);
  }
  expanded
}

/// Attempts to expand a single collapsed untracked directory into per-file summaries. Returns
/// `None` when the directory should stay collapsed, whether because it is too large or unsafe to
/// walk, or because enumerating or summarizing it hit an error. In every `None` case the caller
/// keeps the original collapsed directory entry.
fn try_expand_untracked_dir(repo: &Repository, dir_path: &str) -> Option<Vec<GitChangeSummary>> {
  let paths = list_untracked_dir_files(repo, dir_path)?;
  let mut entries = Vec::with_capacity(paths.len());
  for path in paths {
    let entry = summarize_untracked_entry(repo, &path).ok()?;
    entries.push(untracked_file_summary(path, &entry));
  }
  Some(entries)
}

/// Bounded depth-first walk of an untracked directory. Returns `Some(sorted repo-relative file
/// paths)` when the directory is small enough to expand, or `None` when it should stay collapsed
/// (too many files, too many visited entries, a nested repository, or an empty result). Never
/// follows symlinks and never counts ignored entries toward the file cap.
fn list_untracked_dir_files(repo: &Repository, dir_path: &str) -> Option<Vec<String>> {
  let trimmed = dir_path.trim_end_matches('/');
  let root = worktree_full_path(repo, trimmed).ok()?;

  let mut files: Vec<String> = Vec::new();
  let mut visited: usize = 0;
  let mut stack: Vec<(PathBuf, String)> = vec![(root, trimmed.to_string())];

  while let Some((dir_full, dir_rel)) = stack.pop() {
    // Expansion is best-effort: a directory git enumerated that we can no longer read (unreadable
    // permissions, or a watcher-triggered refresh racing a deletion) just means "do not expand".
    // Keep the directory collapsed instead of failing the entire Git summary.
    let Ok(entries) = fs::read_dir(&dir_full) else {
      return None;
    };
    for entry in entries {
      let Ok(entry) = entry else {
        return None;
      };
      visited += 1;
      if visited > MAX_UNTRACKED_DIR_WALK_ENTRIES {
        return None;
      }

      let file_name = entry.file_name();
      let name = file_name.to_string_lossy();
      // A nested repository can't be enumerated safely; keep the directory collapsed.
      if name.as_ref() == ".git" {
        return None;
      }

      let rel = format!("{dir_rel}/{name}");
      // Ignored entries never count toward the file cap and are never descended into.
      if repo.is_path_ignored(&rel).unwrap_or(false) {
        continue;
      }

      // A file type we cannot stat (permissions, or the entry vanished mid-walk) degrades the
      // whole directory to collapsed rather than propagating an error.
      let Ok(file_type) = entry.file_type() else {
        return None;
      };
      if file_type.is_dir() {
        stack.push((entry.path(), rel));
      } else {
        // Symlinks are counted as files and never followed.
        files.push(rel);
        if files.len() > MAX_UNTRACKED_DIR_FILES {
          return None;
        }
      }
    }
  }

  if files.is_empty() {
    return None;
  }

  files.sort();
  Some(files)
}

/// Builds a synthetic new-file summary for a single file discovered inside an expanded untracked
/// directory.
fn untracked_file_summary(path: String, entry: &UntrackedEntrySummary) -> GitChangeSummary {
  GitChangeSummary {
    old_path: Some(path.clone()),
    new_path: Some(path.clone()),
    path,
    additions: entry.line_count,
    deletions: 0,
    changed_line_count: entry.line_count,
    is_binary: entry.is_binary,
    is_directory: false,
    is_untracked: true,
    from_untracked_dir: true,
    status: GitFileStatus::Untracked,
  }
}

/// Primary resolution for a file requested inside an untracked directory on the detail endpoint.
/// `get_git_file_diff` no longer expands untracked directories, so a path like `dir/file.txt` is
/// absent from the collected summaries and is resolved here instead. `status_file` is exact-path,
/// so this stays O(1)-bounded and only synthesizes a summary for a real, newly created (untracked)
/// file.
fn synthesize_untracked_summary(
  repo: &Repository,
  section: GitDiffSection,
  file_path: &str,
) -> Option<GitChangeSummary> {
  if section != GitDiffSection::Unstaged {
    return None;
  }
  let status = repo.status_file(Path::new(file_path)).ok()?;
  if !status.contains(Status::WT_NEW) {
    return None;
  }
  let entry = summarize_untracked_entry(repo, file_path).ok()?;
  if entry.is_directory {
    return None;
  }
  Some(untracked_file_summary(file_path.to_string(), &entry))
}

fn build_summary(
  repo: &Repository,
  diff: &Diff<'_>,
  index: usize,
  delta: git2::DiffDelta<'_>,
  section: GitDiffSection,
  untracked_paths: &HashSet<String>,
) -> Result<GitChangeSummary, String> {
  let path = delta_path(&delta)
    .ok_or_else(|| "Encountered a diff entry without a file path".to_string())?;
  let old_path = delta.old_file().path().map(path_to_string);
  let new_path = delta.new_file().path().map(path_to_string);
  let (_, mut additions, mut deletions) = patch_line_stats(diff, index)?;
  let is_untracked =
    section == GitDiffSection::Unstaged && delta.status() != Delta::Renamed && untracked_paths.contains(&path);
  let mut is_binary = delta.flags().contains(git2::DiffFlags::BINARY);
  let mut is_directory = false;
  let changed_line_count = if is_untracked && additions == 0 && deletions == 0 {
    let summary = summarize_untracked_entry(repo, &path)?;
    is_directory = summary.is_directory;
    is_binary = is_binary || summary.is_binary;
    additions = summary.line_count;
    deletions = 0;
    summary.line_count
  } else {
    additions + deletions
  };

  Ok(GitChangeSummary {
    path,
    old_path,
    new_path,
    additions,
    deletions,
    changed_line_count,
    is_binary,
    is_directory,
    is_untracked,
    from_untracked_dir: false,
    status: map_delta_status(delta.status(), is_untracked),
  })
}

fn patch_line_stats(diff: &Diff<'_>, index: usize) -> Result<(usize, usize, usize), String> {
  match Patch::from_diff(diff, index).map_err(|error| git_error("Failed to build git patch", error))? {
    Some(patch) => patch
      .line_stats()
      .map_err(|error| git_error("Failed to read git patch statistics", error)),
    None => Ok((0, 0, 0)),
  }
}

fn render_diff(diff: &Diff<'_>) -> Result<String, String> {
  let mut text = String::new();
  diff
    .print(DiffFormat::Patch, |_delta, _hunk, line| {
      let content = String::from_utf8_lossy(line.content());
      match line.origin_value() {
        DiffLineType::Addition => {
          text.push('+');
          text.push_str(content.as_ref());
        }
        DiffLineType::Deletion => {
          text.push('-');
          text.push_str(content.as_ref());
        }
        DiffLineType::Context => {
          text.push(' ');
          text.push_str(content.as_ref());
        }
        DiffLineType::ContextEOFNL | DiffLineType::AddEOFNL | DiffLineType::DeleteEOFNL => {
          text.push_str(content.as_ref());
        }
        DiffLineType::FileHeader | DiffLineType::HunkHeader | DiffLineType::Binary => {
          text.push_str(content.as_ref());
        }
      }
      true
    })
    .map_err(|error| git_error("Failed to render git diff", error))?;
  Ok(text)
}

fn parse_diff_text(diff_text: &str, is_untracked: bool) -> Vec<ParsedDiffFile> {
  let mut files = Vec::new();
  let mut current: Option<ParsedDiffFileBuilder> = None;
  let mut left_cursor: Option<usize> = None;
  let mut right_cursor: Option<usize> = None;

  for line in diff_text.split('\n') {
    let line = line.strip_suffix('\r').unwrap_or(line);

    if line.strip_prefix("diff --git ").is_some() {
      if let Some(file) = current.take() {
        files.push(file.build());
      }

      current = Some(ParsedDiffFileBuilder::new(is_untracked));
      left_cursor = None;
      right_cursor = None;
      continue;
    }

    if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
      continue;
    }

    if current.is_none() && !line.is_empty() {
      current = Some(ParsedDiffFileBuilder::new(is_untracked));
    }

    let Some(file) = current.as_mut() else {
      continue;
    };

    if line.starts_with("index ") || line.starts_with("similarity index") {
      continue;
    }

    if line.starts_with("new file mode") {
      if !is_untracked {
        file.status = GitFileStatus::Added;
      }
      continue;
    }

    if line.starts_with("deleted file mode") {
      if !is_untracked {
        file.status = GitFileStatus::Deleted;
      }
      continue;
    }

    if let Some(old_path) = line.strip_prefix("rename from ") {
      file.old_path = Some(old_path.trim().to_string());
      continue;
    }

    if let Some(new_path) = line.strip_prefix("rename to ") {
      let new_path = new_path.trim().to_string();
      file.new_path = Some(new_path.clone());
      if !is_untracked {
        file.status = GitFileStatus::Renamed;
      }
      continue;
    }

    if line.starts_with("---") || line.starts_with("+++") {
      if line.starts_with("--- /dev/null") && !is_untracked {
        file.status = GitFileStatus::Added;
      }
      if line.starts_with("+++ /dev/null") && !is_untracked {
        file.status = GitFileStatus::Deleted;
      }
      continue;
    }

    if let Some((left, right)) = parse_hunk_header(line) {
      left_cursor = Some(left);
      right_cursor = Some(right);
      file.rows.push(GitDiffRow {
        left: GitDiffCell { text: line.to_string(), line_type: GitDiffLineType::Meta },
        right: GitDiffCell { text: line.to_string(), line_type: GitDiffLineType::Meta },
        left_line: None,
        right_line: None,
      });
      continue;
    }

    if line.starts_with("\\ No newline") {
      continue;
    }

    if let Some(text) = line.strip_prefix('+') {
      let line_number = right_cursor;
      if let Some(cursor) = right_cursor.as_mut() {
        *cursor += 1;
      }
      file.rows.push(GitDiffRow {
        left: GitDiffCell { text: String::new(), line_type: GitDiffLineType::Empty },
        right: GitDiffCell { text: text.to_string(), line_type: GitDiffLineType::Add },
        left_line: None,
        right_line: line_number,
      });
      continue;
    }

    if let Some(text) = line.strip_prefix('-') {
      let line_number = left_cursor;
      if let Some(cursor) = left_cursor.as_mut() {
        *cursor += 1;
      }
      file.rows.push(GitDiffRow {
        left: GitDiffCell { text: text.to_string(), line_type: GitDiffLineType::Del },
        right: GitDiffCell { text: String::new(), line_type: GitDiffLineType::Empty },
        left_line: line_number,
        right_line: None,
      });
      continue;
    }

    if let Some(text) = line.strip_prefix(' ') {
      let left_line = left_cursor;
      let right_line = right_cursor;
      if let Some(cursor) = left_cursor.as_mut() {
        *cursor += 1;
      }
      if let Some(cursor) = right_cursor.as_mut() {
        *cursor += 1;
      }
      file.rows.push(GitDiffRow {
        left: GitDiffCell { text: text.to_string(), line_type: GitDiffLineType::Context },
        right: GitDiffCell { text: text.to_string(), line_type: GitDiffLineType::Context },
        left_line,
        right_line,
      });
    }
  }

  if let Some(file) = current.take() {
    files.push(file.build());
  }

  files
}

fn parse_hunk_header(line: &str) -> Option<(usize, usize)> {
  if !line.starts_with("@@") {
    return None;
  }
  let mut parts = line.split_whitespace();
  let _start = parts.next()?;
  let left = parts.next()?;
  let right = parts.next()?;
  Some((parse_hunk_range(left)?, parse_hunk_range(right)?))
}

fn parse_hunk_range(part: &str) -> Option<usize> {
  let trimmed = part.strip_prefix('-').or_else(|| part.strip_prefix('+'))?;
  let value = trimmed.split(',').next()?;
  value.parse().ok()
}

struct ParsedDiffFileBuilder {
  old_path: Option<String>,
  new_path: Option<String>,
  rows: Vec<GitDiffRow>,
  status: GitFileStatus,
}

impl ParsedDiffFileBuilder {
  fn new(is_untracked: bool) -> Self {
    Self {
      old_path: None,
      new_path: None,
      rows: Vec::new(),
      status: if is_untracked {
        GitFileStatus::Untracked
      } else {
        GitFileStatus::Modified
      },
    }
  }

  fn build(self) -> ParsedDiffFile {
    ParsedDiffFile {
      rows: self.rows,
      old_path: self.old_path,
      new_path: self.new_path,
      status: self.status,
    }
  }
}

fn get_untracked_paths(repo: &Repository, pathspecs: &[&str]) -> Result<HashSet<String>, String> {
  let mut options = StatusOptions::new();
  options
    .include_untracked(true)
    .recurse_untracked_dirs(false)
    .include_unmodified(false);
  for pathspec in pathspecs {
    options.pathspec(*pathspec);
  }
  let statuses = repo
    .statuses(Some(&mut options))
    .map_err(|error| git_error("Failed to read git status", error))?;

  let mut paths = HashSet::new();
  for entry in statuses.iter() {
    let status = entry.status();
    if status == Status::WT_NEW {
      if let Some(path) = entry.path() {
        paths.insert(path.to_string());
      }
    }
  }
  Ok(paths)
}

struct UntrackedEntrySummary {
  line_count: usize,
  is_binary: bool,
  is_directory: bool,
}

enum UntrackedRead {
  Directory,
  Oversized,
  Loaded {
    contents: Vec<u8>,
    line_count: usize,
    is_binary: bool,
  },
}

fn read_untracked_within_cap(repo: &Repository, path: &str) -> Result<UntrackedRead, String> {
  let full_path = worktree_full_path(repo, path)?;
  let metadata = fs::metadata(&full_path).map_err(|error| format!("Failed to read '{}': {error}", path))?;
  if metadata.is_dir() {
    return Ok(UntrackedRead::Directory);
  }
  if metadata.len() > MAX_UNTRACKED_PREVIEW_BYTES {
    return Ok(UntrackedRead::Oversized);
  }
  let contents = fs::read(&full_path).map_err(|error| format!("Failed to read '{}': {error}", path))?;
  let (line_count, is_binary) = summarize_untracked_contents(&contents)?;
  Ok(UntrackedRead::Loaded {
    contents,
    line_count,
    is_binary,
  })
}

fn summarize_untracked_entry(repo: &Repository, path: &str) -> Result<UntrackedEntrySummary, String> {
  Ok(match read_untracked_within_cap(repo, path)? {
    UntrackedRead::Directory => UntrackedEntrySummary {
      line_count: 0,
      is_binary: false,
      is_directory: true,
    },
    UntrackedRead::Oversized => UntrackedEntrySummary {
      line_count: 0,
      is_binary: true,
      is_directory: false,
    },
    UntrackedRead::Loaded { line_count, is_binary, .. } => UntrackedEntrySummary {
      line_count,
      is_binary,
      is_directory: false,
    },
  })
}

fn render_untracked_diff(repo: &Repository, path: &str) -> Result<String, String> {
  let (contents, line_count, is_binary) = match read_untracked_within_cap(repo, path)? {
    UntrackedRead::Directory | UntrackedRead::Oversized => return Ok(String::new()),
    UntrackedRead::Loaded { contents, line_count, is_binary } => (contents, line_count, is_binary),
  };
  if is_binary {
    return Ok(String::new());
  }

  let text = String::from_utf8(contents)
    .map_err(|error| format!("Failed to decode '{}': {error}", path))?;
  let mut diff = String::new();
  diff.push_str(&format!("diff --git a/{path} b/{path}\n"));
  diff.push_str("new file mode 100644\n");
  diff.push_str("--- /dev/null\n");
  diff.push_str(&format!("+++ b/{path}\n"));

  if line_count == 0 {
    return Ok(diff);
  }

  diff.push_str(&format!("@@ -0,0 +1,{line_count} @@\n"));
  for line in text.split_inclusive('\n') {
    diff.push('+');
    diff.push_str(line);
  }
  if !text.ends_with('\n') {
    diff.push('\n');
    diff.push_str("\\ No newline at end of file\n");
  }

  Ok(diff)
}

fn worktree_full_path(repo: &Repository, path: &str) -> Result<PathBuf, String> {
  let workdir = repo
    .workdir()
    .ok_or_else(|| "Repository does not have a worktree".to_string())?;
  Ok(workdir.join(path))
}

fn summarize_untracked_contents(contents: &[u8]) -> Result<(usize, bool), String> {
  if contents.is_empty() {
    return Ok((0, false));
  }
  let sniff_len = contents.len().min(BINARY_SNIFF_BYTES);
  if contents[..sniff_len].contains(&0) {
    return Ok((0, true));
  }
  let newline_count = contents.iter().filter(|byte| **byte == b'\n').count();
  Ok((if contents.ends_with(b"\n") {
    newline_count
  } else {
    newline_count + 1
  }, false))
}

fn delta_path(delta: &git2::DiffDelta<'_>) -> Option<String> {
  delta
    .new_file()
    .path()
    .map(path_to_string)
    .or_else(|| delta.old_file().path().map(path_to_string))
}

fn map_delta_status(delta: Delta, is_untracked: bool) -> GitFileStatus {
  if is_untracked {
    return GitFileStatus::Untracked;
  }

  match delta {
    Delta::Added => GitFileStatus::Added,
    Delta::Deleted => GitFileStatus::Deleted,
    Delta::Renamed => GitFileStatus::Renamed,
    _ => GitFileStatus::Modified,
  }
}

fn path_to_string(path: &Path) -> String {
  path.to_string_lossy().to_string()
}

fn git_error(fallback: &str, error: Error) -> String {
  let message = error.message().trim();
  if message.is_empty() {
    fallback.to_string()
  } else {
    message.to_string()
  }
}

fn command_error(fallback: &str, output: &std::process::Output) -> String {
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if !stderr.is_empty() {
    return stderr;
  }
  if !stdout.is_empty() {
    return stdout;
  }
  fallback.to_string()
}

#[cfg(test)]
mod tests {
  use super::*;
  use git2::{Repository, Signature};
  use std::path::PathBuf;
  use std::time::{SystemTime, UNIX_EPOCH};

  fn make_temp_repo(name: &str) -> (Repository, PathBuf) {
    let suffix = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system time before unix epoch")
      .as_nanos();
    let path = std::env::temp_dir().join(format!("codelegate-{name}-{suffix}"));
    fs::create_dir_all(&path).expect("create temp repo dir");
    let repo = Repository::init(&path).expect("init repo");
    (repo, path)
  }

  fn signature() -> Signature<'static> {
    Signature::now("Codelegate Test", "test@example.com").expect("signature")
  }

  fn commit_all(repo: &Repository, message: &str) {
    let workdir = repo.workdir().expect("workdir");
    let mut index = repo.index().expect("index");
    index
      .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
      .expect("add all");
    index.write().expect("write index");
    let tree_id = index.write_tree().expect("write tree");
    let tree = repo.find_tree(tree_id).expect("find tree");
    let sig = signature();
    let parents = head_commit(repo)
      .expect("head commit")
      .into_iter()
      .collect::<Vec<_>>();
    let parent_refs = parents.iter().collect::<Vec<_>>();
    repo
      .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
      .expect("commit");

    // Re-open the file after committing to keep tests focused on repository state.
    let _ = workdir;
  }

  fn summary_for(path: &Path) -> GitChangeSummaryPayload {
    get_git_change_summary(path.to_string_lossy().to_string()).expect("summary")
  }

  fn write_numbered_files(dir: &std::path::Path, count: usize) {
    fs::create_dir_all(dir).expect("create numbered files dir");
    for index in 0..count {
      fs::write(dir.join(format!("file-{index}.txt")), "content\n").expect("write numbered file");
    }
  }

  #[test]
  fn summary_marks_large_untracked_file() {
    let (repo, path) = make_temp_repo("summary-untracked");
    let workdir = repo.workdir().expect("workdir");
    let file_path = workdir.join("notes.txt");
    let mut content = String::new();
    for index in 0..120 {
      content.push_str(&format!("line {index}\n"));
    }
    fs::write(&file_path, content).expect("write file");

    let summary = get_git_change_summary(path.to_string_lossy().to_string()).expect("summary");
    let entry = summary.unstaged.iter().find(|item| item.path == "notes.txt").expect("unstaged entry");
    assert!(entry.is_untracked);
    assert_eq!(entry.status, GitFileStatus::Untracked);
    assert_eq!(entry.additions, 120);
    assert_eq!(entry.deletions, 0);
    assert_eq!(entry.changed_line_count, 120);
  }

  #[test]
  fn detail_returns_untracked_file_diff() {
    let (repo, path) = make_temp_repo("untracked-detail");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("draft.txt"), "alpha\nbeta\n").expect("write draft");

    let detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Unstaged,
      "draft.txt".to_string(),
      None,
    )
    .expect("detail");

    assert!(detail.is_untracked);
    assert_eq!(detail.additions, 2);
    assert_eq!(detail.deletions, 0);
    assert!(detail.rows.iter().any(|row| row.left.line_type == GitDiffLineType::Meta));
    assert!(detail.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "alpha"));
    assert!(detail.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "beta"));
    assert!(!detail.truncated);
  }

  #[test]
  fn untracked_directory_helpers_do_not_attempt_file_read() {
    let (repo, path) = make_temp_repo("untracked-directory");
    let workdir = repo.workdir().expect("workdir");
    let directory = workdir.join(".claude").join("worktrees").join("crazy-burnell");
    fs::create_dir_all(&directory).expect("create directory");
    fs::write(directory.join("notes.txt"), "alpha\n").expect("write nested file");

    let summary = summarize_untracked_entry(&repo, ".claude/worktrees/crazy-burnell/").expect("summary");
    assert!(summary.is_directory);
    assert!(!summary.is_binary);
    assert_eq!(summary.line_count, 0);

    let diff = render_untracked_diff(&repo, ".claude/worktrees/crazy-burnell/").expect("diff");
    assert!(diff.is_empty());

    let _ = path;
  }

  #[test]
  fn detail_returns_single_file_diff() {
    let (repo, path) = make_temp_repo("single-file-diff");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("write alpha");
    fs::write(workdir.join("beta.txt"), "two\n").expect("write beta");
    commit_all(&repo, "initial");

    fs::write(workdir.join("alpha.txt"), "one\nthree\n").expect("update alpha");
    fs::write(workdir.join("beta.txt"), "two\nfour\n").expect("update beta");

    let detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Unstaged,
      "alpha.txt".to_string(),
      None,
    )
    .expect("detail");

    assert_eq!(detail.path, "alpha.txt");
    assert!(!detail.is_binary);
    assert!(!detail.rows.is_empty());
    assert!(detail.rows.iter().any(|row| row.left.line_type == GitDiffLineType::Meta));
    assert!(detail.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "three"));
    assert_eq!(detail.changed_line_count, 1);
  }

  #[test]
  fn stage_file_change_stages_one_modified_file() {
    let (repo, path) = make_temp_repo("stage-one-modified");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("write alpha");
    fs::write(workdir.join("beta.txt"), "two\n").expect("write beta");
    commit_all(&repo, "initial");

    fs::write(workdir.join("alpha.txt"), "one\nthree\n").expect("update alpha");
    fs::write(workdir.join("beta.txt"), "two\nfour\n").expect("update beta");

    stage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("stage alpha");

    let summary = summary_for(&path);
    assert!(summary.staged.iter().any(|entry| entry.path == "alpha.txt"));
    assert!(!summary.staged.iter().any(|entry| entry.path == "beta.txt"));
    assert!(summary.unstaged.iter().any(|entry| entry.path == "beta.txt"));
  }

  #[test]
  fn path_summary_is_empty_when_stage_clears_both_sides() {
    let (repo, path) = make_temp_repo("stage-clears-both-sides");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("write alpha");
    commit_all(&repo, "initial");

    fs::write(workdir.join("alpha.txt"), "one\ntwo\n").expect("update alpha");
    stage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("stage alpha");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("restore alpha");

    stage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("stage restored alpha");

    let path_summary = get_git_change_summary_for_path(
      path.to_string_lossy().to_string(),
      "alpha.txt".to_string(),
    )
    .expect("path summary");
    assert!(path_summary.staged.is_empty());
    assert!(path_summary.unstaged.is_empty());

    let summary = summary_for(&path);
    assert!(summary.staged.is_empty());
    assert!(summary.unstaged.is_empty());
  }

  #[test]
  fn stage_file_change_stages_one_deleted_file() {
    let (repo, path) = make_temp_repo("stage-one-deleted");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("write alpha");
    fs::write(workdir.join("beta.txt"), "two\n").expect("write beta");
    commit_all(&repo, "initial");

    fs::remove_file(workdir.join("alpha.txt")).expect("delete alpha");
    fs::write(workdir.join("beta.txt"), "two\nfour\n").expect("update beta");

    stage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("stage alpha");

    let summary = summary_for(&path);
    let staged = summary.staged.iter().find(|entry| entry.path == "alpha.txt").expect("staged alpha");
    assert_eq!(staged.status, GitFileStatus::Deleted);
    assert!(!summary.staged.iter().any(|entry| entry.path == "beta.txt"));
    assert!(summary.unstaged.iter().any(|entry| entry.path == "beta.txt"));
  }

  #[test]
  fn stage_file_change_stages_one_untracked_file() {
    let (repo, path) = make_temp_repo("stage-one-untracked");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("tracked.txt"), "one\n").expect("write tracked");
    commit_all(&repo, "initial");

    fs::write(workdir.join("tracked.txt"), "one\ntwo\n").expect("update tracked");
    fs::write(workdir.join("draft.txt"), "draft\n").expect("write draft");

    stage_file_change(path.to_string_lossy().to_string(), "draft.txt".to_string()).expect("stage draft");

    let summary = summary_for(&path);
    assert!(summary.staged.iter().any(|entry| entry.path == "draft.txt"));
    assert!(!summary.staged.iter().any(|entry| entry.path == "tracked.txt"));
    assert!(summary.unstaged.iter().any(|entry| entry.path == "tracked.txt"));
  }

  #[test]
  fn unstage_file_change_unstages_one_staged_file() {
    let (repo, path) = make_temp_repo("unstage-one-file");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("write alpha");
    fs::write(workdir.join("beta.txt"), "two\n").expect("write beta");
    commit_all(&repo, "initial");

    fs::write(workdir.join("alpha.txt"), "one\nthree\n").expect("update alpha");
    fs::write(workdir.join("beta.txt"), "two\nfour\n").expect("update beta");
    stage_all_changes(path.to_string_lossy().to_string()).expect("stage all");

    unstage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("unstage alpha");

    let summary = summary_for(&path);
    assert!(!summary.staged.iter().any(|entry| entry.path == "alpha.txt"));
    assert!(summary.staged.iter().any(|entry| entry.path == "beta.txt"));
    assert!(summary.unstaged.iter().any(|entry| entry.path == "alpha.txt"));
  }

  #[test]
  fn stage_file_change_summary_captures_rename_created_by_action() {
    let (repo, path) = make_temp_repo("stage-creates-rename");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("old.txt"), "same\n").expect("write old");
    commit_all(&repo, "initial");

    fs::remove_file(workdir.join("old.txt")).expect("delete old");
    stage_file_change(path.to_string_lossy().to_string(), "old.txt".to_string()).expect("stage delete");
    fs::write(workdir.join("new.txt"), "same\n").expect("write new");

    let summary = stage_file_change_with_summary(
      path.to_string_lossy().to_string(),
      "new.txt".to_string(),
    )
    .expect("stage new");
    assert!(summary.unstaged.is_empty());
    assert_eq!(summary.staged.len(), 1);
    let staged = summary
      .staged
      .iter()
      .find(|entry| entry.path == "new.txt")
      .expect("staged rename");
    assert_eq!(staged.status, GitFileStatus::Renamed);
    assert_eq!(staged.old_path.as_deref(), Some("old.txt"));
    assert_eq!(staged.new_path.as_deref(), Some("new.txt"));
  }

  #[test]
  fn unstage_file_change_summary_handles_renames() {
    let (repo, path) = make_temp_repo("unstage-rename-summary");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("before.txt"), "same\n").expect("write before");
    commit_all(&repo, "initial");

    let status = std::process::Command::new("git")
      .current_dir(&path)
      .args(["mv", "before.txt", "after.txt"])
      .status()
      .expect("run git mv");
    assert!(status.success());

    let summary = unstage_file_change_with_summary(
      path.to_string_lossy().to_string(),
      "after.txt".to_string(),
    )
    .expect("unstage rename");
    assert!(summary.staged.is_empty());
    assert!(summary.unstaged.iter().any(|entry| entry.path == "after.txt"));
  }

  #[test]
  fn path_summary_is_empty_when_unstage_clears_both_sides() {
    let (repo, path) = make_temp_repo("unstage-clears-both-sides");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("write alpha");
    commit_all(&repo, "initial");

    fs::write(workdir.join("alpha.txt"), "one\ntwo\n").expect("update alpha");
    stage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("stage alpha");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("restore alpha");

    unstage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("unstage alpha");

    let path_summary = get_git_change_summary_for_path(
      path.to_string_lossy().to_string(),
      "alpha.txt".to_string(),
    )
    .expect("path summary");
    assert!(path_summary.staged.is_empty());
    assert!(path_summary.unstaged.is_empty());

    let summary = summary_for(&path);
    assert!(summary.staged.is_empty());
    assert!(summary.unstaged.is_empty());
  }

  #[test]
  fn unstage_file_change_unstages_both_sides_of_staged_rename() {
    let (repo, path) = make_temp_repo("unstage-one-rename");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("before.txt"), "same\n").expect("write before");
    commit_all(&repo, "initial");

    let status = std::process::Command::new("git")
      .current_dir(&path)
      .args(["mv", "before.txt", "after.txt"])
      .status()
      .expect("run git mv");
    assert!(status.success());

    let before = summary_for(&path);
    assert_eq!(before.staged.len(), 1);
    assert_eq!(before.staged[0].status, GitFileStatus::Renamed);

    unstage_file_change(path.to_string_lossy().to_string(), "after.txt".to_string()).expect("unstage rename");

    let after = summary_for(&path);
    assert!(after.staged.is_empty());
    assert!(after.unstaged.iter().any(|entry| entry.path == "after.txt"));
  }

  #[test]
  fn unstage_file_change_removes_only_that_path_for_unborn_head() {
    let (repo, path) = make_temp_repo("unstage-one-unborn");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "alpha\n").expect("write alpha");
    fs::write(workdir.join("beta.txt"), "beta\n").expect("write beta");

    let mut index = repo.index().expect("index");
    index.add_path(Path::new("alpha.txt")).expect("stage alpha");
    index.add_path(Path::new("beta.txt")).expect("stage beta");
    index.write().expect("write index");

    unstage_file_change(path.to_string_lossy().to_string(), "alpha.txt".to_string()).expect("unstage alpha");

    let summary = summary_for(&path);
    assert!(!summary.staged.iter().any(|entry| entry.path == "alpha.txt"));
    assert!(summary.staged.iter().any(|entry| entry.path == "beta.txt"));
    assert!(summary.unstaged.iter().any(|entry| entry.path == "alpha.txt"));
  }

  #[test]
  fn unstage_all_clears_index_for_unborn_head() {
    let (repo, path) = make_temp_repo("unstage-unborn");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("draft.txt"), "draft\n").expect("write file");

    let mut index = repo.index().expect("index");
    index.add_path(Path::new("draft.txt")).expect("stage path");
    index.write().expect("write index");

    unstage_all_changes(path.to_string_lossy().to_string()).expect("unstage all");

    let staged = get_git_change_summary(path.to_string_lossy().to_string())
      .expect("summary")
      .staged;
    assert!(staged.is_empty());
  }

  #[test]
  fn unstage_all_clears_both_sides_of_staged_rename() {
    let (repo, path) = make_temp_repo("unstage-rename");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("before.txt"), "same\n").expect("write before");
    commit_all(&repo, "initial");

    let status = std::process::Command::new("git")
      .current_dir(&path)
      .args(["mv", "before.txt", "after.txt"])
      .status()
      .expect("run git mv");
    assert!(status.success());

    let before = get_git_change_summary(path.to_string_lossy().to_string()).expect("summary before");
    assert_eq!(before.staged.len(), 1);
    assert_eq!(before.staged[0].status, GitFileStatus::Renamed);

    unstage_all_changes(path.to_string_lossy().to_string()).expect("unstage all");

    let after = get_git_change_summary(path.to_string_lossy().to_string()).expect("summary after");
    assert!(after.staged.is_empty());
    assert!(after.unstaged.iter().any(|entry| entry.path == "after.txt"));
  }

  #[test]
  fn summary_keeps_binary_files_actionable() {
    let (repo, path) = make_temp_repo("binary-visible");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("image.bin"), [0_u8, 159, 146, 150]).expect("write binary");

    let summary = get_git_change_summary(path.to_string_lossy().to_string()).expect("summary");
    let entry = summary
      .unstaged
      .iter()
      .find(|item| item.path == "image.bin")
      .expect("binary entry");
    assert!(entry.is_binary);
  }

  #[test]
  fn detail_preserves_rename_metadata() {
    let (repo, path) = make_temp_repo("rename-detail");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("before.txt"), "same\n").expect("write before");
    commit_all(&repo, "initial");

    let status = std::process::Command::new("git")
      .current_dir(&path)
      .args(["mv", "before.txt", "after.txt"])
      .status()
      .expect("run git mv");
    assert!(status.success());

    let summary = get_git_change_summary(path.to_string_lossy().to_string()).expect("summary");
    let entry = summary
      .staged
      .iter()
      .find(|item| item.path == "after.txt")
      .expect("renamed entry");
    assert_eq!(entry.status, GitFileStatus::Renamed);

    let detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Staged,
      "after.txt".to_string(),
      Some("before.txt".to_string()),
    )
    .expect("detail");

    assert_eq!(detail.status, GitFileStatus::Renamed);
    assert_eq!(detail.old_path.as_deref(), Some("before.txt"));
    assert_eq!(detail.new_path.as_deref(), Some("after.txt"));
  }

  #[test]
  fn parse_diff_text_handles_hunks_without_diff_header() {
    let parsed = parse_diff_text("@@ -1 +1 @@\n-old\n+new\n", false);
    let file = parsed.first().expect("parsed file");
    assert_eq!(file.rows.len(), 3);
    assert!(file.rows.iter().any(|row| row.left.line_type == GitDiffLineType::Meta));
    assert!(file.rows.iter().any(|row| row.left.line_type == GitDiffLineType::Del && row.left.text == "old"));
    assert!(file.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "new"));
  }

  #[test]
  fn untracked_directory_with_many_files_collapses_to_single_entry() {
    let (repo, path) = make_temp_repo("untracked-dir-collapse");
    let workdir = repo.workdir().expect("workdir");
    let dir = workdir.join("bigdir");
    write_numbered_files(&dir, 25);

    let summary = summary_for(&path);
    let entry = summary
      .unstaged
      .iter()
      .find(|item| item.path == "bigdir/")
      .expect("collapsed directory entry");
    assert!(entry.is_directory);
    assert!(entry.is_untracked);
    assert_eq!(entry.status, GitFileStatus::Untracked);
    assert!(!summary.unstaged.iter().any(|item| item.path.starts_with("bigdir/") && item.path != "bigdir/"));
  }

  #[test]
  fn stage_file_change_stages_untracked_directory_contents() {
    let (repo, path) = make_temp_repo("stage-untracked-dir");
    let workdir = repo.workdir().expect("workdir");
    let dir = workdir.join("bigdir");
    // 16 files keep the directory collapsed, so staging still exercises the directory add_all path.
    write_numbered_files(&dir, 16);

    // The directory stays collapsed as a single entry rather than expanding to file entries.
    let before = summary_for(&path);
    assert!(before.unstaged.iter().any(|entry| entry.path == "bigdir/" && entry.is_directory));

    stage_file_change(path.to_string_lossy().to_string(), "bigdir/".to_string()).expect("stage directory");

    let summary = summary_for(&path);
    assert!(summary.staged.iter().any(|entry| entry.path == "bigdir/file-0.txt"));
    assert!(summary.staged.iter().any(|entry| entry.path == "bigdir/file-15.txt"));
    assert!(!summary.unstaged.iter().any(|entry| entry.path == "bigdir/"));
  }

  #[test]
  fn stage_all_changes_stages_untracked_directory_contents() {
    let (repo, path) = make_temp_repo("stage-all-untracked-dir");
    let workdir = repo.workdir().expect("workdir");
    let dir = workdir.join("bigdir");
    fs::create_dir_all(&dir).expect("create dir");
    fs::write(dir.join("file-0.txt"), "content\n").expect("write nested file");
    fs::write(dir.join("file-1.txt"), "content\n").expect("write nested file");

    stage_all_changes(path.to_string_lossy().to_string()).expect("stage all");

    let summary = summary_for(&path);
    assert!(summary.staged.iter().any(|entry| entry.path == "bigdir/file-0.txt"));
    assert!(summary.staged.iter().any(|entry| entry.path == "bigdir/file-1.txt"));
    assert!(!summary.unstaged.iter().any(|entry| entry.path == "bigdir/"));
  }

  #[test]
  fn untracked_directory_with_few_files_expands_to_file_entries() {
    let (repo, path) = make_temp_repo("untracked-dir-expand");
    let workdir = repo.workdir().expect("workdir");
    let dir = workdir.join("smalldir");
    fs::create_dir_all(dir.join("nested")).expect("create nested dir");
    fs::write(dir.join("alpha.txt"), "one\n").expect("write alpha");
    fs::write(dir.join("beta.txt"), "two\nthree\n").expect("write beta");
    fs::write(dir.join("nested").join("gamma.txt"), "four\n").expect("write nested gamma");

    let summary = summary_for(&path);
    // The collapsed directory entry is gone, replaced by one entry per file.
    assert!(!summary.unstaged.iter().any(|entry| entry.path == "smalldir/"));

    let alpha = summary
      .unstaged
      .iter()
      .find(|entry| entry.path == "smalldir/alpha.txt")
      .expect("alpha entry");
    assert!(alpha.is_untracked);
    assert!(alpha.from_untracked_dir);
    assert!(!alpha.is_directory);
    assert_eq!(alpha.status, GitFileStatus::Untracked);
    assert_eq!(alpha.additions, 1);
    assert_eq!(alpha.deletions, 0);
    assert_eq!(alpha.old_path.as_deref(), Some("smalldir/alpha.txt"));
    assert_eq!(alpha.new_path.as_deref(), Some("smalldir/alpha.txt"));

    let beta = summary
      .unstaged
      .iter()
      .find(|entry| entry.path == "smalldir/beta.txt")
      .expect("beta entry");
    assert!(beta.from_untracked_dir);
    assert_eq!(beta.additions, 2);

    // Nested files are expanded too, with forward-slash paths and no trailing slash.
    let gamma = summary
      .unstaged
      .iter()
      .find(|entry| entry.path == "smalldir/nested/gamma.txt")
      .expect("nested gamma entry");
    assert!(gamma.from_untracked_dir);
    assert!(!gamma.is_directory);
  }

  #[test]
  fn detail_returns_diff_for_file_in_small_untracked_directory() {
    let (repo, path) = make_temp_repo("untracked-dir-detail");
    let workdir = repo.workdir().expect("workdir");
    let dir = workdir.join("smalldir");
    fs::create_dir_all(&dir).expect("create dir");
    fs::write(dir.join("alpha.txt"), "one\ntwo\n").expect("write alpha");

    let detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Unstaged,
      "smalldir/alpha.txt".to_string(),
      None,
    )
    .expect("detail");

    assert_eq!(detail.path, "smalldir/alpha.txt");
    assert!(detail.is_untracked);
    assert!(detail.from_untracked_dir);
    assert!(!detail.is_directory);
    assert_eq!(detail.additions, 2);
    assert_eq!(detail.deletions, 0);
    assert!(detail.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "one"));
    assert!(detail.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "two"));
    assert!(!detail.truncated);
  }

  #[test]
  fn untracked_directory_expands_at_fifteen_and_collapses_at_sixteen() {
    let (repo, path) = make_temp_repo("untracked-dir-boundary");
    let workdir = repo.workdir().expect("workdir");

    let fifteen = workdir.join("fifteen");
    write_numbered_files(&fifteen, 15);

    let sixteen = workdir.join("sixteen");
    write_numbered_files(&sixteen, 16);

    let summary = summary_for(&path);

    // Exactly 15 files: expanded, no collapsed directory entry.
    assert!(!summary.unstaged.iter().any(|entry| entry.path == "fifteen/"));
    let expanded_fifteen = summary
      .unstaged
      .iter()
      .filter(|entry| entry.path.starts_with("fifteen/"))
      .collect::<Vec<_>>();
    assert_eq!(expanded_fifteen.len(), 15);
    assert!(expanded_fifteen.iter().all(|entry| entry.from_untracked_dir && !entry.is_directory));

    // 16 files: stays a single collapsed directory entry.
    let sixteen_entry = summary
      .unstaged
      .iter()
      .find(|entry| entry.path == "sixteen/")
      .expect("collapsed sixteen directory entry");
    assert!(sixteen_entry.is_directory);
    assert!(sixteen_entry.is_untracked);
    assert!(!sixteen_entry.from_untracked_dir);
    assert!(!summary
      .unstaged
      .iter()
      .any(|entry| entry.path.starts_with("sixteen/") && entry.path != "sixteen/"));
  }

  #[test]
  fn untracked_directory_ignored_files_do_not_count_toward_expansion_cap() {
    let (repo, path) = make_temp_repo("untracked-dir-ignored");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join(".gitignore"), "mixed/*.log\n").expect("write gitignore");

    let dir = workdir.join("mixed");
    write_numbered_files(&dir, 3);
    // 20 ignored files would blow past the cap of 15 if they counted.
    for index in 0..20 {
      fs::write(dir.join(format!("ignored-{index}.log")), "noise\n").expect("write ignored file");
    }

    let summary = summary_for(&path);
    // Ignored files are skipped, so the 3 real files expand instead of collapsing.
    assert!(!summary.unstaged.iter().any(|entry| entry.path == "mixed/"));
    let expanded = summary
      .unstaged
      .iter()
      .filter(|entry| entry.path.starts_with("mixed/"))
      .map(|entry| entry.path.as_str())
      .collect::<Vec<_>>();
    assert_eq!(expanded.len(), 3);
    assert!(expanded.contains(&"mixed/file-0.txt"));
    assert!(expanded.contains(&"mixed/file-1.txt"));
    assert!(expanded.contains(&"mixed/file-2.txt"));
    assert!(!expanded.iter().any(|entry| entry.ends_with(".log")));
  }

  #[cfg(unix)]
  #[test]
  fn untracked_directory_with_unreadable_subdir_stays_collapsed_without_error() {
    use std::os::unix::fs::PermissionsExt;

    let (repo, path) = make_temp_repo("untracked-dir-unreadable");
    let workdir = repo.workdir().expect("workdir");
    let dir = workdir.join("outer");
    let locked = dir.join("locked");
    fs::create_dir_all(&locked).expect("create nested dir");
    fs::write(dir.join("keep.txt"), "one\n").expect("write readable file");

    // An unreadable subdirectory makes the expansion walk hit EACCES on read_dir. Pre-feature this
    // directory rendered as one collapsed entry; the walk must degrade to that, never error.
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).expect("lock subdir");

    let result = get_git_change_summary(path.to_string_lossy().to_string());

    // Restore permissions before asserting so the temp directory can always be cleaned up.
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).expect("restore subdir");

    let summary = result.expect("summary should not error");

    let entry = summary
      .unstaged
      .iter()
      .find(|item| item.path == "outer/")
      .expect("collapsed directory entry");
    assert!(entry.is_directory);
    assert!(entry.is_untracked);
    assert_eq!(entry.status, GitFileStatus::Untracked);
    assert!(!entry.from_untracked_dir);
    // No per-file entries leaked out of the directory that could not be expanded.
    assert!(!summary
      .unstaged
      .iter()
      .any(|item| item.path.starts_with("outer/") && item.path != "outer/"));
  }

  #[test]
  fn stage_file_change_stages_single_file_from_expanded_untracked_directory() {
    let (repo, path) = make_temp_repo("stage-expanded-file");
    let workdir = repo.workdir().expect("workdir");
    let dir = workdir.join("smalldir");
    fs::create_dir_all(&dir).expect("create dir");
    fs::write(dir.join("alpha.txt"), "one\n").expect("write alpha");
    fs::write(dir.join("beta.txt"), "two\n").expect("write beta");

    // Both files are expanded (from an untracked directory) before staging.
    let before = summary_for(&path);
    assert!(before
      .unstaged
      .iter()
      .any(|entry| entry.path == "smalldir/alpha.txt" && entry.from_untracked_dir));
    assert!(before
      .unstaged
      .iter()
      .any(|entry| entry.path == "smalldir/beta.txt" && entry.from_untracked_dir));

    stage_file_change(path.to_string_lossy().to_string(), "smalldir/alpha.txt".to_string())
      .expect("stage single file");

    let summary = summary_for(&path);
    assert!(summary.staged.iter().any(|entry| entry.path == "smalldir/alpha.txt"));
    assert!(!summary.staged.iter().any(|entry| entry.path == "smalldir/beta.txt"));
    assert!(!summary.unstaged.iter().any(|entry| entry.path == "smalldir/alpha.txt"));
    assert!(summary.unstaged.iter().any(|entry| entry.path == "smalldir/beta.txt"));
  }

  #[test]
  fn summary_marks_oversized_untracked_file_binary_without_reading_it_fully() {
    let (repo, path) = make_temp_repo("oversized-untracked");
    let workdir = repo.workdir().expect("workdir");
    let content = vec![b'a'; (MAX_UNTRACKED_PREVIEW_BYTES + 1) as usize];
    fs::write(workdir.join("huge.txt"), &content).expect("write huge file");

    let summary = summary_for(&path);
    let entry = summary
      .unstaged
      .iter()
      .find(|item| item.path == "huge.txt")
      .expect("huge file entry");
    assert!(entry.is_binary);
    assert_eq!(entry.additions, 0);

    let detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Unstaged,
      "huge.txt".to_string(),
      None,
    )
    .expect("detail");
    assert!(detail.rows.is_empty());
  }

  #[test]
  fn detail_truncates_rows_beyond_row_cap() {
    let (repo, path) = make_temp_repo("truncate-rows");
    let workdir = repo.workdir().expect("workdir");
    let mut content = String::new();
    for index in 0..(MAX_DIFF_ROWS + 500) {
      content.push_str(&format!("l{index}\n"));
    }
    fs::write(workdir.join("large.txt"), content).expect("write large file");
    fs::write(workdir.join("small.txt"), "one\ntwo\n").expect("write small file");

    let large_detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Unstaged,
      "large.txt".to_string(),
      None,
    )
    .expect("large detail");
    assert!(large_detail.rows.len() <= MAX_DIFF_ROWS);
    assert!(large_detail.truncated);

    let small_detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Unstaged,
      "small.txt".to_string(),
      None,
    )
    .expect("small detail");
    assert!(!small_detail.truncated);
  }

  #[test]
  fn detail_scopes_rename_diff_away_from_unrelated_staged_file() {
    let (repo, path) = make_temp_repo("rename-scoped");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("before.txt"), "same\n").expect("write before");
    fs::write(workdir.join("unrelated.txt"), "zero\n").expect("write unrelated");
    commit_all(&repo, "initial");

    let status = std::process::Command::new("git")
      .current_dir(&path)
      .args(["mv", "before.txt", "after.txt"])
      .status()
      .expect("run git mv");
    assert!(status.success());

    fs::write(workdir.join("unrelated.txt"), "zero\nUNRELATED_MARKER\n").expect("update unrelated");
    let add_status = std::process::Command::new("git")
      .current_dir(&path)
      .args(["add", "unrelated.txt"])
      .status()
      .expect("stage unrelated");
    assert!(add_status.success());

    let detail = get_git_file_diff(
      path.to_string_lossy().to_string(),
      GitDiffSection::Staged,
      "after.txt".to_string(),
      Some("before.txt".to_string()),
    )
    .expect("detail");

    assert_eq!(detail.status, GitFileStatus::Renamed);
    assert_eq!(detail.old_path.as_deref(), Some("before.txt"));
    assert_eq!(detail.new_path.as_deref(), Some("after.txt"));
    assert!(!detail.rows.iter().any(|row| row.left.text.contains("UNRELATED_MARKER") || row.right.text.contains("UNRELATED_MARKER")));
  }

  #[test]
  fn tracked_file_rewritten_beyond_max_blob_size_is_treated_as_binary() {
    let (repo, path) = make_temp_repo("oversized-tracked");
    let workdir = repo.workdir().expect("workdir");
    fs::write(workdir.join("alpha.txt"), "one\n").expect("write alpha");
    commit_all(&repo, "initial");

    let content = vec![b'b'; (MAX_DIFF_BLOB_SIZE + 1) as usize];
    fs::write(workdir.join("alpha.txt"), &content).expect("rewrite alpha huge");

    let summary = summary_for(&path);
    let entry = summary
      .unstaged
      .iter()
      .find(|item| item.path == "alpha.txt")
      .expect("alpha entry");
    assert!(entry.is_binary);
  }

  #[test]
  fn list_git_branches_reports_checked_out_and_worktree_state() {
    let (repo, path) = make_temp_repo("list-branches");
    commit_all(&repo, "initial");

    let current_branch = repo
      .head()
      .expect("head")
      .shorthand()
      .expect("shorthand")
      .to_string();

    let commit = head_commit(&repo).expect("head commit").expect("commit");
    repo
      .branch("side-branch", &commit, false)
      .expect("create side branch");

    let branches = list_git_branches(path.to_string_lossy().to_string()).expect("list branches");

    let current = branches
      .iter()
      .find(|branch| branch.name == current_branch)
      .expect("current branch present");
    assert!(matches!(&current.worktree_path, Some(value) if !value.is_empty()));

    let side = branches
      .iter()
      .find(|branch| branch.name == "side-branch")
      .expect("side branch present");
    assert!(side.worktree_path.is_none());
  }
}
