const { contextBridge, shell, ipcRenderer, webFrame } = require('electron');
const path = require('path');
const { remote } = require('@electron/remote/main')


// Cache the last VMC config (off by default)
let vmcCfg = { receive:{enable:false,port:39539,syncExpression: false}, send:{enable:false,host:'127.0.0.1',port:39540} };

// The main process pushes the latest config
ipcRenderer.on('vmc-config-changed', (_, cfg) => { vmcCfg = cfg; });

// Server config kept consistent with main.js
const HOST = '127.0.0.1'
const PORT = 3456
// Get the config data passed from the main process
const windowConfig = {
    windowName: "default",
};
// Expose a basic ipcRenderer for the splash-screen page
contextBridge.exposeInMainWorld('electron', {
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  ipcRenderer: {
    on: (channel, func) => {
      // Only allow specific channels
      const validChannels = ['backend-ready', 'trigger-search']; 
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    }
  },
  // Expose the server config
  server: {
    host: HOST,
    port: PORT
  },
  requestStopDiscordBot : () => ipcRenderer.invoke('request-stop-discordbot'),
  requestStopTelegramBot : () => ipcRenderer.invoke('request-stop-telegrambot'),
  requestStopSlackBot : () => ipcRenderer.invoke('request-stop-slackbot'),
});

// Expose the secure interface
contextBridge.exposeInMainWorld('electronAPI', {
  onNewTab: (callback) => ipcRenderer.on('create-tab', (_, url) => callback(url)),
  saveScreenshotDirect: (buffer) => ipcRenderer.invoke('save-screenshot-direct', { buffer }),
  // System features
  openExternal: (url) => shell.openExternal(url),
  openPath: (filePath) => shell.openPath(filePath),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getPath: () => remote.app.getPath('downloads'),
  // Window controls
  windowAction: (action) => ipcRenderer.invoke('window-action', action),
  onWindowState: (callback) => ipcRenderer.on('window-state', callback),

  // File dialogs
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openImageDialog: () => ipcRenderer.invoke('open-image-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('readFile', filePath),
  // Path handling
  pathJoin: (...args) => path.join(...args),
  sendLanguage: (lang) => ipcRenderer.send('set-language', lang),
  // Global scaling (font/UI scale)
  setZoomFactor: (factor) => {
    try { webFrame.setZoomFactor(Number(factor) || 1); } catch (e) { /* noop */ }
  },
  getZoomFactor: () => {
    try { return webFrame.getZoomFactor(); } catch (e) { return 1; }
  },
  // Environment detection
  isElectron: true,

  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', callback),
  onUpdateError: (callback) => ipcRenderer.on('update-error', callback),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
  showContextMenu: (menuType, data) => ipcRenderer.invoke('show-context-menu', { menuType, data }),
  // Save environment variables
  setNetworkVisibility: (visible) => ipcRenderer.invoke('set-env', { key: 'networkVisible', value: visible }), 
  
  saveChromeSettings: (settings) => ipcRenderer.invoke('save-chrome-config', settings),
  getInternalCDPInfo: () => ipcRenderer.invoke('get-internal-cdp-info'),
  // Restart the app
  restartApp: () => ipcRenderer.invoke('restart-app'),
  startVRMWindow: (windowConfig) => ipcRenderer.invoke('start-vrm-window', windowConfig),
  stopVRMWindow: () => ipcRenderer.invoke('stop-vrm-window'),
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
  getIgnoreMouseStatus: () => ipcRenderer.invoke('get-ignore-mouse-status'),
  downloadFile: (payload) => ipcRenderer.invoke('download-file', payload),
  // Change: add a callback parameter
  getWindowConfig: (callback) => {
      if (windowConfig.windowName !== "default") {
          // If the config is already updated, return directly
          callback(windowConfig);
      } else {
          // If the config isn't updated yet, listen for the update event
          const handler = (event) => {
              callback(event.detail);
              window.removeEventListener('window-config-updated', handler);
          };
          window.addEventListener('window-config-updated', handler);
      }
  },

  setVMCConfig: (cfg) => ipcRenderer.invoke('set-vmc-config', cfg),
  getVMCConfig: () => ipcRenderer.invoke('get-vmc-config'),
  onVMCConfigChanged: (cb) => ipcRenderer.on('vmc-config-changed', (_, cfg) => cb(cfg)),
  captureDesktop: () => ipcRenderer.invoke('capture-desktop'), // Desktop screenshot
  toggleWindowSize: (width, height) => ipcRenderer.invoke('toggle-window-size', { width, height }),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  showScreenshotOverlay: (hideWindow) => ipcRenderer.invoke('show-screenshot-overlay', { hideWindow }),
  cropDesktop:        (opts) => ipcRenderer.invoke('crop-desktop', opts),
  cancelScreenshotOverlay: () => ipcRenderer.invoke('cancel-screenshot-overlay'),
  openDirectoryDialog: async () => {
    return ipcRenderer.invoke('dialog:openDirectory');
  },
  execCommand: (command) => ipcRenderer.invoke('exec-command', command),
  getPlatform: () => process.platform,
  openExtensionWindow: (url, extension) => ipcRenderer.invoke('open-extension-window', { url, extension }),
  getBackendLogs: () => ipcRenderer.invoke('get-backend-logs'),

  onRemoteInstall: (callback) => ipcRenderer.on('remote-install-any', (_, payload) => callback(payload)),
  checkPendingInstall: () => ipcRenderer.invoke('check-pending-install'),

  registerGlobalShortcut: (key) => ipcRenderer.invoke('register-global-shortcut', key),
  unregisterGlobalShortcut: () => ipcRenderer.invoke('unregister-global-shortcut'),
  onGlobalShortcutTriggered: (callback) => ipcRenderer.on('global-shortcut-triggered', callback),
  registerVrmInputShortcut: (key) => ipcRenderer.invoke('register-vrm-input-shortcut', key),
  unregisterVrmInputShortcut: () => ipcRenderer.invoke('unregister-vrm-input-shortcut'),
  onVrmInputToggleTriggered: (callback) => ipcRenderer.on('vrm-input-toggle-triggered', callback),
  registerVrmShowShortcut: (key) => ipcRenderer.invoke('register-vrm-show-shortcut', key),
  unregisterVrmShowShortcut: () => ipcRenderer.invoke('unregister-vrm-show-shortcut'),
  registerVrmHideShortcut: (key) => ipcRenderer.invoke('register-vrm-hide-shortcut', key),
  unregisterVrmHideShortcut: () => ipcRenderer.invoke('unregister-vrm-hide-shortcut'),
  vrmWander: (opts) => ipcRenderer.invoke('vrm-wander', opts),
  summonFriend: (opts) => ipcRenderer.invoke('summon-vrm-friend', opts),
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
  deleteWorkspaceFile: (filePath) => ipcRenderer.invoke('delete-workspace-file', filePath),
  uploadToWorkspace: (targetDirPath, sourceFilePaths) => ipcRenderer.invoke('upload-to-workspace', { targetDirPath, sourceFilePaths }),
  startWorkspaceWatch: (dirPath) => ipcRenderer.invoke('start-workspace-watch', dirPath),
  stopWorkspaceWatch: () => ipcRenderer.invoke('stop-workspace-watch'),
  onWorkspaceChanged: (callback) => {
    // Remove any existing old listener first, to prevent multiple triggers from repeated component mounting
    ipcRenderer.removeAllListeners('workspace-changed');
    ipcRenderer.on('workspace-changed', (_, data) => callback(data));
  },
});

contextBridge.exposeInMainWorld('vmcAPI', {
  onVMCBone: (callback) => ipcRenderer.on('vmc-bone', (_, data) => callback(data)),

  onVMCOscRaw: (cb) => ipcRenderer.on('vmc-osc-raw', (_, oscMsg) => cb(oscMsg)),

  sendVMCBone: (data) => {
    if (!vmcCfg.send.enable) return;
    return ipcRenderer.invoke('send-vmc-bone', data);
  },
  sendVMCBlend: (data) => {
    if (!vmcCfg.send.enable) return;
    return ipcRenderer.invoke('send-vmc-blend', data);
  },
  sendVMCBlendApply: () => {
    if (!vmcCfg.send.enable) return;
    return ipcRenderer.invoke('send-vmc-blend-apply');
  },
  sendVMCFrame: (data) => ipcRenderer.invoke('send-vmc-frame', data),
});

contextBridge.exposeInMainWorld('downloadAPI', {
    // Listen for download events
    onDownloadStarted: (cb) => ipcRenderer.on('download-started', (_, data) => cb(data)),
    onDownloadUpdated: (cb) => ipcRenderer.on('download-updated', (_, data) => cb(data)),
    onDownloadDone: (cb) => ipcRenderer.on('download-done', (_, data) => cb(data)),
    
    // Send a control command
    controlDownload: (id, action) => ipcRenderer.invoke('download-control', { id, action }),
    showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path)
});

// Add the following code at the end of the file to receive the config passed from the main process
ipcRenderer.on('set-window-config', (event, config) => {
    Object.assign(windowConfig, config);
    console.log('收到窗口配置:', windowConfig);
    
    // Add: after the config updates, dispatch an event to notify the page
    window.dispatchEvent(new CustomEvent('window-config-updated', {
        detail: windowConfig
    }));
});
