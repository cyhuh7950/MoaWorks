const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    center: true,
    webPreferences: {
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));
  win.maximize();
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
