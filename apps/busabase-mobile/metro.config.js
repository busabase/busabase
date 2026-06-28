const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Keep a single React instance in the bundle: the hoisted root node_modules holds
// the web apps' react 19.2.x, while this Expo app is pinned to the version
// react-native requires (pnpm nests it under apps/<app>/node_modules). Force these
// modules to resolve from the app's own node_modules so the bundle never ends up
// with two React instances ("Invalid hook call" / renderer version mismatch).
const appLocalModules = ["react", "react-dom", "scheduler"];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (appLocalModules.some((name) => moduleName === name || moduleName.startsWith(`${name}/`))) {
    const appLocalPath = require.resolve(moduleName, { paths: [__dirname] });
    return context.resolveRequest(context, appLocalPath, platform);
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
