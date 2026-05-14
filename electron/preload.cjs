/**
 * Preload script — ponte segura entre a UI (renderer) e o processo principal.
 * Expõe um objeto `window.api` com promessas e listeners.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (parcial) => ipcRenderer.invoke("settings:save", parcial),

  // password
  savePassword: (plain) => ipcRenderer.invoke("password:save", plain),
  clearPassword: () => ipcRenderer.invoke("password:clear"),
  hasPassword: () => ipcRenderer.invoke("password:has"),

  // automation
  startAutomation: (input) => ipcRenderer.invoke("automation:start", input),
  cancelAutomation: () => ipcRenderer.invoke("automation:cancel"),
  automationStatus: () => ipcRenderer.invoke("automation:status"),

  onLog:   (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on("automation:log", handler);
    return () => ipcRenderer.removeListener("automation:log", handler);
  },
  onEvent: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on("automation:event", handler);
    return () => ipcRenderer.removeListener("automation:event", handler);
  },
  onDone:  (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on("automation:done", handler);
    return () => ipcRenderer.removeListener("automation:done", handler);
  },

  // spreadsheet
  openSpreadsheet:   (p) => ipcRenderer.invoke("spreadsheet:open", p),
  revealSpreadsheet: (p) => ipcRenderer.invoke("spreadsheet:reveal", p),
  pickSpreadsheet:   ()  => ipcRenderer.invoke("spreadsheet:pick"),

  /** Abre `%APPDATA%/…/Automatizador GIP/logs` no Explorer/Finder */
  openLogsFolder: () => ipcRenderer.invoke("logs:openFolder"),

  // updates
  checkUpdates: ()    => ipcRenderer.invoke("updates:check"),
  openReleases: (url) => ipcRenderer.invoke("updates:openReleases", url),
  onUpdateAvailable: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on("updates:available", handler);
    return () => ipcRenderer.removeListener("updates:available", handler);
  },

  // app info
  appInfo: () => ipcRenderer.invoke("app:info"),
});
