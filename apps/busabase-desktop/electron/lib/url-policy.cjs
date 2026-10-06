"use strict";

// Navigation / window.open policy for the Electron shell.
//
// The main window loads the local sidecar directly (no iframe). Anything that
// stays on the sidecar origin is internal. `window.open()` popups are allowed
// for about:blank and same-origin URLs because the Busabase web app relies on
// real popups for OAuth (Cloud Connect opens `about:blank`, then navigates it
// to the Cloud authorize URL; the callback page calls `window.close()`). Every
// other http(s) URL goes to the OS browser, and non-http schemes are refused.

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isHttp = (url) => url.protocol === "http:" || url.protocol === "https:";

/** Loopback aliases the sidecar can be reached on; treated as one origin. */
const isSidecarUrl = (url, port) =>
  url.protocol === "http:" &&
  (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
  url.port === String(port);

/** @returns {"internal" | "external" | "deny"} */
const classifyNavigation = (rawUrl, port) => {
  const url = parseUrl(rawUrl);
  if (!url) return "deny";
  if (isSidecarUrl(url, port)) return "internal";
  if (url.protocol === "file:" || url.protocol === "about:") return "internal";
  if (isHttp(url)) return "external";
  return "deny";
};

/** @returns {"popup" | "external" | "deny"} */
const classifyWindowOpen = (rawUrl, port) => {
  if (rawUrl === "" || rawUrl === "about:blank") return "popup";
  const url = parseUrl(rawUrl);
  if (!url) return "deny";
  if (isSidecarUrl(url, port)) return "popup";
  if (isHttp(url)) return "external";
  return "deny";
};

/** Only http(s) URLs may be handed to the OS (mirrors getExternalHttpUrl in src/lib/sidecar.ts). */
const toExternalHttpUrl = (rawUrl) => {
  const url = parseUrl(rawUrl);
  if (!url || !isHttp(url)) return null;
  return url.toString();
};

module.exports = {
  classifyNavigation,
  classifyWindowOpen,
  isSidecarUrl,
  toExternalHttpUrl,
};
