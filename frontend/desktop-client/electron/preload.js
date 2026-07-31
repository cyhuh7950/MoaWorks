const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moaworksDesktop", Object.freeze({
  getAppInfo: () => ipcRenderer.invoke("desktop:get-app-info"),
  login: (credentials) => ipcRenderer.invoke("desktop:login", credentials),
  logout: () => ipcRenderer.invoke("desktop:logout"),
  request: (request) => ipcRenderer.invoke("desktop:api-request", request),
  saveArchive: (request) => ipcRenderer.invoke("desktop:archive-save", request),
  showArchive: () => ipcRenderer.invoke("desktop:archive-show"),
}));
