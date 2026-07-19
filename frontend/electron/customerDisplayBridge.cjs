const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');

let displayWindow = null;
let latestState = { mode: 'idle', items: [], totals: {}, displayLanguage: 'th', qr: null, updatedAt: null };
let mainWindowProvider = () => null;
let desktopConfigProvider = () => ({ apiBaseUrl: '' });
const desktopIconPath = path.join(__dirname, '..', 'public', 'applogo.png');

function customerDisplayUrl() {
  if (process.env.ELECTRON_START_URL) {
    return `${String(process.env.ELECTRON_START_URL).replace(/\/$/, '')}/#/customer-display`;
  }
  return null;
}

function displayBounds() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return (displays.find((display) => display.id !== primaryId) || displays[0]).bounds;
}

function sendDisplayState() {
  if (!displayWindow || displayWindow.isDestroyed()) return;
  displayWindow.webContents.send('bizsuit:customer-display:state', latestState);
}

function currentDisplayStatus(extra = {}) {
  return {
    open: !!displayWindow && !displayWindow.isDestroyed(),
    fullscreen: !!displayWindow && !displayWindow.isDestroyed() ? displayWindow.isFullScreen() : false,
    ...extra,
  };
}

function sendDisplayStatus(extra = {}) {
  const status = currentDisplayStatus(extra);
  const mainWindow = mainWindowProvider();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bizsuit:customer-display:status', status);
  }
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.webContents.send('bizsuit:customer-display:status', status);
  }
}

async function loadDisplayWindow(win) {
  const url = customerDisplayUrl();
  if (url) {
    await win.loadURL(url);
    return;
  }
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/customer-display' });
}

async function openCustomerDisplay() {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.show();
    displayWindow.focus();
    sendDisplayState();
    return { ok: true, alreadyOpen: true };
  }

  const config = desktopConfigProvider() || {};
  const bounds = displayBounds();
  displayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    icon: desktopIconPath,
    title: 'BizSuit Customer Display',
    backgroundColor: '#fff7ed',
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--bizsuit-display-window=1`, `--bizsuit-api-base-url=${config.apiBaseUrl || ''}`],
    },
  });

  displayWindow.once('ready-to-show', () => {
    if (!displayWindow || displayWindow.isDestroyed()) return;
    displayWindow.show();
    displayWindow.setFullScreen(true);
    sendDisplayState();
    sendDisplayStatus({ open: true, fullscreen: true });
  });

  displayWindow.on('enter-full-screen', () => sendDisplayStatus({ open: true, fullscreen: true }));
  displayWindow.on('leave-full-screen', () => sendDisplayStatus({ open: true, fullscreen: false }));

  displayWindow.on('closed', () => {
    displayWindow = null;
    sendDisplayStatus({ open: false, fullscreen: false });
  });

  try {
    await loadDisplayWindow(displayWindow);
  } catch (error) {
    const failedWindow = displayWindow;
    displayWindow = null;
    if (failedWindow && !failedWindow.isDestroyed()) failedWindow.destroy();
    sendDisplayStatus({ open: false, fullscreen: false, error: error.message || String(error) });
    throw error;
  }
  return { ok: true, alreadyOpen: false };
}

function closeCustomerDisplay() {
  if (displayWindow && !displayWindow.isDestroyed()) displayWindow.close();
  displayWindow = null;
  return { ok: true };
}

function registerCustomerDisplayBridge(getMainWindow, getDesktopConfig) {
  mainWindowProvider = getMainWindow || (() => null);
  desktopConfigProvider = getDesktopConfig || (() => ({ apiBaseUrl: '' }));

  ipcMain.handle('bizsuit:customer-display:open', () => openCustomerDisplay());
  ipcMain.handle('bizsuit:customer-display:close', () => closeCustomerDisplay());
  ipcMain.handle('bizsuit:customer-display:update', (_event, state = {}) => {
    latestState = { ...state, updatedAt: new Date().toISOString() };
    sendDisplayState();
    return { ok: true, open: !!displayWindow && !displayWindow.isDestroyed() };
  });
  ipcMain.handle('bizsuit:customer-display:clear', () => {
    const { ads = [], displayCurrency, displayLanguage = 'th', pos = '' } = latestState || {};
    latestState = {
      mode: 'idle',
      pos,
      ads,
      displayCurrency,
      displayLanguage,
      items: [],
      totals: {},
      qr: null,
      updatedAt: new Date().toISOString(),
    };
    sendDisplayState();
    return { ok: true };
  });
  ipcMain.handle('bizsuit:customer-display:get-state', () => latestState);
  ipcMain.handle('bizsuit:customer-display:status', () => currentDisplayStatus());
  ipcMain.handle('bizsuit:customer-display:set-fullscreen', (_event, fullscreen) => {
    const senderWindow = BrowserWindow.fromWebContents(_event.sender);
    const targetWindow = senderWindow === displayWindow ? senderWindow : displayWindow;
    if (!targetWindow || targetWindow.isDestroyed()) return currentDisplayStatus();
    targetWindow.setFullScreen(!!fullscreen);
    sendDisplayStatus({ open: true, fullscreen: !!fullscreen });
    return currentDisplayStatus({ open: true, fullscreen: !!fullscreen });
  });
  ipcMain.handle('bizsuit:customer-display:toggle-fullscreen', (_event) => {
    const senderWindow = BrowserWindow.fromWebContents(_event.sender);
    const targetWindow = senderWindow === displayWindow ? senderWindow : displayWindow;
    if (!targetWindow || targetWindow.isDestroyed()) return currentDisplayStatus();
    const fullscreen = !targetWindow.isFullScreen();
    targetWindow.setFullScreen(fullscreen);
    sendDisplayStatus({ open: true, fullscreen });
    return currentDisplayStatus({ open: true, fullscreen });
  });
}

module.exports = { registerCustomerDisplayBridge, closeCustomerDisplay };
