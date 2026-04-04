use git2::{
  build::CheckoutBuilder, Commit, Delta, Diff, DiffFormat, DiffLineType, DiffOptions, Error, Patch,
  Repository, Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::process::Command;

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
  pub is_untracked: bool,
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
  pub is_untracked: bool,
  pub status: GitFileStatus,
  pub rows: Vec<GitDiffRow>,
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
  let staged = get_staged_summaries(&repo)?;
  let unstaged = get_unstaged_summaries(&repo)?;
  Ok(GitChangeSummaryPayload { staged, unstaged })
}

pub fn get_git_file_diff(
  path: String,
  section: GitDiffSection,
  file_path: String,
) -> Result<GitFileDiffPayload, String> {
  let repo = open_repository(&path)?;
  let summary = match section {
    GitDiffSection::Staged => get_staged_summaries(&repo)?,
    GitDiffSection::Unstaged => get_unstaged_summaries(&repo)?,
  }
  .into_iter()
  .find(|entry| entry.path == file_path)
  .ok_or_else(|| format!("Unable to find diff for '{}'", file_path))?;

  let diff_text = if summary.is_untracked {
    render_untracked_diff(&repo, &summary.path)?
  } else if summary.status == GitFileStatus::Renamed {
    render_section_diff(&repo, section, None)?
  } else {
    render_section_diff(&repo, section, Some(&file_path))?
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

  Ok(GitFileDiffPayload {
    path: summary.path,
    old_path: parsed.as_ref().and_then(|file| file.old_path.clone()).or(summary.old_path),
    new_path: parsed.as_ref().and_then(|file| file.new_path.clone()).or(summary.new_path),
    additions: summary.additions,
    deletions: summary.deletions,
    changed_line_count: summary.changed_line_count,
    is_binary,
    is_untracked: summary.is_untracked,
    status: parsed.as_ref().map(|file| file.status).unwrap_or(summary.status),
    rows: parsed.map(|file| file.rows).unwrap_or_default(),
  })
}

pub fn stage_all_changes(path: String) -> Result<(), String> {
  let repo = open_repository(&path)?;
  let unstaged = get_unstaged_summaries(&repo)?;
  let mut index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;

  for entry in unstaged {
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
  }

  index.write().map_err(|error| git_error("Failed to write git index", error))
}

pub fn unstage_all_changes(path: String) -> Result<(), String> {
  let repo = open_repository(&path)?;
  let staged = get_staged_summaries(&repo)?;
  if staged.is_empty() {
    return Ok(());
  }

  if let Some(head_commit) = head_commit(&repo)? {
    let target = head_commit.as_object();
    let mut pathspecs = Vec::new();
    for entry in &staged {
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
  index.clear().map_err(|error| git_error("Failed to clear git index", error))?;
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

fn render_section_diff(
  repo: &Repository,
  section: GitDiffSection,
  pathspec: Option<&str>,
) -> Result<String, String> {
  let mut diff = match section {
    GitDiffSection::Staged => staged_diff(repo, pathspec)?,
    GitDiffSection::Unstaged => unstaged_diff(repo, pathspec)?,
  };
  find_similar(&mut diff)?;
  render_diff(&diff)
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
  let mut diff = staged_diff(repo, None)?;
  find_similar(&mut diff)?;
  collect_summaries(repo, &diff, GitDiffSection::Staged)
}

fn get_unstaged_summaries(repo: &Repository) -> Result<Vec<GitChangeSummary>, String> {
  let mut diff = unstaged_diff(repo, None)?;
  find_similar(&mut diff)?;
  collect_summaries(repo, &diff, GitDiffSection::Unstaged)
}

fn staged_diff<'repo>(repo: &'repo Repository, pathspec: Option<&str>) -> Result<Diff<'repo>, String> {
  let index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;
  let head_tree = head_commit(repo)?
    .map(|commit| commit.tree().map_err(|error| git_error("Failed to load HEAD tree", error)))
    .transpose()?;
  let mut options = diff_options(pathspec, false);
  repo
    .diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut options))
    .map_err(|error| git_error("Failed to generate staged diff", error))
}

fn unstaged_diff<'repo>(repo: &'repo Repository, pathspec: Option<&str>) -> Result<Diff<'repo>, String> {
  let index = repo.index().map_err(|error| git_error("Failed to open git index", error))?;
  let mut options = diff_options(pathspec, true);
  repo
    .diff_index_to_workdir(Some(&index), Some(&mut options))
    .map_err(|error| git_error("Failed to generate unstaged diff", error))
}

fn diff_options(pathspec: Option<&str>, include_untracked: bool) -> DiffOptions {
  let mut options = DiffOptions::new();
  options
    .include_typechange(true)
    .include_untracked(include_untracked)
    .recurse_untracked_dirs(include_untracked)
    .include_unmodified(false);
  if let Some(path) = pathspec {
    options.pathspec(path);
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
) -> Result<Vec<GitChangeSummary>, String> {
  let untracked_paths = if section == GitDiffSection::Unstaged {
    get_untracked_paths(repo)?
  } else {
    HashSet::new()
  };

  diff
    .deltas()
    .enumerate()
    .map(|(index, delta)| build_summary(repo, diff, index, delta, section, &untracked_paths))
    .collect()
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
  let changed_line_count = if is_untracked && additions == 0 && deletions == 0 {
    let (line_count, detected_binary) = summarize_untracked_file(repo, &path)?;
    is_binary = is_binary || detected_binary;
    additions = line_count;
    deletions = 0;
    line_count
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
    is_untracked,
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

fn get_untracked_paths(repo: &Repository) -> Result<HashSet<String>, String> {
  let mut options = StatusOptions::new();
  options
    .include_untracked(true)
    .recurse_untracked_dirs(true)
    .include_unmodified(false);
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

fn summarize_untracked_file(repo: &Repository, path: &str) -> Result<(usize, bool), String> {
  let contents = read_worktree_file(repo, path)?;
  summarize_untracked_contents(&contents)
}

fn render_untracked_diff(repo: &Repository, path: &str) -> Result<String, String> {
  let contents = read_worktree_file(repo, path)?;
  let (line_count, is_binary) = summarize_untracked_contents(&contents)?;
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

fn read_worktree_file(repo: &Repository, path: &str) -> Result<Vec<u8>, String> {
  let workdir = repo
    .workdir()
    .ok_or_else(|| "Repository does not have a worktree".to_string())?;
  let full_path = workdir.join(path);
  fs::read(&full_path).map_err(|error| format!("Failed to read '{}': {error}", path))
}

fn summarize_untracked_contents(contents: &[u8]) -> Result<(usize, bool), String> {
  if contents.is_empty() {
    return Ok((0, false));
  }
  if contents.contains(&0) {
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
  use git2::{IndexAddOption, Repository, Signature};
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
    )
    .expect("detail");

    assert!(detail.is_untracked);
    assert_eq!(detail.additions, 2);
    assert_eq!(detail.deletions, 0);
    assert!(detail.rows.iter().any(|row| row.left.line_type == GitDiffLineType::Meta));
    assert!(detail.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "alpha"));
    assert!(detail.rows.iter().any(|row| row.right.line_type == GitDiffLineType::Add && row.right.text == "beta"));
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

}
