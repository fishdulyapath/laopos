const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { registerDeviceBridge } = require('./deviceBridge.cjs');
const { registerCustomerDisplayBridge, closeCustomerDisplay } = require('./customerDisplayBridge.cjs');
const { registerAutoUpdater } = require('./autoUpdater.cjs');

const isDev = !!process.env.ELECTRON_START_URL;
let mainWindow = null;
const desktopIconPath = path.join(__dirname, '..', 'public', 'santipab.png');

function embeddedUpdateToken() {
  try {
    return String(require('./embeddedUpdateToken.generated.cjs')?.githubToken || '').trim();
  } catch {
    return '';
  }
}

function cleanUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function userDesktopConfigPath() {
  return path.join(app.getPath('userData'), 'bizsuit-desktop.config.json');
}

function readJsonConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Cannot read desktop config ${filePath}:`, error.message);
    return {};
  }
}

function desktopConfig() {
  const candidates = [
    path.join(process.cwd(), 'bizsuit-desktop.config.json'),
    path.join(path.dirname(process.execPath), 'bizsuit-desktop.config.json'),
    userDesktopConfigPath(),
  ];
  const fileConfig = candidates.reduce((merged, filePath) => ({ ...merged, ...readJsonConfig(filePath) }), {});
  const apiBaseUrl = cleanUrl(process.env.BIZSUIT_API_BASE_URL || fileConfig.apiBaseUrl || fileConfig.api_base_url || 'http://192.168.1.249:8092/service/v1');
  return {
    apiBaseUrl,
    devices: fileConfig.devices || {},
  };
}

function updateConfig() {
  return { githubToken: embeddedUpdateToken() };
}

function writeUserDesktopConfig(patch = {}) {
  const filePath = userDesktopConfigPath();
  const current = readJsonConfig(filePath);
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

registerDeviceBridge(desktopConfig);

ipcMain.handle('bizsuit:desktop:get-config', () => desktopConfig());
ipcMain.handle('bizsuit:desktop:set-api-base-url', (_event, value) => {
  const apiBaseUrl = cleanUrl(value);
  if (!apiBaseUrl) throw new Error('API base URL is required');
  writeUserDesktopConfig({ apiBaseUrl });
  return desktopConfig();
});

function createWindow() {
  const config = desktopConfig();
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    icon: desktopIconPath,
    title: 'santiparbpos',
    backgroundColor: '#f8fafc',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--bizsuit-api-base-url=${config.apiBaseUrl}`],
    },
  });
  mainWindow = win;

  win.on('close', () => {
    closeCustomerDisplay();
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerCustomerDisplayBridge(() => mainWindow, desktopConfig);
  createWindow();
  registerAutoUpdater(() => mainWindow, updateConfig);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeCustomerDisplay();
});
