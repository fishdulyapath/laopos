const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 15 * 1000;

let updateCheckTimer = null;
let checking = false;
let updateReady = false;
let updaterEnabled = false;
let ipcRegistered = false;
let currentStatus = {
  enabled: false,
  currentVersion: app.getVersion(),
  status: 'disabled',
  availableVersion: null,
  downloadedVersion: null,
  percent: 0,
  error: null,
  lastCheckedAt: null,
};

function logUpdate(message, detail = '') {
  const suffix = detail ? ` ${detail}` : '';
  console.log(`[auto-update] ${message}${suffix}`);
}

function publicStatus() {
  return { ...currentStatus, currentVersion: app.getVersion() };
}

function setStatus(patch = {}) {
  currentStatus = {
    ...currentStatus,
    currentVersion: app.getVersion(),
    ...patch,
  };
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('bizsuit:update:status', publicStatus());
  });
  return publicStatus();
}

function hasUpdateMetadataName(message) {
  return message.includes('latest.yml') || message.includes('latest-mac.yml') || message.includes('latest-linux.yml');
}

function isPendingUpdateMetadataError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (!hasUpdateMetadataName(message)) return false;
  return message.includes('cannot find') || message.includes('not found') || message.includes('404');
}

function isNoUpdateAvailableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (hasUpdateMetadataName(message)) return false;
  return (
    message.includes('no published versions') ||
    message.includes('cannot find latest') ||
    (message.includes('channel') && message.includes('not found'))
  );
}

function hidePendingUpdateMetadataError() {
  setStatus({ status: 'idle', availableVersion: null, downloadedVersion: null, percent: 0, error: null });
}
function normalizeGithubToken(token) {
  let value = String(token || '').trim();
  value = value.replace(/^['"]+|['"]+$/g, '').trim();
  value = value.replace(/^(token|bearer)\s+/i, '').trim();
  return value;
}

function githubAuthorizationHeader(token) {
  const value = normalizeGithubToken(token);
  if (!value) return '';
  return `token ${value}`;
}

function configurePrivateGithubAccess(getUpdateConfig) {
  const githubToken = normalizeGithubToken(getUpdateConfig?.()?.githubToken);
  const authHeader = githubAuthorizationHeader(githubToken);
  if (!authHeader) return false;
  process.env.GH_TOKEN = githubToken;
  process.env.GITHUB_TOKEN = githubToken;
  autoUpdater.addAuthHeader(authHeader);
  return true;
}
async function checkForUpdates() {
  if (!updaterEnabled) return publicStatus();
  if (checking || updateReady) return publicStatus();
  checking = true;
  setStatus({ status: 'checking', error: null, lastCheckedAt: new Date().toISOString() });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    logUpdate('check failed:', error?.message || String(error));
    if (isPendingUpdateMetadataError(error)) {
      logUpdate('update metadata is not ready yet');
      hidePendingUpdateMetadataError();
    } else if (isNoUpdateAvailableError(error)) {
      setStatus({ status: 'not-available', availableVersion: null, downloadedVersion: null, percent: 0, error: null });
    } else {
      setStatus({ status: 'error', error: error?.message || String(error) });
    }
  } finally {
    checking = false;
  }
  return publicStatus();
}

function installDownloadedUpdate() {
  if (!updateReady) return publicStatus();
  autoUpdater.quitAndInstall(false, true);
  return publicStatus();
}

function registerUpdateIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle('bizsuit:update:get-status', () => publicStatus());
  ipcMain.handle('bizsuit:update:check', () => checkForUpdates());
  ipcMain.handle('bizsuit:update:install', () => installDownloadedUpdate());
}

function registerAutoUpdater(getMainWindow, getUpdateConfig = () => ({})) {
  registerUpdateIpc();

  if (!app.isPackaged || process.platform !== 'win32' || process.env.LAOPOS_DISABLE_AUTO_UPDATE === '1' || process.env.BIZSUIT_DISABLE_AUTO_UPDATE === '1') {
    setStatus({
      enabled: false,
      status: 'disabled',
      error: !app.isPackaged ? 'Updates are available only in the installed Windows app.' : null,
    });
    logUpdate('disabled for this runtime');
    return;
  }

  updaterEnabled = true;
  setStatus({ enabled: true, status: 'idle', error: null });

  const privateGithubAccess = configurePrivateGithubAccess(getUpdateConfig);
  if (privateGithubAccess) logUpdate('private GitHub auth enabled');

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    logUpdate('checking');
    setStatus({ status: 'checking', error: null, lastCheckedAt: new Date().toISOString() });
  });
  autoUpdater.on('update-available', (info) => {
    logUpdate('available:', info?.version || 'unknown version');
    setStatus({ status: 'available', availableVersion: info?.version || null, percent: 0, error: null });
  });
  autoUpdater.on('update-not-available', (info) => {
    logUpdate('not available:', info?.version || 'unknown version');
    setStatus({ status: 'not-available', availableVersion: null, downloadedVersion: null, percent: 0, error: null });
  });
  autoUpdater.on('download-progress', (progress) => {
    logUpdate('download progress:', `${Math.round(progress?.percent || 0)}%`);
    setStatus({ status: 'downloading', percent: Math.round(progress?.percent || 0), error: null });
  });
  autoUpdater.on('error', (error) => {
    logUpdate('error:', error?.message || String(error));
    if (isPendingUpdateMetadataError(error)) {
      logUpdate('update metadata is not ready yet');
      hidePendingUpdateMetadataError();
    } else if (isNoUpdateAvailableError(error)) {
      setStatus({ status: 'not-available', availableVersion: null, downloadedVersion: null, percent: 0, error: null });
    } else {
      setStatus({ status: 'error', error: error?.message || String(error) });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    logUpdate('downloaded:', info?.version || 'unknown version');
    setStatus({
      status: 'downloaded',
      availableVersion: info?.version || currentStatus.availableVersion,
      downloadedVersion: info?.version || currentStatus.availableVersion,
      percent: 100,
      error: null,
    });
  });

  setTimeout(checkForUpdates, INITIAL_UPDATE_CHECK_DELAY_MS);
  updateCheckTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref?.();
}

module.exports = {
  registerAutoUpdater,
};
