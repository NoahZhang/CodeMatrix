use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::{LazyLock, Mutex};

use crate::validate;

static MAIN_BRANCH_CACHE: LazyLock<Mutex<HashMap<String, (String, std::time::Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// Merge lock: serialize merge operations to prevent concurrent conflicts
static MERGE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

fn git_allow_fail(cwd: &str, args: &[&str]) -> String {
    git(cwd, args).unwrap_or_default()
}

#[derive(Serialize, Clone)]
pub struct ChangedFile {
    path: String,
    lines_added: i64,
    lines_removed: i64,
    status: String,
    committed: bool,
}

#[derive(Serialize)]
pub struct WorktreeStatus {
    has_committed_changes: bool,
    has_uncommitted_changes: bool,
}

#[derive(Serialize)]
pub struct MergeStatus {
    main_ahead_count: i64,
    conflicting_files: Vec<String>,
}

#[derive(Serialize)]
pub struct MergeResult {
    main_branch: String,
    lines_added: i64,
    lines_removed: i64,
}

#[derive(Serialize)]
pub struct FileDiffResult {
    diff: String,
    #[serde(rename = "oldContent")]
    old_content: String,
    #[serde(rename = "newContent")]
    new_content: String,
}

#[derive(Serialize)]
pub struct BranchLogEntry {
    hash: String,
    message: String,
    author: String,
    date: String,
}

/// Detect the main branch (main or master), cached for 60s.
fn detect_main_branch(project_root: &str) -> Result<String, String> {
    {
        let cache = MAIN_BRANCH_CACHE.lock().unwrap();
        if let Some((branch, ts)) = cache.get(project_root) {
            if ts.elapsed() < CACHE_TTL {
                return Ok(branch.clone());
            }
        }
    }

    // Try 'main' first, then 'master'
    let branch = if git(project_root, &["rev-parse", "--verify", "main"]).is_ok() {
        "main".to_string()
    } else if git(project_root, &["rev-parse", "--verify", "master"]).is_ok() {
        "master".to_string()
    } else {
        return Err("Could not detect main branch (tried 'main' and 'master')".to_string());
    };

    {
        let mut cache = MAIN_BRANCH_CACHE.lock().unwrap();
        cache.insert(
            project_root.to_string(),
            (branch.clone(), std::time::Instant::now()),
        );
    }

    Ok(branch)
}

#[tauri::command]
pub fn get_main_branch(project_root: String) -> Result<String, String> {
    validate::assert_path(&project_root)?;
    detect_main_branch(&project_root)
}

#[tauri::command]
pub fn get_current_branch(cwd: String) -> Result<String, String> {
    validate::assert_path(&cwd)?;
    git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
}

#[tauri::command]
pub fn get_changed_files(
    worktree_path: String,
    project_root: Option<String>,
) -> Result<Vec<ChangedFile>, String> {
    validate::assert_path(&worktree_path)?;
    let root = project_root.as_deref().unwrap_or(&worktree_path);
    validate::assert_path(root)?;

    let main_branch = detect_main_branch(root)?;
    let mut files: Vec<ChangedFile> = Vec::new();

    // Committed changes (diff against main)
    let committed_raw = git_allow_fail(
        &worktree_path,
        &["diff", "--numstat", &format!("{main_branch}...HEAD")],
    );
    for line in committed_raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let added = parts[0].parse::<i64>().unwrap_or(0);
            let removed = parts[1].parse::<i64>().unwrap_or(0);
            files.push(ChangedFile {
                path: parts[2].to_string(),
                lines_added: added,
                lines_removed: removed,
                status: "M".to_string(),
                committed: true,
            });
        }
    }

    // Uncommitted changes
    let uncommitted_raw = git_allow_fail(&worktree_path, &["diff", "--numstat"]);
    for line in uncommitted_raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let added = parts[0].parse::<i64>().unwrap_or(0);
            let removed = parts[1].parse::<i64>().unwrap_or(0);
            files.push(ChangedFile {
                path: parts[2].to_string(),
                lines_added: added,
                lines_removed: removed,
                status: "M".to_string(),
                committed: false,
            });
        }
    }

    // Untracked files
    let untracked_raw = git_allow_fail(
        &worktree_path,
        &["ls-files", "--others", "--exclude-standard"],
    );
    for line in untracked_raw.lines() {
        if !line.is_empty() {
            files.push(ChangedFile {
                path: line.to_string(),
                lines_added: 0,
                lines_removed: 0,
                status: "?".to_string(),
                committed: false,
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub fn get_changed_files_from_branch(
    project_root: String,
    branch_name: String,
) -> Result<Vec<ChangedFile>, String> {
    validate::assert_path(&project_root)?;
    validate::assert_branch_name(&branch_name)?;

    let main_branch = detect_main_branch(&project_root)?;
    let mut files: Vec<ChangedFile> = Vec::new();

    let raw = git_allow_fail(
        &project_root,
        &["diff", "--numstat", &format!("{main_branch}...{branch_name}")],
    );
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let added = parts[0].parse::<i64>().unwrap_or(0);
            let removed = parts[1].parse::<i64>().unwrap_or(0);
            files.push(ChangedFile {
                path: parts[2].to_string(),
                lines_added: added,
                lines_removed: removed,
                status: "M".to_string(),
                committed: true,
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub fn get_file_diff(worktree_path: String, file_path: String) -> Result<FileDiffResult, String> {
    validate::assert_path(&worktree_path)?;

    let diff = git_allow_fail(&worktree_path, &["diff", "--", &file_path]);
    let old_content = git_allow_fail(&worktree_path, &["show", &format!("HEAD:{file_path}")]);
    let new_path = Path::new(&worktree_path).join(&file_path);
    let new_content = std::fs::read_to_string(&new_path).unwrap_or_default();

    Ok(FileDiffResult {
        diff,
        old_content,
        new_content,
    })
}

#[tauri::command]
pub fn get_file_diff_from_branch(
    project_root: String,
    branch_name: String,
    file_path: String,
) -> Result<FileDiffResult, String> {
    validate::assert_path(&project_root)?;
    validate::assert_branch_name(&branch_name)?;

    let main_branch = detect_main_branch(&project_root)?;
    let diff = git_allow_fail(
        &project_root,
        &["diff", &format!("{main_branch}...{branch_name}"), "--", &file_path],
    );
    let old_content = git_allow_fail(
        &project_root,
        &["show", &format!("{main_branch}:{file_path}")],
    );
    let new_content = git_allow_fail(
        &project_root,
        &["show", &format!("{branch_name}:{file_path}")],
    );

    Ok(FileDiffResult {
        diff,
        old_content,
        new_content,
    })
}

#[tauri::command]
pub fn get_gitignored_dirs(worktree_path: String) -> Result<Vec<String>, String> {
    validate::assert_path(&worktree_path)?;

    let output = git_allow_fail(
        &worktree_path,
        &["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
    );

    Ok(output
        .lines()
        .filter(|l| l.ends_with('/'))
        .map(|l| l.trim_end_matches('/').to_string())
        .collect())
}

#[tauri::command]
pub fn get_worktree_status(
    worktree_path: String,
    project_root: String,
) -> Result<WorktreeStatus, String> {
    validate::assert_path(&worktree_path)?;
    validate::assert_path(&project_root)?;

    let main_branch = detect_main_branch(&project_root)?;

    let committed = git(
        &worktree_path,
        &["rev-list", "--count", &format!("{main_branch}..HEAD")],
    )
    .unwrap_or_else(|_| "0".to_string());
    let has_committed = committed.parse::<i64>().unwrap_or(0) > 0;

    let uncommitted = git_allow_fail(&worktree_path, &["status", "--porcelain"]);
    let has_uncommitted = !uncommitted.is_empty();

    Ok(WorktreeStatus {
        has_committed_changes: has_committed,
        has_uncommitted_changes: has_uncommitted,
    })
}

#[tauri::command]
pub fn check_merge_status(
    worktree_path: String,
    project_root: String,
    branch_name: String,
) -> Result<MergeStatus, String> {
    validate::assert_path(&worktree_path)?;
    validate::assert_path(&project_root)?;
    validate::assert_branch_name(&branch_name)?;

    let main_branch = detect_main_branch(&project_root)?;

    // Count how many commits main is ahead
    let ahead = git(
        &project_root,
        &["rev-list", "--count", &format!("{branch_name}..{main_branch}")],
    )
    .unwrap_or_else(|_| "0".to_string());
    let main_ahead_count = ahead.parse::<i64>().unwrap_or(0);

    // Check for merge conflicts using merge-tree
    let mut conflicting_files = Vec::new();
    if main_ahead_count > 0 {
        let merge_base = git(&project_root, &["merge-base", &main_branch, &branch_name]);
        if let Ok(base) = merge_base {
            let merge_tree = git_allow_fail(
                &project_root,
                &["merge-tree", &base, &main_branch, &branch_name],
            );
            for line in merge_tree.lines() {
                if line.starts_with("changed in both") || line.contains("CONFLICT") {
                    // Extract filename if present
                    if let Some(path) = line.split_whitespace().last() {
                        conflicting_files.push(path.to_string());
                    }
                }
            }
        }
    }

    Ok(MergeStatus {
        main_ahead_count,
        conflicting_files,
    })
}

#[tauri::command]
pub fn merge_task(
    project_root: String,
    branch_name: String,
    squash: bool,
    delete_branch: bool,
    worktree_path: String,
) -> Result<MergeResult, String> {
    validate::assert_path(&project_root)?;
    validate::assert_branch_name(&branch_name)?;
    validate::assert_path(&worktree_path)?;

    let _lock = MERGE_LOCK.lock().unwrap();
    let main_branch = detect_main_branch(&project_root)?;

    // Get diff stats before merge
    let _diff_stat = git_allow_fail(
        &project_root,
        &["diff", "--stat", &format!("{main_branch}...{branch_name}")],
    );

    // Parse lines added/removed from --numstat
    let numstat = git_allow_fail(
        &project_root,
        &["diff", "--numstat", &format!("{main_branch}...{branch_name}")],
    );
    let (mut lines_added, mut lines_removed) = (0i64, 0i64);
    for line in numstat.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 2 {
            lines_added += parts[0].parse::<i64>().unwrap_or(0);
            lines_removed += parts[1].parse::<i64>().unwrap_or(0);
        }
    }

    // Perform merge
    if squash {
        git(&project_root, &["merge", "--squash", &branch_name])?;
        git(&project_root, &["commit", "--no-edit", "-m", &format!("Squash merge branch '{branch_name}'")])?;
    } else {
        git(&project_root, &["merge", "--no-edit", &branch_name])?;
    }

    // Remove worktree and optionally delete branch
    let _ = git(&project_root, &["worktree", "remove", &worktree_path, "--force"]);
    if delete_branch {
        let _ = git(&project_root, &["branch", "-D", &branch_name]);
    }

    // Invalidate main branch cache
    {
        let mut cache = MAIN_BRANCH_CACHE.lock().unwrap();
        cache.remove(&project_root);
    }

    Ok(MergeResult {
        main_branch,
        lines_added,
        lines_removed,
    })
}

#[tauri::command]
pub fn get_branch_log(
    project_root: String,
    branch_name: String,
) -> Result<Vec<BranchLogEntry>, String> {
    validate::assert_path(&project_root)?;
    validate::assert_branch_name(&branch_name)?;

    let main_branch = detect_main_branch(&project_root)?;
    let raw = git_allow_fail(
        &project_root,
        &[
            "log",
            "--format=%H|%s|%an|%ai",
            &format!("{main_branch}..{branch_name}"),
        ],
    );

    Ok(raw
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() == 4 {
                Some(BranchLogEntry {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    author: parts[2].to_string(),
                    date: parts[3].to_string(),
                })
            } else {
                None
            }
        })
        .collect())
}

#[tauri::command]
pub fn push_task(
    project_root: String,
    branch_name: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    validate::assert_path(&project_root)?;
    validate::assert_branch_name(&branch_name)?;
    validate::assert_path(&worktree_path)?;

    let mut args = vec!["push", "origin", &branch_name];
    if force {
        args.push("--force-with-lease");
    }

    git(&worktree_path, &args)
        .map(|_| ())
}

#[tauri::command]
pub fn rebase_task(
    worktree_path: String,
    project_root: String,
) -> Result<(), String> {
    validate::assert_path(&worktree_path)?;
    validate::assert_path(&project_root)?;

    let main_branch = detect_main_branch(&project_root)?;

    // Fetch latest
    let _ = git(&project_root, &["fetch", "origin", &main_branch]);

    // Rebase
    git(&worktree_path, &["rebase", &format!("origin/{main_branch}")])?;

    Ok(())
}

#[tauri::command]
pub fn commit_all(worktree_path: String, message: String) -> Result<(), String> {
    validate::assert_path(&worktree_path)?;

    git(&worktree_path, &["add", "-A"])?;
    git(&worktree_path, &["commit", "-m", &message])?;

    Ok(())
}

#[tauri::command]
pub fn discard_uncommitted(worktree_path: String) -> Result<(), String> {
    validate::assert_path(&worktree_path)?;

    git(&worktree_path, &["checkout", "."])?;
    git(&worktree_path, &["clean", "-fd"])?;

    Ok(())
}
