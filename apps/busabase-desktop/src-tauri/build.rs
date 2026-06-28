fn main() {
    println!("cargo:rerun-if-env-changed=BUSABASE_DESKTOP_BUILD_NUMBER");
    if let Ok(build_number) = std::env::var("BUSABASE_DESKTOP_BUILD_NUMBER") {
        println!("cargo:rustc-env=BUSABASE_DESKTOP_BUILD_NUMBER={build_number}");
    }
    tauri_build::build()
}
