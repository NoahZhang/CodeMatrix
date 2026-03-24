use std::path::Path;

/// Assert that a string is a valid absolute path.
pub fn assert_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Path must not be empty".to_string());
    }
    if !Path::new(path).is_absolute() {
        return Err(format!("Path must be absolute: {path}"));
    }
    // Block path traversal
    if path.contains("..") {
        return Err(format!("Path must not contain '..': {path}"));
    }
    Ok(())
}

/// Assert that a string is non-empty.
pub fn assert_non_empty(value: &str, name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{name} must not be empty"));
    }
    Ok(())
}

/// Assert that a branch name is safe (no shell metacharacters).
pub fn assert_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Branch name must not be empty".to_string());
    }
    // Allow alphanumeric, hyphens, underscores, slashes, dots
    if name
        .chars()
        .any(|c| !c.is_alphanumeric() && !matches!(c, '-' | '_' | '/' | '.'))
    {
        return Err(format!(
            "Branch name contains invalid characters: {name}"
        ));
    }
    // Block dangerous patterns
    if name.starts_with('-') || name.contains("..") {
        return Err(format!("Branch name is not allowed: {name}"));
    }
    Ok(())
}

#[tauri::command]
pub fn check_path_exists(path: String) -> bool {
    Path::new(&path).exists()
}
