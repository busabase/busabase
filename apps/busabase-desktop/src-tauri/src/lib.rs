use std::{
    fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::RemoteRelease;

use semver::Version;

const BUSABASE_PORT: u16 = 15419;

static BUSABASE_SIDECAR_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn current_desktop_build_number() -> u64 {
    option_env!("BUSABASE_DESKTOP_BUILD_NUMBER")
        .or(option_env!("CARGO_PKG_VERSION_BUILD"))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
}

fn should_update_busabase_desktop(current: Version, release: RemoteRelease) -> bool {
    if release.version.major != current.major
        || release.version.minor != current.minor
        || release.version.patch != current.patch
        || release.version.pre != current.pre
    {
        return release.version > current;
    }

    let remote_build = release.version.build.as_str().parse::<u64>().unwrap_or(0);
    remote_build > current_desktop_build_number()
}

fn sidecar_process() -> &'static Mutex<Option<Child>> {
    BUSABASE_SIDECAR_PROCESS.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BusabaseSidecarStatus {
    running: bool,
    healthy: bool,
    port: u16,
    pid: Option<u32>,
    local_url: String,
    api_url: String,
    data_dir: String,
    launch_mode: String,
    error: Option<String>,
}

#[tauri::command]
fn busabase_sidecar_status(app: AppHandle) -> Result<BusabaseSidecarStatus, String> {
    build_status(&app, None)
}

#[tauri::command]
fn start_busabase_sidecar(app: AppHandle) -> Result<BusabaseSidecarStatus, String> {
    {
        let mut guard = sidecar_process()
            .lock()
            .map_err(|error| error.to_string())?;
        if let Some(status) = running_child_status(&mut guard)? {
            return Ok(status_with_health(&app, Some(status), None));
        }
    }

    if is_busabase_healthy() {
        return build_status(&app, None);
    }

    let data_dir = busabase_data_dir(&app)?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    let mut command = build_sidecar_command(&app, &data_dir)?;

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start Busabase sidecar: {error}"))?;
    {
        let mut guard = sidecar_process()
            .lock()
            .map_err(|error| error.to_string())?;
        *guard = Some(child);
    }

    let started = wait_for_health(Duration::from_secs(60));
    let message = (!started).then(|| {
        "Busabase sidecar was started, but /api/health did not become ready within 60 seconds."
            .to_string()
    });
    build_status(&app, message)
}

#[tauri::command]
fn stop_busabase_sidecar(app: AppHandle) -> Result<BusabaseSidecarStatus, String> {
    let mut guard = sidecar_process()
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    drop(guard);
    build_status(&app, None)
}

#[tauri::command]
fn request_desktop_restart(app: AppHandle) -> Result<(), String> {
    app.request_restart();
    Ok(())
}

fn build_status(app: &AppHandle, error: Option<String>) -> Result<BusabaseSidecarStatus, String> {
    let data_dir = busabase_data_dir(app)?;
    let mut guard = sidecar_process()
        .lock()
        .map_err(|lock_error| lock_error.to_string())?;
    let managed = running_child_status(&mut guard)?;
    Ok(status_with_health(app, managed, error).with_data_dir(data_dir))
}

fn status_with_health(
    app: &AppHandle,
    managed: Option<BusabaseSidecarStatus>,
    error: Option<String>,
) -> BusabaseSidecarStatus {
    let data_dir = busabase_data_dir(app).unwrap_or_else(|_| PathBuf::from(""));
    let healthy = is_busabase_healthy();
    if let Some(mut status) = managed {
        status.healthy = healthy;
        status.running = status.running || healthy;
        status.launch_mode = if status.running {
            "managed".to_string()
        } else {
            "stopped".to_string()
        };
        status.error = error;
        return status.with_data_dir(data_dir);
    }

    BusabaseSidecarStatus {
        running: healthy,
        healthy,
        port: BUSABASE_PORT,
        pid: None,
        local_url: local_url(),
        api_url: api_url(),
        data_dir: data_dir.to_string_lossy().to_string(),
        launch_mode: if healthy { "external" } else { "stopped" }.to_string(),
        error,
    }
}

impl BusabaseSidecarStatus {
    fn with_data_dir(mut self, data_dir: PathBuf) -> Self {
        self.data_dir = data_dir.to_string_lossy().to_string();
        self
    }
}

fn running_child_status(
    guard: &mut Option<Child>,
) -> Result<Option<BusabaseSidecarStatus>, String> {
    if let Some(child) = guard.as_mut() {
        match child.try_wait().map_err(|error| error.to_string())? {
            None => {
                return Ok(Some(BusabaseSidecarStatus {
                    running: true,
                    healthy: false,
                    port: BUSABASE_PORT,
                    pid: Some(child.id()),
                    local_url: local_url(),
                    api_url: api_url(),
                    data_dir: String::new(),
                    launch_mode: "managed".to_string(),
                    error: None,
                }));
            }
            Some(_) => {
                *guard = None;
            }
        }
    }
    Ok(None)
}

fn local_url() -> String {
    // Next dev treats `localhost` as an allowed development origin by default.
    // The health probe below still uses 127.0.0.1 for a deterministic loopback
    // socket check, while the WebView loads localhost so the Busabase SPA can
    // hydrate and call /api/rpc during tauri dev.
    format!("http://localhost:{BUSABASE_PORT}")
}

fn api_url() -> String {
    format!("{}/api/v1", local_url())
}

/// Canonical Busabase data root, shared verbatim with `npx busabase server` and
/// the Docker image: `<root>/pgdata` holds the pglite database and
/// `<root>/storage` holds attachments. Defaulting to `~/.busabase/data` (instead
/// of the OS app-data dir) means the desktop app, the CLI, and a bind-mounted
/// container all read and write the same local database. Override the root with
/// the `BUSABASE_DATA_DIR` env var.
fn busabase_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("BUSABASE_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    app.path()
        .home_dir()
        .map(|dir| dir.join(".busabase").join("data"))
        .map_err(|error| error.to_string())
}

fn resolve_pnpm_executable() -> String {
    std::env::var("BUSABASE_DESKTOP_PNPM").unwrap_or_else(|_| "pnpm".to_string())
}

fn resolve_workspace_root() -> Result<PathBuf, String> {
    if let Ok(root) = std::env::var("BUSABASE_DESKTOP_WORKSPACE_ROOT") {
        let root = PathBuf::from(root);
        if root.join("pnpm-workspace.yaml").exists() {
            return Ok(root);
        }
    }

    let current = std::env::current_dir().map_err(|error| error.to_string())?;
    find_workspace_root(&current).ok_or_else(|| {
        "Could not find pnpm-workspace.yaml for Busabase sidecar startup.".to_string()
    })
}

fn find_workspace_root(start: &Path) -> Option<PathBuf> {
    let mut cursor = Some(start);
    while let Some(path) = cursor {
        if path.join("pnpm-workspace.yaml").exists() {
            return Some(path.to_path_buf());
        }
        cursor = path.parent();
    }
    None
}

#[derive(Deserialize)]
struct SidecarEntry {
    server: String,
    node: String,
}

/// Locate the packaged standalone sidecar (apps/busabase `output: "standalone"`
/// build + bundled node) inside the app's resource directory. Returns
/// `(node_executable, server_js, app_dir)` when present. This is the production
/// launch path; in `tauri dev` without a prepared bundle it returns `None` and
/// the caller falls back to the workspace dev server.
fn resolve_bundled_sidecar(app: &AppHandle) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let resource_dir = app.path().resource_dir().ok()?;
    let root = resource_dir.join("busabase-server");
    let entry: SidecarEntry =
        serde_json::from_str(&fs::read_to_string(root.join("entry.json")).ok()?).ok()?;

    let server = root.join(&entry.server);
    let node = root.join(&entry.node);
    if server.exists() && node.exists() {
        let app_dir = server.parent().map(Path::to_path_buf).unwrap_or(root);
        Some((node, server, app_dir))
    } else {
        None
    }
}

/// Build the command that runs the Busabase sidecar on `BUSABASE_PORT`.
///
/// Production: launches the bundled standalone `node server.js`. Dev fallback:
/// `pnpm --filter busabase dev` from the workspace root. Both receive a local
/// pglite database and local filesystem storage rooted under the app data dir.
fn build_sidecar_command(app: &AppHandle, data_dir: &Path) -> Result<Command, String> {
    let pg_dir = data_dir.join("pgdata");
    let storage_dir = data_dir.join("storage");
    fs::create_dir_all(&pg_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&storage_dir).map_err(|error| error.to_string())?;

    let pg_url = format!("pglite://{}", pg_dir.to_string_lossy());
    let storage_url = format!(
        "local:{}?base_url=/api/dev/attachment",
        storage_dir.to_string_lossy()
    );

    let mut command = if let Some((node, server, app_dir)) = resolve_bundled_sidecar(app) {
        let mut command = Command::new(node);
        command
            .arg(server)
            .current_dir(app_dir)
            .env("HOSTNAME", "127.0.0.1")
            .env("NODE_ENV", "production");
        command
    } else {
        let workspace_root = resolve_workspace_root()?;
        let mut command = Command::new(resolve_pnpm_executable());
        command
            .arg("--filter")
            .arg("busabase")
            .arg("dev")
            .current_dir(workspace_root);
        command
    };

    command
        .env("PORT", BUSABASE_PORT.to_string())
        .env("PG_DATABASE_URL", pg_url)
        .env("STORAGE_URL", storage_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    Ok(command)
}

fn wait_for_health(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_busabase_healthy() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn is_busabase_healthy() -> bool {
    let address = format!("127.0.0.1:{BUSABASE_PORT}");
    let Ok(mut addresses) = address.to_socket_addrs() else {
        return false;
    };
    let Some(address) = addresses.next() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{BUSABASE_PORT}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Launch-at-login support (opt-in via the in-app toggle). On macOS this
        // registers a per-user LaunchAgent; Windows uses the registry Run key and
        // Linux a `.desktop` autostart entry.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_updater::Builder::new()
                .default_version_comparator(should_update_busabase_desktop)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            busabase_sidecar_status,
            request_desktop_restart,
            start_busabase_sidecar,
            stop_busabase_sidecar
        ])
        .run(tauri::generate_context!())
        .expect("error while running Busabase Desktop");
}
