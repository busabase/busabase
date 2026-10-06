"use strict";

// Exposes a single "retry" action to the local boot page. The main process
// ignores the message unless it comes from the file:// boot page, so the
// sidecar web app cannot use it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("busabaseBoot", {
  retry: () => ipcRenderer.send("busabase-boot:retry"),
});
