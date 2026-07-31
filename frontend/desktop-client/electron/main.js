const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createApiBroker } = require("./api-broker");
const { saveArchive } = require("./archive-service");

const apiBroker = createApiBroker();
let lastArchivePath = "";

function registerIpcHandlers() {
  ipcMain.handle("desktop:get-app-info", () => ({
    productName: "MoaWorks Desktop Client",
    version: app.getVersion(),
    environment: "production",
    authenticated: apiBroker.hasSession(),
  }));
  ipcMain.handle("desktop:login", (_event, credentials) => apiBroker.login(credentials));
  ipcMain.handle("desktop:logout", () => apiBroker.logout());
  ipcMain.handle("desktop:api-request", (_event, request) => apiBroker.request(request));
  ipcMain.handle("desktop:archive-save", async (_event, archiveRequest) => {
    const result = await saveArchive(archiveRequest, {
      showSaveDialog: (options) => dialog.showSaveDialog(options),
      writeFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    });
    if (result.saved) lastArchivePath = result.filePath;
    return result;
  });
  ipcMain.handle("desktop:archive-show", async () => {
    if (!lastArchivePath) return { shown: false };
    shell.showItemInFolder(lastArchivePath);
    return { shown: true, fileName: path.basename(lastArchivePath) };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, "..", "index.html"));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => apiBroker.clearSession());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
