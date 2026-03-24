use serde::Serialize;
use slug::slugify;
use std::path::Path;
use uuid::Uuid;

use crate::validate;

#[derive(Serialize)]
pub struct CreateTaskResult {
    id: String,
    branch_name: String,
    worktree_path: String,
}

fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
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

#[tauri::command]
pub fn create_task(
    project_root: String,
    task_name: String,
    branch_prefix: String,
    symlink_dirs: Vec<String>,
) -> Result<CreateTaskResult, String> {
    log::info!("[create_task] project_root={project_root}, task_name={task_name}");
    validate::assert_path(&project_root)?;
    validate::assert_non_empty(&task_name, "task_name")?;

    let id = Uuid::new_v4().to_string();
    let slug = slugify(&task_name);
    let short_id = &id[..8];
    let branch_name = format!("{branch_prefix}/{slug}-{short_id}");

    // Create worktree directory
    let worktrees_dir = Path::new(&project_root).join(".worktrees");
    std::fs::create_dir_all(&worktrees_dir)
        .map_err(|e| format!("Failed to create .worktrees dir: {e}"))?;

    let worktree_path = worktrees_dir
        .join(&format!("{slug}-{short_id}"))
        .to_string_lossy()
        .to_string();

    // Create git worktree
    git(
        &project_root,
        &["worktree", "add", "-b", &branch_name, &worktree_path],
    )?;

    // Create symlinks for specified directories (e.g. node_modules)
    for dir in &symlink_dirs {
        let source = Path::new(&project_root).join(dir);
        let target = Path::new(&worktree_path).join(dir);
        if source.exists() && !target.exists() {
            #[cfg(unix)]
            {
                if let Err(e) = std::os::unix::fs::symlink(&source, &target) {
                    log::warn!("Failed to symlink {dir}: {e}");
                }
            }
        }
    }

    // Create .plans directory
    let plans_dir = Path::new(&worktree_path).join(".plans");
    let _ = std::fs::create_dir_all(&plans_dir);

    Ok(CreateTaskResult {
        id,
        branch_name,
        worktree_path,
    })
}

#[tauri::command]
pub fn delete_task(
    project_root: String,
    worktree_path: String,
    branch_name: String,
    delete_branch: bool,
) -> Result<(), String> {
    validate::assert_path(&project_root)?;
    validate::assert_path(&worktree_path)?;
    validate::assert_branch_name(&branch_name)?;

    // Remove worktree
    let _ = git(
        &project_root,
        &["worktree", "remove", &worktree_path, "--force"],
    );

    // Also try direct filesystem removal in case git worktree remove failed
    if Path::new(&worktree_path).exists() {
        let _ = std::fs::remove_dir_all(&worktree_path);
    }

    // Prune stale worktree entries
    let _ = git(&project_root, &["worktree", "prune"]);

    // Delete branch if requested
    if delete_branch {
        let _ = git(&project_root, &["branch", "-D", &branch_name]);
    }

    Ok(())
}

#[tauri::command]
pub fn create_arena_worktree(
    project_root: String,
    branch_name: String,
) -> Result<String, String> {
    validate::assert_path(&project_root)?;
    validate::assert_branch_name(&branch_name)?;

    let worktrees_dir = Path::new(&project_root).join(".worktrees");
    std::fs::create_dir_all(&worktrees_dir)
        .map_err(|e| format!("Failed to create .worktrees dir: {e}"))?;

    let id = Uuid::new_v4().to_string();
    let short_id = &id[..8];
    let worktree_path = worktrees_dir
        .join(&format!("arena-{short_id}"))
        .to_string_lossy()
        .to_string();

    git(
        &project_root,
        &["worktree", "add", "-b", &branch_name, &worktree_path],
    )?;

    Ok(worktree_path)
}

#[tauri::command]
pub fn remove_arena_worktree(
    project_root: String,
    worktree_path: String,
    branch_name: String,
) -> Result<(), String> {
    validate::assert_path(&project_root)?;
    validate::assert_path(&worktree_path)?;
    validate::assert_branch_name(&branch_name)?;

    let _ = git(
        &project_root,
        &["worktree", "remove", &worktree_path, "--force"],
    );

    if Path::new(&worktree_path).exists() {
        let _ = std::fs::remove_dir_all(&worktree_path);
    }

    let _ = git(&project_root, &["worktree", "prune"]);
    let _ = git(&project_root, &["branch", "-D", &branch_name]);

    Ok(())
}
