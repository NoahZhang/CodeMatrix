use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;

static AGENT_CACHE: Mutex<Option<(Vec<AgentDef>, Instant)>> = Mutex::new(None);
const AGENT_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Serialize, Clone)]
pub struct AgentDef {
    id: String,
    name: String,
    command: String,
    args: Vec<String>,
    resume_args: Vec<String>,
    skip_permissions_args: Vec<String>,
    description: String,
    available: bool,
}

fn check_available(command: &str) -> bool {
    which::which(command).is_ok()
}

fn builtin_agents() -> Vec<AgentDef> {
    vec![
        AgentDef {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            args: vec![],
            resume_args: vec!["--resume".to_string()],
            skip_permissions_args: vec!["--dangerously-skip-permissions".to_string()],
            description: "Anthropic's Claude Code CLI".to_string(),
            available: check_available("claude"),
        },
        AgentDef {
            id: "codex".to_string(),
            name: "Codex".to_string(),
            command: "codex".to_string(),
            args: vec![],
            resume_args: vec![],
            skip_permissions_args: vec!["--full-auto".to_string()],
            description: "OpenAI's Codex CLI".to_string(),
            available: check_available("codex"),
        },
        AgentDef {
            id: "gemini".to_string(),
            name: "Gemini CLI".to_string(),
            command: "gemini".to_string(),
            args: vec![],
            resume_args: vec![],
            skip_permissions_args: vec!["-s".to_string()],
            description: "Google's Gemini CLI".to_string(),
            available: check_available("gemini"),
        },
        AgentDef {
            id: "aider".to_string(),
            name: "Aider".to_string(),
            command: "aider".to_string(),
            args: vec![],
            resume_args: vec![],
            skip_permissions_args: vec!["--yes-always".to_string()],
            description: "AI pair programming in your terminal".to_string(),
            available: check_available("aider"),
        },
        AgentDef {
            id: "amp".to_string(),
            name: "Amp".to_string(),
            command: "amp".to_string(),
            args: vec![],
            resume_args: vec![],
            skip_permissions_args: vec![],
            description: "Sourcegraph's Amp CLI".to_string(),
            available: check_available("amp"),
        },
    ]
}

#[tauri::command]
pub fn list_agents_cmd() -> Vec<AgentDef> {
    log::info!("[list_agents_cmd] called");
    // Check cache first
    {
        let cache = AGENT_CACHE.lock().unwrap();
        if let Some((agents, ts)) = cache.as_ref() {
            if ts.elapsed() < AGENT_CACHE_TTL {
                return agents.clone();
            }
        }
    }

    let agents = builtin_agents();

    // Update cache
    {
        let mut cache = AGENT_CACHE.lock().unwrap();
        *cache = Some((agents.clone(), Instant::now()));
    }

    agents
}
