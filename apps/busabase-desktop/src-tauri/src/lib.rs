mod desktop_menu;
mod platform;
mod sidecar;
mod updater;

use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

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
        // The single-instance plugin must be first so deep links reach the
        // running process instead of starting a second sidecar host.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_updater::Builder::new()
                .default_version_comparator(updater::should_update_busabase_desktop)
                .build(),
        )
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }

            #[cfg(any(target_os = "linux", target_os = "windows"))]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("[busabase-desktop] Could not register busabase:// scheme: {error}");
            }

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |_event| {
                focus_main_window(&handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::busabase_sidecar_status,
            platform::request_desktop_restart,
            sidecar::start_busabase_sidecar,
            sidecar::stop_busabase_sidecar
        ])
        .build(tauri::generate_context!())
        .expect("error while building Busabase Desktop");

    app.run(|_app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = sidecar::stop_busabase_sidecar_process();
        }
    });
}
