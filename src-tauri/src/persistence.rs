use std::fs;
use std::path::PathBuf;

fn app_data_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "Could not determine app data directory".to_string())?
        .join("com.code-matrix.app");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
    Ok(dir)
}

fn state_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("state.json"))
}

fn arena_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("arena.json"))
}

#[tauri::command]
pub fn save_app_state(json: String) -> Result<(), String> {
    let path = state_path()?;

    // Atomic write: write to temp file then rename
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write state: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename state file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn load_app_state() -> Result<Option<String>, String> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read state: {e}"))?;
    Ok(Some(content))
}

#[tauri::command]
pub fn save_arena_data(json: String) -> Result<(), String> {
    let path = arena_path()?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write arena data: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename arena file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_arena_data() -> Result<Option<String>, String> {
    let path = arena_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read arena data: {e}"))?;
    Ok(Some(content))
}
