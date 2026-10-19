use semver::Version;
use tauri_plugin_updater::RemoteRelease;

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

pub(crate) fn should_update_busabase_desktop(current: Version, release: RemoteRelease) -> bool {
    should_update_version(&current, &release.version)
}

#[cfg(test)]
mod updater_tests {
    use super::should_update_version;
    use semver::Version;
    use tauri_plugin_updater::RemoteRelease;

    #[test]
    fn unsigned_uos_metadata_does_not_break_signed_platform_updates() {
        let mut manifest = serde_json::json!({
            "version": "0.95.1",
            "platforms": {
                "linux-x86_64": {
                    "url": "https://s1.busabase.com/desktop.AppImage",
                    "signature": "signed-bundle"
                },
                "linux-x86_64-uos": {
                    "url": "https://s1.busabase.com/desktop.deb",
                    "signature": null
                }
            }
        });
        assert!(serde_json::from_value::<RemoteRelease>(manifest.clone()).is_err());
        manifest["platforms"]["linux-x86_64-uos"]["signature"] = serde_json::json!("");
        let release = serde_json::from_value::<RemoteRelease>(manifest).unwrap();
        assert_eq!(release.signature("linux-x86_64").unwrap(), "signed-bundle");
        assert_eq!(
            release.download_url("linux-x86_64").unwrap().path(),
            "/desktop.AppImage"
        );
    }

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
