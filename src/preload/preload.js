const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("skylandAPI", {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  notifyRendererReady: () => ipcRenderer.send("app:renderer-ready"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  saveProfile: (profile) => ipcRenderer.invoke("profile:save", profile),
  saveSession: (session) => ipcRenderer.invoke("session:save", session),
  clearSession: () => ipcRenderer.invoke("session:clear"),
  markAnnouncementSeen: (announcementId) => ipcRenderer.invoke("announcements:mark-seen", announcementId),
  getVersions: () => ipcRenderer.invoke("launcher:get-versions"),
  searchMods: (payload) => ipcRenderer.invoke("mods:search", payload),
  installMod: (payload) => ipcRenderer.invoke("mods:install", payload),
  listInstalledMods: (payload) => ipcRenderer.invoke("mods:list-installed", payload),
  removeInstalledMod: (payload) => ipcRenderer.invoke("mods:remove-installed", payload),
  clearInstalledMods: (payload) => ipcRenderer.invoke("mods:clear-installed", payload),
  launchGame: (payload) => ipcRenderer.invoke("launcher:launch", payload),
  chooseJavaPath: () => ipcRenderer.invoke("dialog:pick-java"),
  chooseGameDirectory: () => ipcRenderer.invoke("dialog:pick-game-dir"),
  openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
  onLauncherEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher:event", listener);
    return () => {
      ipcRenderer.removeListener("launcher:event", listener);
    };
  }
});
