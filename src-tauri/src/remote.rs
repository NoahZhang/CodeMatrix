// Remote access server — HTTP + WebSocket for phone/tablet terminals.
// Uses axum for HTTP and tokio-tungstenite for WebSocket connections.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, OnceLock};

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};
use base64::Engine;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAgent {
    #[serde(rename = "agentId")]
    pub agent_id: String,
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "taskName")]
    pub task_name: String,
    pub status: String,
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i32>,
    #[serde(rename = "lastLine")]
    pub last_line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum ServerMsg {
    #[serde(rename = "agents")]
    Agents { list: Vec<RemoteAgent> },
    #[serde(rename = "output")]
    Output {
        #[serde(rename = "agentId")]
        agent_id: String,
        data: String,
    },
    #[serde(rename = "status")]
    Status {
        #[serde(rename = "agentId")]
        agent_id: String,
        status: String,
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    #[serde(rename = "scrollback")]
    Scrollback {
        #[serde(rename = "agentId")]
        agent_id: String,
        data: String,
        cols: u16,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    #[serde(rename = "auth")]
    Auth { token: String },
    #[serde(rename = "input")]
    Input {
        #[serde(rename = "agentId")]
        agent_id: String,
        data: String,
    },
    #[serde(rename = "resize")]
    Resize {
        #[serde(rename = "agentId")]
        agent_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "subscribe")]
    Subscribe {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
    #[serde(rename = "unsubscribe")]
    Unsubscribe {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
    #[serde(rename = "kill")]
    Kill {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerResult {
    pub token: String,
    pub port: u16,
    pub url: String,
    #[serde(rename = "wifiUrl")]
    pub wifi_url: Option<String>,
    #[serde(rename = "tailscaleUrl")]
    pub tailscale_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub token: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "wifiUrl")]
    pub wifi_url: Option<String>,
    #[serde(rename = "tailscaleUrl")]
    pub tailscale_url: Option<String>,
    #[serde(rename = "connectedClients")]
    pub connected_clients: u32,
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

struct RemoteServer {
    token: String,
    port: u16,
    url: String,
    wifi_url: Option<String>,
    tailscale_url: Option<String>,
    shutdown_tx: broadcast::Sender<()>,
    connected_clients: Arc<std::sync::atomic::AtomicU32>,
}

static SERVER: OnceLock<Mutex<Option<RemoteServer>>> = OnceLock::new();

fn server_state() -> &'static Mutex<Option<RemoteServer>> {
    SERVER.get_or_init(|| Mutex::new(None))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn generate_token() -> String {
    let rng = SystemRandom::new();
    let mut bytes = [0u8; 24];
    rng.fill(&mut bytes).expect("failed to generate random token");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn timing_safe_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    // Constant-time comparison: XOR all bytes, accumulate differences
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn detect_network_ips() -> (Option<String>, Option<String>) {
    // Parse `ifconfig` output to find IPv4 addresses on network interfaces.
    let output = std::process::Command::new("ifconfig")
        .output()
        .ok();
    let stdout = output
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut wifi_ip: Option<String> = None;
    let mut tailscale_ip: Option<String> = None;

    for line in stdout.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("inet ") {
            let ip = rest.split_whitespace().next().unwrap_or("");
            if ip.starts_with("127.") || ip.is_empty() {
                continue;
            }
            if ip.starts_with("100.") {
                tailscale_ip.get_or_insert_with(|| ip.to_string());
            } else if !ip.starts_with("172.") {
                wifi_ip.get_or_insert_with(|| ip.to_string());
            }
        }
    }

    (wifi_ip, tailscale_ip)
}

fn detect_network_urls(port: u16, token: &str) -> (String, Option<String>, Option<String>) {
    let (wifi_ip, tailscale_ip) = detect_network_ips();

    let primary = wifi_ip.as_deref().or(tailscale_ip.as_deref()).unwrap_or("127.0.0.1");
    let url = format!("http://{}:{}?token={}", primary, port, token);
    let wifi_url = wifi_ip.map(|ip| format!("http://{}:{}?token={}", ip, port, token));
    let ts_url = tailscale_ip.map(|ip| format!("http://{}:{}?token={}", ip, port, token));

    (url, wifi_url, ts_url)
}

// ---------------------------------------------------------------------------
// Axum app state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AppState {
    token: String,
    connected_clients: Arc<std::sync::atomic::AtomicU32>,
    #[allow(dead_code)]
    shutdown_rx: broadcast::Sender<()>,
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async fn health() -> &'static str {
    "ok"
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

async fn api_agents(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(query): Query<TokenQuery>,
) -> impl IntoResponse {
    if !check_auth(&state.token, &headers, &query) {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "unauthorized"}))).into_response();
    }

    let agents = list_remote_agents();
    Json(agents).into_response()
}

async fn ws_upgrade(
    State(state): State<AppState>,
    Query(query): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let max_clients = 10u32;
    let current = state.connected_clients.load(std::sync::atomic::Ordering::Relaxed);
    if current >= max_clients {
        return (StatusCode::SERVICE_UNAVAILABLE, "Too many connections").into_response();
    }

    let pre_authed = query.token.as_deref().map_or(false, |t| timing_safe_eq(t, &state.token));

    ws.on_upgrade(move |socket| handle_ws(socket, state, pre_authed))
        .into_response()
}

fn check_auth(token: &str, headers: &axum::http::HeaderMap, query: &TokenQuery) -> bool {
    // Check Bearer token header
    if let Some(auth) = headers.get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth.to_str() {
            if let Some(bearer) = auth_str.strip_prefix("Bearer ") {
                return timing_safe_eq(bearer.trim(), token);
            }
        }
    }
    // Check query parameter
    if let Some(ref qt) = query.token {
        return timing_safe_eq(qt, token);
    }
    false
}

fn list_remote_agents() -> Vec<RemoteAgent> {
    let sessions = crate::pty::sessions();
    let guard = sessions.lock().unwrap();
    let mut seen_tasks: HashMap<String, RemoteAgent> = HashMap::new();

    for (agent_id, session) in guard.iter() {
        let entry = RemoteAgent {
            agent_id: agent_id.clone(),
            task_id: session.task_id.clone(),
            task_name: session.task_id.clone(), // task_id used as fallback name
            status: if session.exit_code.is_some() { "exited" } else { "running" }.to_string(),
            exit_code: session.exit_code,
            last_line: String::new(),
        };
        // Keep the main agent per task (first non-shell agent seen)
        if !session.is_shell {
            seen_tasks.entry(session.task_id.clone()).or_insert(entry);
        }
    }

    seen_tasks.into_values().collect()
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

async fn handle_ws(mut socket: WebSocket, state: AppState, pre_authed: bool) {
    state.connected_clients.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut authed = pre_authed;

    // Auth timeout if not pre-authenticated
    if !authed {
        let auth_timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(Ok(msg)) = socket.recv().await {
                if let Message::Text(text) = msg {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMsg>(&text) {
                        if let ClientMsg::Auth { token } = client_msg {
                            if timing_safe_eq(&token, &state.token) {
                                return true;
                            }
                        }
                    }
                }
                break;
            }
            false
        })
        .await;

        match auth_timeout {
            Ok(true) => authed = true,
            _ => {
                // Drop socket to close connection
                drop(socket);
                state.connected_clients.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                return;
            }
        }
    }

    if !authed {
        state.connected_clients.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        return;
    }

    // Send initial agent list
    let agents = list_remote_agents();
    let msg = ServerMsg::Agents { list: agents };
    if let Ok(json) = serde_json::to_string(&msg) {
        let _ = socket.send(Message::Text(json.into())).await;
    }

    // Message loop
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                let Ok(client_msg) = serde_json::from_str::<ClientMsg>(&text) else {
                    continue;
                };
                match client_msg {
                    ClientMsg::Auth { .. } => {
                        // Already authenticated
                    }
                    ClientMsg::Input { agent_id, data } => {
                        if data.len() <= 4096 {
                            let _ = crate::pty::write_to_agent_internal(&agent_id, &data);
                        }
                    }
                    ClientMsg::Resize {
                        agent_id,
                        cols,
                        rows,
                    } => {
                        if cols >= 1 && cols <= 500 && rows >= 1 && rows <= 500 {
                            let _ = crate::pty::resize_agent_internal(&agent_id, cols, rows);
                        }
                    }
                    ClientMsg::Subscribe { agent_id } => {
                        // Send scrollback
                        if let Some(scrollback) = crate::pty::get_scrollback(&agent_id) {
                            let data = base64::engine::general_purpose::STANDARD.encode(&scrollback);
                            let msg = ServerMsg::Scrollback {
                                agent_id,
                                data,
                                cols: 80,
                            };
                            if let Ok(json) = serde_json::to_string(&msg) {
                                let _ = socket.send(Message::Text(json.into())).await;
                            }
                        }
                    }
                    ClientMsg::Unsubscribe { .. } => {
                        // No-op for now
                    }
                    ClientMsg::Kill { agent_id } => {
                        crate::pty::kill_agent_internal(&agent_id);
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    state.connected_clients.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_remote_server(port: Option<u16>) -> Result<ServerResult, String> {
    // Stop any existing server first to avoid port conflicts (e.g. after hot-reload)
    {
        let mut guard = server_state().lock().unwrap();
        if let Some(server) = guard.take() {
            let _ = server.shutdown_tx.send(());
        }
    }

    let port = port.unwrap_or(7777);
    let token = generate_token();
    let (url, wifi_url, tailscale_url) = detect_network_urls(port, &token);
    let connected_clients = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let (shutdown_tx, _shutdown_rx) = broadcast::channel::<()>(1);

    let app_state = AppState {
        token: token.clone(),
        connected_clients: connected_clients.clone(),
        shutdown_rx: shutdown_tx.clone(),
    };

    // Locate the built remote UI (dist-remote/) relative to the executable.
    // In dev: <project>/src-tauri/target/debug/code-matrix → <project>/dist-remote/
    // In prod: bundled alongside the binary.
    let static_dir = {
        let exe = std::env::current_exe().unwrap_or_default();
        let mut dir = exe.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
        // Walk up until we find dist-remote/
        for _ in 0..6 {
            let candidate = dir.join("dist-remote");
            if candidate.is_dir() {
                break;
            }
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            } else {
                break;
            }
        }
        dir.join("dist-remote")
    };
    log::info!("[remote] Serving static files from {:?}", static_dir);

    let index_file = static_dir.join("index.html");
    let spa_fallback = ServeDir::new(&static_dir)
        .not_found_service(ServeFile::new(&index_file));

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/agents", get(api_agents))
        .route("/ws", get(ws_upgrade))
        .with_state(app_state)
        .fallback_service(spa_fallback);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    // Retry binding a few times — the old server may need a moment to release the port
    let listener = {
        let mut last_err = String::new();
        let mut bound = None;
        for _ in 0..10 {
            let socket = tokio::net::TcpSocket::new_v4()
                .map_err(|e| format!("Failed to create socket: {e}"))?;
            socket.set_reuseaddr(true).ok();
            #[cfg(target_os = "macos")]
            socket.set_reuseport(true).ok();
            match socket.bind(addr) {
                Ok(()) => match socket.listen(1024) {
                    Ok(l) => { bound = Some(l); break; }
                    Err(e) => last_err = format!("{e}"),
                },
                Err(e) => last_err = format!("{e}"),
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
        bound.ok_or_else(|| format!("Failed to bind to port {port}: {last_err}"))?
    };

    let mut shutdown_rx = shutdown_tx.subscribe();
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.recv().await;
            })
            .await
            .ok();
    });

    let result = ServerResult {
        token: token.clone(),
        port,
        url: url.clone(),
        wifi_url: wifi_url.clone(),
        tailscale_url: tailscale_url.clone(),
    };

    let mut guard = server_state().lock().unwrap();
    *guard = Some(RemoteServer {
        token,
        port,
        url,
        wifi_url,
        tailscale_url,
        shutdown_tx,
        connected_clients,
    });

    Ok(result)
}

#[tauri::command]
pub async fn stop_remote_server() -> Result<(), String> {
    let mut guard = server_state().lock().unwrap();
    if let Some(server) = guard.take() {
        let _ = server.shutdown_tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_remote_status() -> Result<RemoteStatus, String> {
    let guard = server_state().lock().unwrap();
    match guard.as_ref() {
        Some(server) => Ok(RemoteStatus {
            running: true,
            port: Some(server.port),
            token: Some(server.token.clone()),
            url: Some(server.url.clone()),
            wifi_url: server.wifi_url.clone(),
            tailscale_url: server.tailscale_url.clone(),
            connected_clients: server
                .connected_clients
                .load(std::sync::atomic::Ordering::Relaxed),
        }),
        None => Ok(RemoteStatus {
            running: false,
            port: None,
            token: None,
            url: None,
            wifi_url: None,
            tailscale_url: None,
            connected_clients: 0,
        }),
    }
}
