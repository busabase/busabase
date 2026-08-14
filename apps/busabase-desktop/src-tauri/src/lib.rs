use std::{
    fs::{self, OpenOptions},
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

mod desktop_menu;

const BUSABASE_PORT: u16 = 15419;
const SIDECAR_START_TIMEOUT: Duration = Duration::from_secs(60);
const SIDECAR_LOG_FILE: &str = "sidecar.log";
const SIDECAR_LOG_SUMMARY_CHARS: usize = 2000;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static BUSABASE_SIDECAR_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn current_desktop_build_time(current: &Version) -> u64 {
    current
        .build
        .as_str()
        .parse::<u64>()
        .ok()
        .or_else(|| {
            option_env!("BUSABASE_DESKTOP_BUILD_TIME").and_then(|value| value.parse::<u64>().ok())
        })
        .or_else(|| {
            option_env!("CARGO_PKG_VERSION_BUILD").and_then(|value| value.parse::<u64>().ok())
        })
        .unwrap_or(0)
}

fn should_update_version(current: &Version, remote: &Version) -> bool {
    if remote.major != current.major
        || remote.minor != current.minor
        || remote.patch != current.patch
        || remote.pre != current.pre
    {
        return remote > current;
    }

    let remote_build_time = remote.build.as_str().parse::<u64>().unwrap_or(0);
    remote_build_time > current_desktop_build_time(current)
}

fn should_update_busabase_desktop(current: Version, release: RemoteRelease) -> bool {
    should_update_version(&current, &release.version)
}

#[cfg(test)]
mod updater_tests {
    use super::should_update_version;
    use semver::Version;

    fn version(value: &str) -> Version {
        Version::parse(value).expect("test version must be valid semver")
    }

    #[test]
    fn compares_build_time_for_the_same_semver() {
        let current = version("0.9.14+202607231530");

        assert!(!should_update_version(
            &current,
            &version("0.9.14+202607231530")
        ));
        assert!(should_update_version(
            &current,
            &version("0.9.14+202607231531")
        ));
        assert!(!should_update_version(
            &current,
            &version("0.9.14+202607231529")
        ));
    }

    #[test]
    fn compares_semver_before_build_time() {
        let current = version("0.9.14+202607231530");

        assert!(should_update_version(
            &current,
            &version("0.9.15+202607220000")
        ));
        assert!(!should_update_version(
            &current,
            &version("0.9.13+202607240000")
        ));
    }
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

    if is_busabase_port_open() {
        return build_status(
            &app,
            Some(format!(
                "Port {BUSABASE_PORT} is already in use, but it is not serving Busabase. Close the process using that port, then retry."
            )),
        );
    }

    let data_dir = busabase_data_dir(&app)?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    let log_path = data_dir.join(SIDECAR_LOG_FILE);
    let log = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&log_path)
        .map_err(|error| {
            format!(
                "Could not create sidecar log at {}: {error}",
                log_path.display()
            )
        })?;
    let mut command = build_sidecar_command(&app, &data_dir, log)?;

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start Busabase sidecar: {error}"))?;
    {
        let mut guard = sidecar_process()
            .lock()
            .map_err(|error| error.to_string())?;
        *guard = Some(child);
    }

    let error = wait_for_sidecar(&data_dir, SIDECAR_START_TIMEOUT).err();
    if error.is_some() {
        let _ = stop_busabase_sidecar_process();
    }
    build_status(&app, error)
}

#[tauri::command]
fn stop_busabase_sidecar(app: AppHandle) -> Result<BusabaseSidecarStatus, String> {
    stop_busabase_sidecar_process()?;
    build_status(&app, None)
}

fn stop_busabase_sidecar_process() -> Result<(), String> {
    let mut guard = sidecar_process()
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
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
    launcher: Option<String>,
}

struct BundledSidecarCommand {
    executable: PathBuf,
    args: Vec<PathBuf>,
    current_dir: Option<PathBuf>,
}

/// Locate the packaged standalone sidecar (apps/busabase `output: "standalone"`
/// build + bundled node) inside the app's resource directory. Windows launches
/// through the bundled `.cmd` wrapper, matching Buda Desktop; other platforms
/// execute Node directly. In `tauri dev` without a prepared bundle this returns
/// `None` and the caller falls back to the workspace dev server.
fn resolve_bundled_sidecar(app: &AppHandle) -> Option<BundledSidecarCommand> {
    let resource_dir = app.path().resource_dir().ok()?;
    let root = resource_dir.join("busabase-server");
    let entry: SidecarEntry =
        serde_json::from_str(&fs::read_to_string(root.join("entry.json")).ok()?).ok()?;

    let server = root.join(&entry.server);
    let node = root.join(&entry.node);
    if server.exists() && node.exists() {
        let app_dir = server.parent()?.to_path_buf();
        let server_arg = server.strip_prefix(&app_dir).ok()?.to_path_buf();
        if cfg!(windows) {
            let launcher = root.join(entry.launcher?);
            return launcher.is_file().then_some(BundledSidecarCommand {
                executable: launcher,
                args: vec![],
                current_dir: None,
            });
        }

        Some(BundledSidecarCommand {
            executable: node,
            args: vec![server_arg],
            current_dir: Some(app_dir),
        })
    } else {
        None
    }
}

/// Build the command that runs the Busabase sidecar on `BUSABASE_PORT`.
///
/// Production: launches the bundled standalone `node server.js`. Dev fallback:
/// `pnpm --filter busabase dev` from the workspace root. Both receive a local
/// pglite database and local filesystem storage rooted under the app data dir.
fn build_sidecar_command(
    app: &AppHandle,
    data_dir: &Path,
    log: fs::File,
) -> Result<Command, String> {
    let pg_dir = data_dir.join("pgdata");
    let storage_dir = data_dir.join("storage");
    fs::create_dir_all(&pg_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&storage_dir).map_err(|error| error.to_string())?;

    let pg_url = format!("pglite://{}", pg_dir.to_string_lossy());
    let storage_url = format!(
        "local:{}?base_url=/api/storage&upload_url=/api/storage/upload",
        storage_dir.to_string_lossy()
    );

    let mut command = if let Some(sidecar) = resolve_bundled_sidecar(app) {
        let mut command = Command::new(sidecar.executable);
        command.args(sidecar.args);
        if let Some(current_dir) = sidecar.current_dir {
            command.current_dir(current_dir);
        }
        command
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
        .stdout(Stdio::from(log.try_clone().map_err(|error| {
            format!("Could not clone sidecar log handle: {error}")
        })?))
        .stderr(Stdio::from(log));
    hide_child_console_window(&mut command);

    Ok(command)
}

fn hide_child_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn wait_for_sidecar(data_dir: &Path, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_busabase_healthy() {
            return Ok(());
        }

        let exit_status = {
            let mut guard = sidecar_process()
                .lock()
                .map_err(|error| error.to_string())?;
            let status = guard
                .as_mut()
                .map(|child| child.try_wait())
                .transpose()
                .map_err(|error| error.to_string())?
                .flatten();
            if status.is_some() {
                *guard = None;
            }
            status
        };
        if let Some(status) = exit_status {
            return Err(sidecar_start_error(
                &format!("exited with {status}"),
                data_dir,
            ));
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err(sidecar_start_error(
        &format!(
            "did not become healthy within {} seconds",
            timeout.as_secs()
        ),
        data_dir,
    ))
}

fn sidecar_start_error(reason: &str, data_dir: &Path) -> String {
    let log_path = data_dir.join(SIDECAR_LOG_FILE);
    let summary = fs::read_to_string(&log_path)
        .ok()
        .map(|contents| tail_chars(contents.trim(), SIDECAR_LOG_SUMMARY_CHARS))
        .filter(|contents| !contents.is_empty());
    match summary {
        Some(summary) => format!(
            "Busabase sidecar {reason}. Last log output: {summary} (full log: {})",
            log_path.display()
        ),
        None => format!(
            "Busabase sidecar {reason}. No output was captured; see {}.",
            log_path.display()
        ),
    }
}

fn tail_chars(value: &str, limit: usize) -> String {
    let count = value.chars().count();
    value.chars().skip(count.saturating_sub(limit)).collect()
}

#[cfg(test)]
mod sidecar_tests {
    use super::tail_chars;

    #[test]
    fn keeps_the_end_of_sidecar_logs_on_character_boundaries() {
        assert_eq!(tail_chars("startup failed", 6), "failed");
        assert_eq!(tail_chars("错误: port busy", 9), "port busy");
        assert_eq!(tail_chars("short", 20), "short");
    }
}

fn is_busabase_port_open() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{BUSABASE_PORT}")
            .parse()
            .expect("Busabase loopback address must be valid"),
        Duration::from_millis(300),
    )
    .is_ok()
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

/// Bring the main window back to the foreground.
///
/// Both entry points below need this: a deep link can arrive while the window
/// is minimized (OAuth in the OS browser) or while a second launch is being
/// folded into this instance.
fn focus_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .menu(desktop_menu::build_desktop_menu)
        .on_menu_event(|app, event| {
            desktop_menu::emit_desktop_menu_action(app, event.id().as_ref());
        })
        // MUST be the first plugin registered (upstream requirement). Without it
        // a `busabase://` deep link on Linux/Windows starts a *second* copy of
        // the app instead of reaching the running one — the sidecar port would
        // already be taken and the user would see a broken duplicate window.
        // The `deep-link` feature makes it forward the URL to the plugin below.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
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
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;

            // Windows/Linux use the custom titlebar rendered by the frontend.
            // Removing native decorations also removes the duplicate File/Edit
            // menu row while macOS keeps its native application menu.
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }

            // Packaged installs get the `busabase://` association from the
            // bundle manifest (Info.plist / .desktop / registry). A dev run or
            // a plain `cargo run` has no bundle, so register at runtime —
            // supported on Linux and Windows only.
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("[busabase-desktop] Could not register busabase:// scheme: {error}");
            }

            // The JS side (`src/app/page.tsx`) reads the URL and refreshes the
            // embedded app; the window raise has to happen natively.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |_event| {
                focus_main_window(&handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            busabase_sidecar_status,
            request_desktop_restart,
            start_busabase_sidecar,
            stop_busabase_sidecar
        ])
        .build(tauri::generate_context!())
        .expect("error while building Busabase Desktop");

    app.run(|_app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = stop_busabase_sidecar_process();
        }
    });
}
