const { contextBridge, ipcRenderer } = require('electron');

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || '';
}

contextBridge.exposeInMainWorld('bizsuitDesktop', {
  platform: process.platform,
  apiBaseUrl: argValue('bizsuit-api-base-url'),
  isCustomerDisplayWindow: argValue('bizsuit-display-window') === '1',
  getConfig: () => ipcRenderer.invoke('bizsuit:desktop:get-config'),
  setApiBaseUrl: (apiBaseUrl) => ipcRenderer.invoke('bizsuit:desktop:set-api-base-url', apiBaseUrl),
  getUpdateStatus: () => ipcRenderer.invoke('bizsuit:update:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('bizsuit:update:check'),
  installUpdate: () => ipcRenderer.invoke('bizsuit:update:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback?.(status);
    ipcRenderer.on('bizsuit:update:status', listener);
    return () => ipcRenderer.removeListener('bizsuit:update:status', listener);
  },
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});

contextBridge.exposeInMainWorld('bizsuitDevices', {
  getConfig: () => ipcRenderer.invoke('bizsuit:devices:config'),
  listPrinters: () => ipcRenderer.invoke('bizsuit:devices:list-printers'),
  printUrl: (url, options = {}) => ipcRenderer.invoke('bizsuit:devices:print-url', { ...options, url }),
  printRawHex: (hex, options = {}) => ipcRenderer.invoke('bizsuit:devices:print-raw-hex', { ...options, hex }),
  openCashDrawer: (options = {}) => ipcRenderer.invoke('bizsuit:devices:open-cash-drawer', options),
  scanUsbCrDrawers: (options = {}) => ipcRenderer.invoke('bizsuit:devices:scan-usbcr-drawers', options),
});

contextBridge.exposeInMainWorld('bizsuitCustomerDisplay', {
  open: () => ipcRenderer.invoke('bizsuit:customer-display:open'),
  close: () => ipcRenderer.invoke('bizsuit:customer-display:close'),
  update: (state = {}) => ipcRenderer.invoke('bizsuit:customer-display:update', state),
  clear: () => ipcRenderer.invoke('bizsuit:customer-display:clear'),
  getState: () => ipcRenderer.invoke('bizsuit:customer-display:get-state'),
  status: () => ipcRenderer.invoke('bizsuit:customer-display:status'),
  setFullscreen: (fullscreen) => ipcRenderer.invoke('bizsuit:customer-display:set-fullscreen', !!fullscreen),
  toggleFullscreen: () => ipcRenderer.invoke('bizsuit:customer-display:toggle-fullscreen'),
  onState: (callback) => {
    const listener = (_event, state) => callback?.(state);
    ipcRenderer.on('bizsuit:customer-display:state', listener);
    return () => ipcRenderer.removeListener('bizsuit:customer-display:state', listener);
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback?.(status);
    ipcRenderer.on('bizsuit:customer-display:status', listener);
    return () => ipcRenderer.removeListener('bizsuit:customer-display:status', listener);
  },
});
