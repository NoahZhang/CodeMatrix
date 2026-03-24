mod agents;
mod git;
mod persistence;
mod plans;
mod pty;
mod remote;
mod tasks;
mod validate;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var("RUST_LOG", "info");
    env_logger::init();

    // Resolve the user's full login-interactive shell PATH so spawned PTYs
    // can find CLI tools (claude, codex, gemini, nvm, volta, fnm, etc.)
    fix_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Store app handle for global access (e.g. event emission)
            pty::init(app.handle().clone());
            plans::init(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // PTY / Agent
            pty::spawn_agent,
            pty::write_to_agent,
            pty::resize_agent,
            pty::pause_agent,
            pty::resume_agent,
            pty::kill_agent,
            pty::count_running_agents,
            pty::kill_all_agents,
            pty::list_agents,
            // Task
            tasks::create_task,
            tasks::delete_task,
            // Git
            git::get_changed_files,
            git::get_changed_files_from_branch,
            git::get_file_diff,
            git::get_file_diff_from_branch,
            git::get_gitignored_dirs,
            git::get_worktree_status,
            git::check_merge_status,
            git::merge_task,
            git::get_branch_log,
            git::push_task,
            git::rebase_task,
            git::get_main_branch,
            git::get_current_branch,
            git::commit_all,
            git::discard_uncommitted,
            // Persistence
            persistence::save_app_state,
            persistence::load_app_state,
            // Agents discovery
            agents::list_agents_cmd,
            // Plans
            plans::watch_plans,
            // Remote
            remote::start_remote_server,
            remote::stop_remote_server,
            remote::get_remote_status,
            // Arena
            persistence::save_arena_data,
            persistence::load_arena_data,
            tasks::create_arena_worktree,
            tasks::remove_arena_worktree,
            // Validate
            validate::check_path_exists,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    pty::kill_all_agents_sync();
                    plans::stop_all_watchers();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Resolve the user's full login-interactive shell PATH.
/// Uses -ilc (interactive + login) to source both profile and rc files,
/// where version managers (nvm, volta, fnm) add to PATH.
fn fix_path() {
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let sentinel = "__PCODE_PATH__";
        let cmd = format!("printf \"{sentinel}%s{sentinel}\" \"$PATH\"");

        match Command::new(&shell)
            .args(["-ilc", &cmd])
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let pattern = format!("{sentinel}");
                if let Some(start) = stdout.find(&pattern) {
                    let rest = &stdout[start + pattern.len()..];
                    if let Some(end) = rest.find(&pattern) {
                        let path = &rest[..end];
                        if !path.is_empty() {
                            std::env::set_var("PATH", path);
                            log::info!("[fix_path] Resolved PATH from login shell");
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("[fix_path] Failed to resolve login shell PATH: {e}");
            }
        }
    }
}
