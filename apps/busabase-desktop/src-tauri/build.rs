fn main() {
    const BUILD_TIME_PATH: &str = ".build-time";

    println!("cargo:rerun-if-changed={BUILD_TIME_PATH}");
    println!("cargo:rerun-if-env-changed=BUSABASE_DESKTOP_BUILD_NUMBER");

    if let Ok(build_time) = std::fs::read_to_string(BUILD_TIME_PATH) {
        let build_time = build_time.trim();
        if build_time.len() == 12 && build_time.bytes().all(|byte| byte.is_ascii_digit()) {
            println!("cargo:rustc-env=BUSABASE_DESKTOP_BUILD_TIME={build_time}");
        }
    }
    if let Ok(build_number) = std::env::var("BUSABASE_DESKTOP_BUILD_NUMBER") {
        println!("cargo:rustc-env=BUSABASE_DESKTOP_BUILD_NUMBER={build_number}");
    }
    tauri_build::build()
}
