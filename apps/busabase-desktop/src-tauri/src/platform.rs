use tauri::AppHandle;

#[tauri::command]
pub(crate) fn request_desktop_restart(app: AppHandle) -> Result<(), String> {
    app.request_restart();
    Ok(())
}
