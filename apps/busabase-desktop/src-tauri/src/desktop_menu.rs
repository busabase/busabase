use serde::Serialize;
use tauri::{
    menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    },
    AppHandle, Emitter, Wry,
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMenuPayload {
    pub action: &'static str,
}

#[derive(Clone, Copy)]
struct DesktopMenuAction {
    id: &'static str,
    label: &'static str,
}

const DESKTOP_MENU_EVENT: &str = "busabase://desktop-menu-action";
const CHECK_FOR_UPDATES: DesktopMenuAction = DesktopMenuAction {
    id: "check_for_updates",
    label: "Check for Updates...",
};

pub fn build_desktop_menu(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let package_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(format_desktop_version(
            &package_info.version.to_string(),
            option_env!("BUSABASE_DESKTOP_BUILD_TIME"),
        )),
        short_version: about_short_version_without_build_number(cfg!(target_os = "macos")),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let check_for_updates = custom_item(app, CHECK_FOR_UPDATES)?;

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &check_for_updates,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::separator(app)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, Some(about_metadata.clone()))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                package_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app)?,
                    &check_for_updates,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            #[cfg(not(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            )))]
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &PredefinedMenuItem::close_window(app, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn emit_desktop_menu_action(app: &AppHandle<Wry>, id: &str) {
    if let Some(action) = desktop_menu_action(id) {
        let _ = app.emit(DESKTOP_MENU_EVENT, DesktopMenuPayload { action });
    }
}

fn custom_item(app: &AppHandle<Wry>, action: DesktopMenuAction) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, action.id, action.label, true, None::<&str>)
}

fn desktop_menu_action(id: &str) -> Option<&'static str> {
    (id == CHECK_FOR_UPDATES.id).then_some(CHECK_FOR_UPDATES.id)
}

fn format_desktop_version(version: &str, build_time: Option<&str>) -> String {
    let (base_version, version_build_time) = version.split_once('+').unwrap_or((version, ""));
    let is_build_time =
        |value: &&str| value.len() == 12 && value.bytes().all(|byte| byte.is_ascii_digit());
    let displayed_build_time = build_time
        .map(str::trim)
        .filter(is_build_time)
        .or_else(|| Some(version_build_time).filter(is_build_time));
    match displayed_build_time {
        Some(value) => format!("{base_version}({value})"),
        _ => base_version.to_string(),
    }
}

fn about_short_version_without_build_number(is_macos: bool) -> Option<String> {
    // AppKit needs an explicit empty value to avoid its CFBundleVersion fallback.
    // Windows/Linux need None because muda appends non-empty short versions.
    is_macos.then(String::new)
}

#[cfg(test)]
mod tests {
    use super::{
        about_short_version_without_build_number, desktop_menu_action, format_desktop_version,
        CHECK_FOR_UPDATES,
    };

    #[test]
    fn maps_only_the_supported_custom_menu_action() {
        assert_eq!(
            desktop_menu_action(CHECK_FOR_UPDATES.id),
            Some("check_for_updates")
        );
        assert_eq!(desktop_menu_action("about"), None);
    }

    #[test]
    fn formats_semver_with_build_time() {
        assert_eq!(
            format_desktop_version("0.9.12", Some("202607230810")),
            "0.9.12(202607230810)"
        );
        assert_eq!(
            format_desktop_version("0.9.12+202607230810", None),
            "0.9.12(202607230810)"
        );
        assert_eq!(
            format_desktop_version("0.9.12+202607230810", Some("202607230810")),
            "0.9.12(202607230810)"
        );
    }

    #[test]
    fn falls_back_to_semver_for_invalid_build_time() {
        assert_eq!(format_desktop_version("0.9.12", Some("local")), "0.9.12");
        assert_eq!(format_desktop_version("0.9.12", None), "0.9.12");
    }

    #[test]
    fn hides_the_native_build_number_on_every_platform() {
        assert_eq!(
            about_short_version_without_build_number(true),
            Some(String::new())
        );
        assert_eq!(about_short_version_without_build_number(false), None);
    }
}
