"use strict";

const path = require("node:path");

// Electron's app.setLoginItemSettings() is a no-op on Linux, so launch-at-login
// is an XDG autostart entry (honoured by DDE on UOS, UKUI on Kylin, GNOME, KDE).

const getAutostartPath = (env, homeDir, appId) => {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config");
  return path.join(configHome, "autostart", `${appId}.desktop`);
};

/** Quote an Exec argument per the Desktop Entry spec. */
const quoteExecArg = (value) => {
  if (!/[\s"'\\$`]/.test(value)) return value;
  return `"${value.replace(/(["`$\\])/g, "\\$1")}"`;
};

const buildAutostartEntry = ({ execPath, productName }) =>
  [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${productName}`,
    `Exec=${quoteExecArg(execPath)} --autostart`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");

module.exports = { buildAutostartEntry, getAutostartPath, quoteExecArg };
