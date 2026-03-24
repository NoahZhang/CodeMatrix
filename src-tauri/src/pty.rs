use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static SESSIONS: OnceLock<Arc<Mutex<HashMap<String, PtySession>>>> = OnceLock::new();

const BATCH_MAX: usize = 64 * 1024;
const BATCH_INTERVAL: Duration = Duration::from_millis(8);
const SMALL_READ_THRESHOLD: usize = 1024;
const TAIL_CAP: usize = 8 * 1024;
const MAX_LINES: usize = 50;
const SCROLLBACK_CAP: usize = 64 * 1024;

pub fn init(handle: AppHandle) {
    APP_HANDLE.set(handle).ok();
    SESSIONS.set(Arc::new(Mutex::new(HashMap::new()))).ok();
}

pub(crate) fn sessions() -> &'static Arc<Mutex<HashMap<String, PtySession>>> {
    SESSIONS.get().expect("PTY sessions not initialized")
}

#[allow(dead_code)]
fn app_handle() -> &'static AppHandle {
    APP_HANDLE.get().expect("App handle not initialized")
}

pub(crate) struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    #[allow(dead_code)]
    pub(crate) channel_id: String,
    pub(crate) task_id: String,
    pub(crate) agent_id: String,
    #[allow(dead_code)]
    pub(crate) is_shell: bool,
    pub(crate) scrollback: Vec<u8>,
    pub(crate) exit_code: Option<i32>,
    _read_thread: Option<std::thread::JoinHandle<()>>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", content = "data")]
enum PtyOutput {
    Data(String), // base64-encoded
    Exit {
        exit_code: Option<i32>,
        signal: Option<String>,
        last_output: Vec<String>,
    },
}

#[derive(serde::Deserialize)]
pub struct SpawnArgs {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "agentId")]
    agent_id: String,
    command: Option<String>,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
    #[serde(rename = "isShell")]
    is_shell: Option<bool>,
    #[serde(rename = "onOutput")]
    on_output: ChannelRef,
}

#[derive(serde::Deserialize)]
struct ChannelRef {
    #[serde(rename = "__CHANNEL_ID__")]
    channel_id: String,
}

/// Verify that a command exists and is executable.
fn validate_command(command: &str) -> Result<(), String> {
    if command.is_empty() {
        return Err("Command must not be empty.".to_string());
    }

    // Reject shell metacharacters
    if command.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')' | '{' | '}' | '\n')) {
        return Err(format!("Command contains disallowed characters: {command}"));
    }

    // Absolute paths: check directly
    if command.starts_with('/') {
        if std::fs::metadata(command).is_ok() {
            return Ok(());
        }
        return Err(format!(
            "Command '{command}' not found or not executable. Check that it is installed."
        ));
    }

    // Bare names: resolve via which
    match which::which(command) {
        Ok(_) => Ok(()),
        Err(_) => Err(format!(
            "Command '{command}' not found in PATH. Make sure it is installed and available in your terminal."
        )),
    }
}

#[tauri::command]
pub async fn spawn_agent(args: SpawnArgs) -> Result<(), String> {
    let channel_id = args.on_output.channel_id.clone();
    let command = args.command.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    });
    let cwd = args.cwd.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    });
    let cols = args.cols.unwrap_or(80);
    let rows = args.rows.unwrap_or(24);
    let is_shell = args.is_shell.unwrap_or(false);

    validate_command(&command)?;

    // Kill existing session with same agentId to prevent PTY leaks
    {
        let mut sessions = sessions().lock().unwrap();
        sessions.remove(&args.agent_id);
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&command);
    for arg in &args.args {
        cmd.arg(arg);
    }
    cmd.cwd(&cwd);

    // Set up environment
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Apply safe env overrides (block dangerous vars)
    let blocked = [
        "PATH", "HOME", "USER", "SHELL", "LD_PRELOAD", "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE",
    ];
    if let Some(ref env) = args.env {
        for (k, v) in env {
            if !blocked.contains(&k.as_str()) {
                cmd.env(k, v);
            }
        }
    }

    // Clear vars that prevent nested agent sessions
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE_SESSION");
    cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let master = pair.master;

    let agent_id = args.agent_id.clone();
    let task_id = args.task_id.clone();
    let channel_id_clone = channel_id.clone();
    let agent_id_clone = agent_id.clone();

    // Spawn reader thread for PTY output batching
    let read_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 32 * 1024];
        let mut batch = Vec::new();
        let mut tail_buf = Vec::new();
        let mut last_flush = Instant::now();

        let emit = |payload: &PtyOutput| {
            if let Some(handle) = APP_HANDLE.get() {
                let event_name = format!("channel:{channel_id_clone}");
                let _ = handle.emit(&event_name, payload);
            }
        };

        let flush = |batch: &mut Vec<u8>, sessions: &Arc<Mutex<HashMap<String, PtySession>>>| {
            if batch.is_empty() {
                return;
            }
            let encoded = BASE64.encode(&batch);
            emit(&PtyOutput::Data(encoded));

            // Update scrollback
            if let Ok(mut sessions) = sessions.lock() {
                if let Some(session) = sessions.get_mut(&agent_id_clone) {
                    session.scrollback.extend_from_slice(batch);
                    if session.scrollback.len() > SCROLLBACK_CAP {
                        let excess = session.scrollback.len() - SCROLLBACK_CAP;
                        session.scrollback.drain(..excess);
                    }
                }
            }

            batch.clear();
        };

        let sessions_ref = sessions();

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let chunk = &buf[..n];

                    // Maintain tail buffer for exit diagnostics
                    tail_buf.extend_from_slice(chunk);
                    if tail_buf.len() > TAIL_CAP {
                        let excess = tail_buf.len() - TAIL_CAP;
                        tail_buf.drain(..excess);
                    }

                    batch.extend_from_slice(chunk);

                    // Flush large batches immediately
                    if batch.len() >= BATCH_MAX {
                        flush(&mut batch, sessions_ref);
                        last_flush = Instant::now();
                        continue;
                    }

                    // Small read = likely interactive prompt, flush immediately
                    if n < SMALL_READ_THRESHOLD {
                        flush(&mut batch, sessions_ref);
                        last_flush = Instant::now();
                        continue;
                    }

                    // Otherwise flush on timer
                    if last_flush.elapsed() >= BATCH_INTERVAL {
                        flush(&mut batch, sessions_ref);
                        last_flush = Instant::now();
                    }
                }
                Err(_) => break, // PTY closed
            }
        }

        // Flush remaining data
        flush(&mut batch, sessions_ref);

        // Wait for child process to exit
        let status = child.wait();
        let (exit_code, signal) = match status {
            Ok(status) => {
                let code = status.exit_code() as i32;
                // portable-pty doesn't expose signal info directly
                (Some(code), None)
            }
            Err(_) => (None, None),
        };

        // Parse tail buffer into last N lines for exit diagnostics
        let tail_str = String::from_utf8_lossy(&tail_buf);
        let lines: Vec<String> = tail_str
            .split('\n')
            .map(|l| l.trim_end_matches('\r').to_string())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .take(MAX_LINES)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        emit(&PtyOutput::Exit {
            exit_code,
            signal,
            last_output: lines,
        });

        // Clean up session
        if let Ok(mut sessions) = sessions().lock() {
            sessions.remove(&agent_id_clone);
        }
    });

    // Store session
    let session = PtySession {
        writer,
        master,
        channel_id,
        task_id,
        agent_id: agent_id.clone(),
        is_shell,
        scrollback: Vec::new(),
        exit_code: None,
        _read_thread: Some(read_thread),
    };

    {
        let mut sessions = sessions().lock().unwrap();
        sessions.insert(agent_id, session);
    }

    Ok(())
}

#[tauri::command]
pub fn write_to_agent(agent_id: String, data: String) -> Result<(), String> {
    let mut sessions = sessions().lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or_else(|| format!("Agent not found: {agent_id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Flush failed: {e}"))
}

#[tauri::command]
pub fn resize_agent(agent_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let mut sessions = sessions().lock().unwrap();
    let session = sessions
        .get_mut(&agent_id)
        .ok_or_else(|| format!("Agent not found: {agent_id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {e}"))
}

#[tauri::command]
pub fn pause_agent(agent_id: String) -> Result<(), String> {
    // portable-pty doesn't support pause/resume directly
    log::warn!("pause_agent called for {agent_id} — not supported with portable-pty");
    Ok(())
}

#[tauri::command]
pub fn resume_agent(agent_id: String) -> Result<(), String> {
    log::warn!("resume_agent called for {agent_id} — not supported with portable-pty");
    Ok(())
}

#[tauri::command]
pub fn kill_agent(agent_id: String) -> Result<(), String> {
    let mut sessions = sessions().lock().unwrap();
    if sessions.remove(&agent_id).is_some() {
        // Dropping the session drops the writer, which signals EOF to the PTY.
        // The read thread will detect EOF and clean up.
        log::info!("Killed agent {agent_id}");
    }
    Ok(())
}

#[tauri::command]
pub fn count_running_agents() -> usize {
    sessions().lock().unwrap().len()
}

#[tauri::command]
pub fn kill_all_agents() {
    kill_all_agents_sync();
}

pub fn kill_all_agents_sync() {
    let mut sessions = sessions().lock().unwrap();
    let count = sessions.len();
    sessions.clear();
    if count > 0 {
        log::info!("Killed all {count} agents");
    }
}

#[derive(Serialize)]
pub struct AgentInfo {
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "isShell")]
    is_shell: bool,
}

#[tauri::command]
pub fn list_agents() -> Vec<AgentInfo> {
    let sessions = sessions().lock().unwrap();
    sessions
        .values()
        .map(|s| AgentInfo {
            agent_id: s.agent_id.clone(),
            task_id: s.task_id.clone(),
            is_shell: s.is_shell,
        })
        .collect()
}

/// Get scrollback buffer for an agent as base64. Used by remote access.
pub fn get_agent_scrollback(agent_id: &str) -> Option<String> {
    let sessions = sessions().lock().unwrap();
    sessions
        .get(agent_id)
        .map(|s| BASE64.encode(&s.scrollback))
}

/// Get all active agent IDs.
pub fn get_active_agent_ids() -> Vec<String> {
    sessions().lock().unwrap().keys().cloned().collect()
}

// --- Internal helpers for remote access ---

/// Write data to an agent's PTY without going through Tauri command layer.
pub(crate) fn write_to_agent_internal(agent_id: &str, data: &str) -> Result<(), String> {
    let mut sessions = sessions().lock().unwrap();
    let session = sessions.get_mut(agent_id).ok_or("Agent not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

/// Resize an agent's PTY without going through Tauri command layer.
pub(crate) fn resize_agent_internal(agent_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = sessions().lock().unwrap();
    let session = sessions.get(agent_id).ok_or("Agent not found")?;
    session
        .master
        .resize(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Get raw scrollback bytes for an agent.
pub(crate) fn get_scrollback(agent_id: &str) -> Option<Vec<u8>> {
    let sessions = sessions().lock().unwrap();
    sessions.get(agent_id).map(|s| s.scrollback.clone())
}

/// Kill an agent without going through Tauri command layer.
pub(crate) fn kill_agent_internal(agent_id: &str) {
    let mut sessions = sessions().lock().unwrap();
    sessions.remove(agent_id);
    // Dropping the session kills the PTY
}
