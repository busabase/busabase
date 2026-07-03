const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

const PACKAGE_NAME = "@react-native-cookies/cookies";
const GRADLE_FILE = "android/build.gradle";

function resolveCookiesGradleFile(projectRoot) {
  const packageJson = require.resolve(`${PACKAGE_NAME}/package.json`, {
    paths: [projectRoot],
  });
  return path.join(path.dirname(packageJson), GRADLE_FILE);
}

function patchGradleRepositories(gradle) {
  return gradle.replaceAll("jcenter()", "mavenCentral()");
}

function withAndroidCookiesGradleRepositories(config) {
  return withDangerousMod(config, [
    "android",
    async (pluginConfig) => {
      let gradlePath;
      try {
        gradlePath = resolveCookiesGradleFile(pluginConfig.modRequest.projectRoot);
      } catch (error) {
        throw new Error(
          `Unable to locate ${PACKAGE_NAME} while applying Android Gradle repository patch: ${error.message}`,
        );
      }

      const original = fs.readFileSync(gradlePath, "utf8");
      const patched = patchGradleRepositories(original);

      if (patched !== original) {
        fs.writeFileSync(gradlePath, patched);
      }

      return pluginConfig;
    },
  ]);
}

module.exports = withAndroidCookiesGradleRepositories;
