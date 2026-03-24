use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static WATCHERS: OnceLock<Arc<Mutex<HashMap<String, WatcherEntry>>>> = OnceLock::new();

struct WatcherEntry {
    _watcher: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}

pub fn init(handle: AppHandle) {
    APP_HANDLE.set(handle).ok();
    WATCHERS.set(Arc::new(Mutex::new(HashMap::new()))).ok();
}

fn watchers() -> &'static Arc<Mutex<HashMap<String, WatcherEntry>>> {
    WATCHERS.get().expect("Plan watchers not initialized")
}

#[tauri::command]
pub fn watch_plans(task_id: String, cwd: String) -> Result<(), String> {
    let plans_dir = PathBuf::from(&cwd).join(".plans");
    if !plans_dir.exists() {
        // No .plans directory — nothing to watch
        return Ok(());
    }

    let task_id_clone = task_id.clone();

    let debouncer = new_debouncer(Duration::from_millis(200), move |events: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
        if let Ok(events) = events {
            for event in events {
                if event.kind == DebouncedEventKind::Any {
                    let path = &event.path;
                    if path.extension().map_or(false, |ext| ext == "md" || ext == "txt" || ext == "plan") {
                        // Read the file and emit the content
                        if let Ok(content) = std::fs::read_to_string(path) {
                            let file_name = path
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();

                            if let Some(handle) = APP_HANDLE.get() {
                                let _ = handle.emit("plan_content", serde_json::json!({
                                    "taskId": task_id_clone,
                                    "fileName": file_name,
                                    "content": content,
                                }));
                            }
                        }
                    }
                }
            }
        }
    }).map_err(|e| format!("Failed to create plan watcher: {e}"))?;

    // Store the watcher
    let mut watchers = watchers().lock().unwrap();
    watchers.insert(task_id, WatcherEntry {
        _watcher: debouncer,
    });

    Ok(())
}

pub fn stop_all_watchers() {
    if let Some(watchers) = WATCHERS.get() {
        let mut watchers = watchers.lock().unwrap();
        watchers.clear();
    }
}
