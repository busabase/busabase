use std::{
    collections::HashSet,
    env,
    ffi::{OsStr, OsString},
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[cfg(not(windows))]
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Copy)]
struct AdapterSpec {
    slug: &'static str,
    package: &'static str,
    version: &'static str,
    integrity: &'static str,
    bin: &'static str,
    tarball: &'static str,
}

const CODEX: AdapterSpec = AdapterSpec {
    slug: "codex-acp", package: "@agentclientprotocol/codex-acp", version: "1.1.14",
    integrity: "sha512-6JKLbGYH0/Gcz788U6KnljwSdNvUnXOyjJDOgsWsbwmXbxn/BXH+urF5AciACdgq13+KgAP9O96Kp6h33BgyKg==",
    bin: "codex-acp", tarball: "https://registry.npmjs.org/@agentclientprotocol/codex-acp/-/codex-acp-1.1.14.tgz",
};
const CLAUDE: AdapterSpec = AdapterSpec {
    slug: "claude-acp", package: "@agentclientprotocol/claude-agent-acp", version: "0.66.0",
    integrity: "sha512-BwalxKsxZzHZGEs+X9hV3biErLE7PHWoao2hmyP3QBWXxvMHbc1F1tzDE95ZA47Fle+KBYf2gKpgy1MJ+ZmVlw==",
    bin: "claude-agent-acp", tarball: "https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/claude-agent-acp-0.66.0.tgz",
};
fn adapter_spec(slug: &str) -> Result<AdapterSpec, String> {
    match slug {
        "codex-acp" => Ok(CODEX),
        "claude-acp" => Ok(CLAUDE),
        _ => Err("Unsupported Desktop agent.".into()),
    }
}
static INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static DISCOVERY_PATH: OnceLock<Option<String>> = OnceLock::new();
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Deserialize)]
struct Entry {
    node: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentDependencyStatus {
    pub source: &'static str,
    pub installed: bool,
    pub codex: &'static str,
    pub system_path: Option<String>,
    pub codex_path: Option<String>,
    pub auth: &'static str,
}

fn main_window_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("ACP dependencies may only be managed by the main window.".into());
    }
    Ok(())
}

pub(crate) fn bundled_root(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().resource_dir().ok()?.join("busabase-server");
    let entry: Entry = serde_json::from_slice(&fs::read(root.join("entry.json")).ok()?).ok()?;
    let node = root.join(entry.node);
    (node.is_file() && root.join("npm/bin/npm-cli.js").is_file()).then_some(root)
}

fn managed_home(app: &AppHandle, spec: AdapterSpec) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("agent-runtimes").join(spec.slug))
        .map_err(|e| e.to_string())
}

pub(crate) fn managed_home_for(app: &AppHandle, slug: &str) -> Result<PathBuf, String> {
    managed_home(app, adapter_spec(slug)?)
}

fn node_path(root: &Path) -> PathBuf {
    root.join(if cfg!(windows) { "node.exe" } else { "node" })
}

fn adapter_path(home: &Path, spec: AdapterSpec) -> PathBuf {
    home.join("node_modules")
        .join("@agentclientprotocol")
        .join(spec.package.rsplit('/').next().unwrap_or_default())
}

fn claude_native_package() -> Option<String> {
    let platform = match env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        "linux" => "linux",
        _ => return None,
    };
    let arch = match env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => return None,
    };
    let libc = if platform == "linux" && cfg!(target_env = "musl") {
        "-musl"
    } else {
        ""
    };
    Some(format!(
        "@anthropic-ai/claude-agent-sdk-{platform}-{arch}{libc}"
    ))
}

fn claude_native_path(home: &Path) -> Option<PathBuf> {
    let package = claude_native_package()?;
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let root = home.join("node_modules");
    let preferred = root.join(&package).join(format!("claude{suffix}"));
    if preferred.is_file() {
        return Some(preferred);
    }
    if cfg!(target_os = "linux") {
        let fallback = if package.ends_with("-musl") {
            package.trim_end_matches("-musl").to_owned()
        } else {
            format!("{package}-musl")
        };
        let path = root.join(fallback).join(format!("claude{suffix}"));
        return path.is_file().then_some(path);
    }
    None
}

fn valid_claude_native_lockfile(value: &serde_json::Value, home: &Path) -> bool {
    let Some(path) = claude_native_path(home) else {
        return false;
    };
    let Some(package) = path
        .parent()
        .and_then(|dir| dir.file_name())
        .and_then(|name| name.to_str())
        .map(|name| format!("@anthropic-ai/{name}"))
    else {
        return false;
    };
    let name = package.rsplit('/').next().unwrap_or_default();
    let key = format!("node_modules/{package}");
    value["packages"].as_object().is_some_and(|packages| {
        packages.iter().any(|(path, entry)| {
            (path == &key || path.ends_with(&format!("/{key}")))
                && entry["version"] == "0.3.220"
                && entry["resolved"]
                    == format!("https://registry.npmjs.org/{package}/-/{name}-0.3.220.tgz")
                && entry["integrity"]
                    .as_str()
                    .is_some_and(|hash| hash.starts_with("sha512-") && hash.len() > 50)
        })
    })
}

fn valid_claude_sdk_lockfile(value: &serde_json::Value) -> bool {
    let key = "node_modules/@anthropic-ai/claude-agent-sdk";
    value["packages"].as_object().is_some_and(|packages| packages.iter().any(|(path, entry)| {
        (path == key || path.ends_with(&format!("/{key}")))
            && entry["version"] == "0.3.220"
            && entry["resolved"] == "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.220.tgz"
            && entry["integrity"].as_str().is_some_and(|hash| hash.starts_with("sha512-") && hash.len() > 50)
    }))
}

fn installed(home: &Path, spec: AdapterSpec) -> bool {
    let adapter = adapter_path(home, spec);
    let manifest = fs::read(adapter.join("package.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    manifest.as_ref().is_some_and(|m| {
        m["name"] == spec.package
            && m["version"] == spec.version
            && m["bin"][spec.bin]
                .as_str()
                .is_some_and(|bin| bin == "dist/index.js" && adapter.join(bin).is_file())
            && (spec.slug != CLAUDE.slug || claude_native_path(home).is_some())
    })
}

fn verified_lockfile(home: &Path, spec: AdapterSpec) -> bool {
    let lock = fs::read(home.join("package-lock.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    lock.as_ref().is_some_and(|value| {
        valid_lockfile(value, spec)
            && (spec.slug != CLAUDE.slug
                || (valid_claude_sdk_lockfile(value) && valid_claude_native_lockfile(value, home)))
    })
}

fn valid_lockfile(value: &serde_json::Value, spec: AdapterSpec) -> bool {
    value["packages"].as_object().is_some_and(|packages| {
        packages.iter().any(|(key, entry)| {
            (key == &format!("node_modules/{}", spec.package)
                || key.ends_with(&format!("/node_modules/{}", spec.package)))
                && entry["version"] == spec.version
                && entry["integrity"] == spec.integrity
                && entry["resolved"] == spec.tarball
        })
    })
}

fn stamp_path(home: &Path) -> PathBuf {
    home.join("verified-install.json")
}

fn entry_hash(home: &Path, spec: AdapterSpec) -> Option<String> {
    let bytes = fs::read(adapter_path(home, spec).join("dist/index.js")).ok()?;
    Some(format!("{:x}", Sha256::digest(bytes)))
}

fn stamped(home: &Path, spec: AdapterSpec) -> bool {
    fs::read(stamp_path(home))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .is_some_and(|value| {
            value["package"] == spec.package
                && value["version"] == spec.version
                && value["integrity"] == spec.integrity
                && entry_hash(home, spec).is_some_and(|hash| value["entrySha256"] == hash)
                && (spec.slug != CLAUDE.slug
                    || claude_native_path(home).is_some_and(|path| {
                        fs::read(path).ok().is_some_and(|bytes| {
                            value["nativeSha256"] == format!("{:x}", Sha256::digest(bytes))
                        })
                    }))
        })
}

fn valid_install(home: &Path, spec: AdapterSpec) -> bool {
    installed(home, spec) && verified_lockfile(home, spec) && stamped(home, spec)
}

fn login_shell_path() -> Option<String> {
    #[cfg(windows)]
    {
        None
    }
    #[cfg(not(windows))]
    {
        let default_shell = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/sh"
        };
        let shell = env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_shell.into());
        ["-ilc", "-lc"]
            .iter()
            .find_map(|mode| probe_shell_path(&shell, mode, SHELL_PATH_TIMEOUT))
    }
}

#[cfg(not(windows))]
fn probe_shell_path(shell: &str, mode: &str, timeout: Duration) -> Option<String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let start_marker = format!("__BUSABASE_PATH_{nonce}_START__");
    let end_marker = format!("__BUSABASE_PATH_{nonce}_END__");
    let script = format!("printf '{start_marker}%s{end_marker}' \"$PATH\"");
    let output_path = env::temp_dir().join(format!(
        "busabase-shell-path-{}-{nonce}.txt",
        std::process::id()
    ));
    let output_file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&output_path)
        .ok()?;
    let mut command = Command::new(shell);
    command
        .args([mode, &script])
        .env("DISABLE_AUTO_UPDATE", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::from(output_file))
        .stderr(Stdio::null());
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        command.current_dir(home);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            let _ = fs::remove_file(&output_path);
            return None;
        }
    };
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&output_path);
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&output_path);
                return None;
            }
        }
    }
    let output = fs::read_to_string(&output_path).ok();
    let _ = fs::remove_file(output_path);
    extract_probed_path(output.as_deref()?, &start_marker, &end_marker).map(str::to_owned)
}

fn extract_probed_path<'a>(
    output: &'a str,
    start_marker: &str,
    end_marker: &str,
) -> Option<&'a str> {
    let start = output.rfind(start_marker)? + start_marker.len();
    let end = output[start..].find(end_marker)? + start;
    let path = &output[start..end];
    (!path.trim().is_empty()).then_some(path)
}

fn fallback_tool_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        dirs.extend([
            home.join(".local/bin"),
            home.join(".codex/packages/standalone/current/bin"),
            home.join(".codex/packages/standalone/current"),
            home.join(".bun/bin"),
            home.join(".cargo/bin"),
            home.join(".deno/bin"),
            home.join(".volta/bin"),
            home.join(".asdf/shims"),
            home.join(".local/share/mise/shims"),
            home.join(".pyenv/shims"),
        ]);
        #[cfg(target_os = "macos")]
        dirs.push(home.join("Library/pnpm"));
        #[cfg(target_os = "linux")]
        dirs.extend([
            home.join(".nix-profile/bin"),
            home.join(".local/share/pnpm"),
        ]);
    }
    #[cfg(target_os = "macos")]
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    #[cfg(target_os = "linux")]
    dirs.extend([
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/snap/bin"),
        PathBuf::from("/nix/var/nix/profiles/default/bin"),
    ]);
    #[cfg(windows)]
    {
        if let Some(app_data) = env::var_os("APPDATA") {
            dirs.push(PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            dirs.push(local_app_data.join("Programs/OpenAI/Codex/bin"));
            dirs.push(local_app_data.join("Microsoft/WindowsApps"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(program_files).join("nodejs"));
        }
    }
    dirs
}

fn merged_discovery_path(
    login_path: Option<&str>,
    process_path: Option<&OsStr>,
    home: Option<&Path>,
) -> Option<String> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    let mut push = |path: PathBuf| {
        if seen.insert(path.clone()) {
            paths.push(path);
        }
    };

    if let Some(path) = login_path {
        for entry in env::split_paths(path) {
            push(entry);
        }
    }
    if let Some(path) = process_path {
        for entry in env::split_paths(path) {
            push(entry);
        }
    }
    for entry in fallback_tool_dirs(home) {
        push(entry);
    }

    (!paths.is_empty())
        .then(|| env::join_paths(paths).ok())
        .flatten()
        .map(|path| path.to_string_lossy().into_owned())
}

fn discovery_path() -> Option<String> {
    DISCOVERY_PATH
        .get_or_init(|| {
            let login = login_shell_path();
            let process_path: Option<OsString> = env::var_os("PATH");
            let home =
                env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
            merged_discovery_path(login.as_deref(), process_path.as_deref(), home.as_deref())
        })
        .clone()
}

fn resolved_system_path() -> Option<String> {
    let path = discovery_path()?;
    ["node", if cfg!(windows) { "npx.cmd" } else { "npx" }]
        .iter()
        .all(|bin| command_succeeds(bin, &["--version"], &path))
        .then_some(path)
}

pub(crate) fn system_path() -> Option<String> {
    resolved_system_path()
}

pub(crate) fn user_path() -> Option<String> {
    discovery_path()
}

pub(crate) fn cli_path() -> Option<String> {
    let path = discovery_path()?;
    resolve_codex(&path).map(|bin| bin.to_string_lossy().into_owned())
}

fn command_succeeds(bin: &str, args: &[&str], path: &str) -> bool {
    let mut command = executable_command(bin);
    command
        .args(args)
        .env("PATH", path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().is_ok_and(|output| output.status.success())
}

fn executable_command(bin: &str) -> Command {
    #[cfg(windows)]
    if bin.to_ascii_lowercase().ends_with(".cmd") || bin.to_ascii_lowercase().ends_with(".bat") {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/d", "/s", "/c", bin]);
        return cmd;
    }
    Command::new(bin)
}

fn child_path(root: &Path) -> Result<std::ffi::OsString, String> {
    let existing: Vec<_> = env::split_paths(&env::var_os("PATH").unwrap_or_default()).collect();
    env::join_paths(std::iter::once(root.to_path_buf()).chain(existing)).map_err(|e| e.to_string())
}

fn find_codex(path: &str) -> Option<PathBuf> {
    let names = executable_names("codex", cfg!(windows), env::var_os("PATHEXT").as_deref());
    env::split_paths(path).find_map(|dir| {
        names.iter().find_map(|name| {
            let candidate = dir.join(name);
            (candidate.is_file()
                && command_succeeds(candidate.to_string_lossy().as_ref(), &["--version"], path))
            .then_some(candidate)
        })
    })
}

fn resolve_codex(path: &str) -> Option<PathBuf> {
    env::var_os("BUSABASE_DESKTOP_CODEX_CLI")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|candidate| {
            candidate.is_file()
                && command_succeeds(candidate.to_string_lossy().as_ref(), &["--version"], path)
        })
        .or_else(|| find_codex(path))
}

fn executable_names(base: &str, windows: bool, path_ext: Option<&OsStr>) -> Vec<OsString> {
    if !windows {
        return vec![base.into()];
    }
    path_ext
        .and_then(OsStr::to_str)
        .unwrap_or(".COM;.EXE;.BAT;.CMD")
        .split(';')
        .filter(|extension| !extension.is_empty())
        .map(|extension| format!("{base}{extension}").into())
        .collect()
}

fn codex_status(path: &str, cli: Option<&Path>) -> &'static str {
    let Some(bin) = cli else {
        return "missing";
    };
    if command_succeeds(bin.to_string_lossy().as_ref(), &["login", "status"], path) {
        "ready"
    } else {
        "login_required"
    }
}

#[tauri::command]
pub(crate) fn agent_dependency_status(
    app: AppHandle,
    window: WebviewWindow,
    slug: String,
) -> Result<AgentDependencyStatus, String> {
    main_window_only(&window)?;
    let spec = adapter_spec(&slug)?;
    let home = managed_home(&app, spec)?;
    let system_path = resolved_system_path();
    let cli_path = discovery_path().unwrap_or_default();
    let codex_path = resolve_codex(&cli_path);
    let native = if spec.slug == CLAUDE.slug {
        claude_native_path(&home)
    } else {
        None
    };
    let auth = if spec.slug == CODEX.slug {
        codex_status(&cli_path, codex_path.as_deref())
    } else if system_path.is_none() && !valid_install(&home, spec) {
        "unknown"
    } else if let Some(binary) = native.as_ref() {
        if claude_logged_in(binary, &cli_path) {
            "ready"
        } else {
            "login_required"
        }
    } else if system_path.is_some() {
        "ready"
    } else {
        "unknown"
    };
    Ok(AgentDependencyStatus {
        source: if system_path.is_some() {
            "system"
        } else {
            "managed"
        },
        installed: system_path.is_some() || valid_install(&home, spec),
        codex: codex_status(&cli_path, codex_path.as_deref()),
        system_path,
        codex_path: codex_path.map(|path| path.to_string_lossy().into_owned()),
        auth,
    })
}

fn claude_logged_in(binary: &Path, path: &str) -> bool {
    let mut command = Command::new(binary);
    command
        .args(["auth", "status"])
        .env("PATH", path)
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .output()
        .ok()
        .filter(|result| result.status.success())
        .and_then(|result| serde_json::from_slice::<serde_json::Value>(&result.stdout).ok())
        .is_some_and(|result| result["loggedIn"] == true)
}

#[tauri::command]
pub(crate) async fn install_agent_adapter(
    app: AppHandle,
    window: WebviewWindow,
    slug: String,
) -> Result<AgentDependencyStatus, String> {
    main_window_only(&window)?;
    adapter_spec(&slug)?;
    tauri::async_runtime::spawn_blocking(move || install_agent_adapter_blocking(app, window, slug))
        .await
        .map_err(|e| e.to_string())?
}

fn install_agent_adapter_blocking(
    app: AppHandle,
    window: WebviewWindow,
    slug: String,
) -> Result<AgentDependencyStatus, String> {
    let spec = adapter_spec(&slug)?;
    let lock = INSTALL_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .try_lock()
        .map_err(|_| "An ACP installation is already running.")?;
    if resolved_system_path().is_some() {
        return agent_dependency_status(app, window, slug);
    }
    let root = bundled_root(&app).ok_or("Bundled Node and npm are unavailable.")?;
    let home = managed_home(&app, spec)?;
    if valid_install(&home, spec) {
        return agent_dependency_status(app, window, slug);
    }
    fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let staging = home.join("installing");
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let node = node_path(&root);
    let npm = root.join("npm/bin/npm-cli.js");
    let path = child_path(&root)?;
    let mut command = Command::new(&node);
    command
        .arg(npm)
        .args(["install", "--prefix"])
        .arg(&staging)
        .args([
            "--save-exact",
            "--package-lock",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--registry=https://registry.npmjs.org/",
        ])
        .arg(format!("{}@{}", spec.package, spec.version))
        .env("PATH", path)
        .env("npm_config_cache", home.join("cache"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not install ACP adapter: {e}"))?;
    let started = Instant::now();
    let result = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status.success();
        }
        if started.elapsed() > Duration::from_secs(120) {
            let _ = child.kill();
            let _ = child.wait();
            break false;
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    if !result || !installed(&staging, spec) || !verified_lockfile(&staging, spec) {
        let _ = fs::remove_dir_all(&staging);
        return Err("ACP download or package validation failed. Retry the installation.".into());
    }
    let current = home.join("node_modules");
    let previous = home.join("previous-node_modules");
    let old_lock = home.join("previous-package-lock.json");
    let old_stamp = home.join("previous-verified-install.json");
    if previous.exists() {
        fs::remove_dir_all(&previous).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_file(&old_lock);
    let _ = fs::remove_file(&old_stamp);
    if current.exists() {
        fs::rename(&current, &previous).map_err(|e| e.to_string())?;
    }
    if home.join("package-lock.json").exists() {
        fs::rename(home.join("package-lock.json"), &old_lock).map_err(|e| e.to_string())?;
    }
    if stamp_path(&home).exists() {
        fs::rename(stamp_path(&home), &old_stamp).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(staging.join("node_modules"), &current) {
        if previous.exists() {
            let _ = fs::rename(&previous, &current);
        }
        if old_lock.exists() {
            let _ = fs::rename(&old_lock, home.join("package-lock.json"));
        }
        if old_stamp.exists() {
            let _ = fs::rename(&old_stamp, stamp_path(&home));
        }
        return Err(error.to_string());
    }
    fs::rename(
        staging.join("package-lock.json"),
        home.join("package-lock.json"),
    )
    .map_err(|e| e.to_string())?;
    let hash = entry_hash(&home, spec).ok_or("Installed ACP entry is missing.")?;
    let native_hash = if spec.slug == CLAUDE.slug {
        claude_native_path(&home)
            .and_then(|path| fs::read(path).ok())
            .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
    } else {
        None
    };
    fs::write(stamp_path(&home), serde_json::json!({"package": spec.package, "version": spec.version, "integrity": spec.integrity, "entrySha256": hash, "nativeSha256": native_hash}).to_string()).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(previous);
    let _ = fs::remove_file(old_lock);
    let _ = fs::remove_file(old_stamp);
    let _ = fs::remove_dir_all(staging);
    agent_dependency_status(app, window, slug)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(windows))]
    #[test]
    fn discovery_path_includes_user_local_bin() {
        let home = PathBuf::from("/Users/test");
        let path = merged_discovery_path(Some("/usr/bin:/bin"), None, Some(&home)).unwrap();
        let entries: Vec<_> = env::split_paths(&path).collect();

        assert!(entries.contains(&PathBuf::from("/usr/bin")));
        assert!(entries.contains(&home.join(".local/bin")));
    }

    #[cfg(not(windows))]
    #[test]
    fn discovery_path_merges_and_deduplicates_sources() {
        let process_path = env::join_paths(["/bin", "/opt/bin"]).unwrap();
        let path =
            merged_discovery_path(Some("/usr/bin:/bin"), Some(process_path.as_os_str()), None)
                .unwrap();
        let entries: Vec<_> = env::split_paths(&path).collect();

        assert_eq!(
            &entries[..3],
            [
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
                PathBuf::from("/opt/bin")
            ]
        );
        assert_eq!(entries.iter().collect::<HashSet<_>>().len(), entries.len());
    }

    #[cfg(unix)]
    #[test]
    fn finds_codex_in_user_local_bin_with_a_minimal_gui_path() {
        use std::os::unix::fs::PermissionsExt;

        let home = env::temp_dir().join(format!("busabase-codex-path-test-{}", std::process::id()));
        let bin_dir = home.join(".local/bin");
        let codex = bin_dir.join("codex");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(&codex, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&codex, fs::Permissions::from_mode(0o755)).unwrap();
        let path = merged_discovery_path(Some("/usr/bin:/bin"), None, Some(&home)).unwrap();

        assert_eq!(find_codex(&path), Some(codex));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn shell_path_parser_ignores_profile_noise() {
        assert_eq!(
            extract_probed_path(
                "welcome\n__START__/usr/local/bin:/usr/bin__END__goodbye",
                "__START__",
                "__END__"
            ),
            Some("/usr/local/bin:/usr/bin")
        );
    }

    #[test]
    fn windows_executable_names_follow_pathext() {
        assert_eq!(
            executable_names("codex", true, Some(OsStr::new(".EXE;.CMD;.BAT"))),
            vec![
                OsString::from("codex.EXE"),
                OsString::from("codex.CMD"),
                OsString::from("codex.BAT")
            ]
        );
    }

    #[test]
    fn lockfile_requires_pinned_version_registry_and_integrity() {
        let valid = serde_json::json!({"packages": {
            "../../private/tmp/installing/node_modules/@agentclientprotocol/codex-acp": {
                "version": CODEX.version,
                "integrity": CODEX.integrity,
                "resolved": "https://registry.npmjs.org/@agentclientprotocol/codex-acp/-/codex-acp-1.1.14.tgz"
            }
        }});
        assert!(valid_lockfile(&valid, CODEX));
        let mut tampered = valid.clone();
        tampered["packages"]
            ["../../private/tmp/installing/node_modules/@agentclientprotocol/codex-acp"]
            ["integrity"] = "sha512-wrong".into();
        assert!(!valid_lockfile(&tampered, CODEX));
        let mut wrong_source = valid;
        wrong_source["packages"]
            ["../../private/tmp/installing/node_modules/@agentclientprotocol/codex-acp"]
            ["resolved"] = "https://example.com/adapter.tgz".into();
        assert!(!valid_lockfile(&wrong_source, CODEX));
        assert!(!valid_lockfile(&wrong_source, CLAUDE));
    }

    #[test]
    fn damaged_entry_invalidates_install_stamp() {
        let home = env::temp_dir().join(format!("busabase-codex-test-{}", std::process::id()));
        let adapter = adapter_path(&home, CODEX);
        fs::create_dir_all(adapter.join("dist")).unwrap();
        fs::write(adapter.join("dist/index.js"), "expected").unwrap();
        let hash = entry_hash(&home, CODEX).unwrap();
        fs::write(
            stamp_path(&home),
            serde_json::json!({
                "package": CODEX.package, "version": CODEX.version,
                "integrity": CODEX.integrity, "entrySha256": hash
            })
            .to_string(),
        )
        .unwrap();
        assert!(stamped(&home, CODEX));
        fs::write(adapter.join("dist/index.js"), "modified").unwrap();
        assert!(!stamped(&home, CODEX));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn claude_requires_native_binary_and_matching_stamp() {
        let home = env::temp_dir().join(format!("busabase-claude-test-{}", std::process::id()));
        let adapter = adapter_path(&home, CLAUDE);
        fs::create_dir_all(adapter.join("dist")).unwrap();
        fs::write(adapter.join("dist/index.js"), "adapter").unwrap();
        let native = home
            .join("node_modules")
            .join(claude_native_package().unwrap())
            .join(if cfg!(windows) {
                "claude.exe"
            } else {
                "claude"
            });
        assert!(claude_native_path(&home).is_none());
        fs::create_dir_all(native.parent().unwrap()).unwrap();
        fs::write(&native, "original").unwrap();
        let hash = entry_hash(&home, CLAUDE).unwrap();
        fs::write(
            stamp_path(&home),
            serde_json::json!({
                "package": CLAUDE.package, "version": CLAUDE.version,
                "integrity": CLAUDE.integrity, "entrySha256": hash,
                "nativeSha256": format!("{:x}", Sha256::digest(b"original"))
            })
            .to_string(),
        )
        .unwrap();
        assert!(stamped(&home, CLAUDE));
        fs::write(&native, "damaged").unwrap();
        assert!(!stamped(&home, CLAUDE));
        fs::remove_dir_all(home).unwrap();
    }
}
