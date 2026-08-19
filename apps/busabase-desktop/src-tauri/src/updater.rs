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
