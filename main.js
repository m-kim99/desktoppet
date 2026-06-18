const remoteMain = require('@electron/remote/main')
const { app, BrowserWindow, ipcMain, screen, shell, dialog, Tray, Menu, session,globalShortcut} = require('electron')
const { clipboard, nativeImage,desktopCapturer  } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const { spawn } = require('child_process')
const { exec } = require('child_process');
const { download } = require('electron-dl');
const fs = require('fs')
const os = require('os')
const net = require('net') // Add the net module for port detection
const dgram = require('dgram');
const osc = require('osc');
const chokidar = require('chokidar');
let workspaceWatcher = null; // Declare the global watcher variable
// VMC: UDP send/receive resources
let vmcUdpPort = null;          // osc.UDPPort instance
let vmcReceiverActive = false;  // Whether receiving is running
let vrmWindows = [];
let lastVrmConfig = { width: 540, height: 960 }; // The most recent size, reused when summoning the pet via a global shortcut
let shotOverlay = null
let isMac = process.platform === 'darwin';
const vmcSendSocket = dgram.createSocket('udp4'); // Sending reuses the same socket
const MAX_LOG_LINES = 2000; // Keep the most recent 2000 log lines
let logBuffer = []; // In-memory log buffer
let activeDownloads = new Map(); 
function appendLogToBuffer(source, data) {
  const timestamp = new Date().toLocaleTimeString();
  const lines = data.toString().split(/\r?\n/);
  
  lines.forEach(line => {
    if (line.trim()) {
      logBuffer.push(`[${timestamp}] [${source}] ${line}`);
    }
  });

  // Clean up old logs to prevent unbounded memory growth
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer = logBuffer.slice(logBuffer.length - MAX_LOG_LINES);
  }
}
async function cropDesktop(rect) {
  if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number' ||
      typeof rect.width !== 'number' || typeof rect.height !== 'number') {
    throw new Error('cropDesktop 需要 {x,y,width,height} 且均为数字')
  }

  const { width, height } = screen.getPrimaryDisplay().bounds
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  if (!sources.length) throw new Error('无法获取屏幕源')

  // 1. Get the full-screen PNG buffer
  const pngBuffer = sources[0].thumbnail.toPNG()

  // 2. Crop using Electron's built-in nativeImage
  const img  = nativeImage.createFromBuffer(pngBuffer)
  const cropped = img.crop({
    x: Math.floor(rect.x),
    y: Math.floor(rect.y),
    width: Math.floor(rect.width),
    height: Math.floor(rect.height)
  })

  // 3. Return the Buffer directly; no downstream changes needed
  return cropped.toPNG()
}

// Replaces the original startVMCReceiver
function startVMCReceiver(cfg) {
  if (vmcReceiverActive) return;
  vmcUdpPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: cfg.receive.port,
    metadata: true,
  });
  vmcUdpPort.open();
  vmcUdpPort.on('message', (oscMsg) => {

    /* -------- 1. Bones -------- */
    if (oscMsg.address === '/VMC/Ext/Bone/Pos') {
      if (!Array.isArray(oscMsg.args) || oscMsg.args.length < 8) return;
      const [boneName, x, y, z, qx, qy, qz, qw] = oscMsg.args.map(v => v.value ?? v);
      if (typeof boneName !== 'string') return;

      vrmWindows.forEach(w => {
        if (!w.isDestroyed()) {
          w.webContents.send('vmc-bone', { boneName, position:{x,y,z}, rotation:{x:qx,y:qy,z:qz,w:qw} });
          w.webContents.send('vmc-osc-raw', oscMsg);
        }
      });
      return;
    }

    /* -------- 2. Expressions -------- */
    if (oscMsg.address === '/VMC/Ext/Blend/Val') {
      if (!Array.isArray(oscMsg.args) || oscMsg.args.length < 2) return;
      vrmWindows.forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('vmc-osc-raw', oscMsg);
      });
      return;
    }

    /* -------- 3. Expression apply -------- */
    if (oscMsg.address === '/VMC/Ext/Blend/Apply') {
      // Apply takes no arguments; a length of 0 is valid too
      vrmWindows.forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('vmc-osc-raw', oscMsg);
      });
    }
  });


  vmcReceiverActive = true;
  console.log(`[VMC] 接收已启动 @ ${cfg.receive.port}`);
}
function stopVMCReceiver() {
  if (!vmcReceiverActive) return;
  vmcUdpPort.close();
  vmcUdpPort = null;
  vmcReceiverActive = false;
  console.log('[VMC] 接收已停止');
}

// Send VMC Bone -------------------------------------------------
function sendVMCBoneMain(data) {
  if (!data) return;
  const { boneName, position, rotation } = data;
  if (!boneName || !position || !rotation) return;

  const { host, port } = global.vmcCfg.send;          // <- panel config
  const oscMsg = osc.writePacket({
    address: `/VMC/Ext/Bone/Pos`,
    args: [
      { type: 's', value: boneName },
      { type: 'f', value: position.x || 0 },
      { type: 'f', value: position.y || 0 },
      { type: 'f', value: position.z || 0 },
      { type: 'f', value: rotation.x || 0 },
      { type: 'f', value: rotation.y || 0 },
      { type: 'f', value: rotation.z || 0 },
      { type: 'f', value: rotation.w || 1 },
    ],
  });
  vmcSendSocket.send(oscMsg, port, host, (err) => {
    if (err) console.error('VMC send error:', err);
  });
}

// Send VMC Blend ------------------------------------------------
function sendVMCBlendMain(data) {
  if (!data) return;
  const { blendName, weight } = data;
  if (typeof blendName !== 'string' || typeof weight !== 'number') return;

  const { host, port } = global.vmcCfg.send;          // <- panel config
  const oscMsg = osc.writePacket({
    address: '/VMC/Ext/Blend/Val',
    args: [
      { type: 's', value: blendName },
      { type: 'f', value: Math.max(0, Math.min(1, weight)) },
    ],
  });
  vmcSendSocket.send(oscMsg, port, host, (err) => {
    if (err) console.error('VMC blend send error:', err);
  });
}

// Send VMC Blend Apply ------------------------------------------
function sendVMCBlendApplyMain() {
  const { host, port } = global.vmcCfg.send;          // <- panel config
  const oscMsg = osc.writePacket({
    address: '/VMC/Ext/Blend/Apply',
    args: [],
  });
  vmcSendSocket.send(oscMsg, port, host);
}

let pythonExec;
let isQuitting = false;

// Determine the OS
if (os.platform() === 'win32') {
  // Windows
  pythonExec = path.join('.venv', 'Scripts', 'python.exe');
} else {
  // macOS / Linux
  pythonExec = path.join('.venv', 'bin', 'python3');
}


function getCleanUserAgent() {
  const chromeVersion = '124.0.0.0'; // Must stay consistent with the version in the frontend code!
  const baseUA = `Mozilla/5.0 ({os_info}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  
  let osInfo = '';
  // In Node.js, just use process.platform
  switch (process.platform) {
    case 'darwin':
      osInfo = 'Macintosh; Intel Mac OS X 10_15_7';
      break;
    case 'win32':
      osInfo = 'Windows NT 10.0; Win64; x64';
      break;
    case 'linux':
      osInfo = 'X11; Linux x86_64';
      break;
    default:
      osInfo = 'Windows NT 10.0; Win64; x64';
  }

  return baseUA.replace('{os_info}', osInfo);
}

// Compute it ahead of time for later use
const REAL_CHROME_UA = getCleanUserAgent();

let mainWindow
let loadingWindow
let tray = null
let updateAvailable = false
let backendProcess = null
const HOST = '127.0.0.1'
let PORT = 3456 // Changed to let to allow modification
const DEFAULT_PORT = 3456 // Save the default port
const isDev = process.env.NODE_ENV === 'development'
const locales = {
  'zh-CN': {
    show: '显示窗口',
    exit: '退出',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    copyImage: '复制图片',
    copyImageLink: '复制图片链接',
    saveImageAs: '图片另存为...',
    supportedFiles: '支持的文件',
    allFiles: '所有文件',
    supportedimages: '支持的图片',
    // New item
    openNewTab: '在新标签页打开',
    copyLink: '复制链接地址',
    copyLinkText: '复制链接文本',
    selectAll: '全选',
    inspect: '检查元素'
  },
  'en-US': {
    show: 'Show Window',
    exit: 'Exit',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    copyImage: 'Copy Image',
    copyImageLink: 'Copy Image Link',
    saveImageAs: 'Save Image As...',
    supportedFiles: 'Supported Files',
    allFiles: 'All Files',
    supportedimages: 'Supported Images',
    // New item
    openNewTab: 'Open in new tab',
    copyLink: 'Copy link address',
    copyLinkText: 'Copy link text',
    selectAll: 'Select All',
    inspect: 'Inspect'
  }
};
const ALLOWED_EXTENSIONS = [
  // Office documents
    'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'pages', 
    'numbers', 'key', 'rtf', 'odt', 'epub',
  
  // Programming/development
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs',
  'swift', 'kt', 'dart', 'rb', 'php', 'html', 'css', 'scss', 'less',
  'vue', 'svelte', 'jsx', 'tsx', 'json', 'xml', 'yml', 'yaml', 
  'sql', 'sh',
  
  // Data/config
  'csv', 'tsv', 'txt', 'md', 'log', 'conf', 'ini', 'env', 'toml'
  ];
const ALLOWED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const ALLOWED_VIDEO_EXTENSIONS =['mp4', 'webm', 'ogg', 'mov', 'avi'];
let currentLanguage = 'zh-CN';

// Build the menu items
let menu;

// Configure the log-file path
const logDir = path.join(app.getPath('userData'), 'logs')
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

// Get the config-file path
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Load the environment variables
function loadEnvVariables() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Iterate the config and load it into env vars
      for (const key in config) {
        const val = config[key];
        // Likewise, only load primitive types into env
        if (typeof val === 'string' || typeof val === 'number') {
          process.env[key] = val;
        }
      }
      return config; // Return the full config object for the CDP logic to use
    } catch (e) {
      console.error('加载配置失败:', e);
    }
  }
  return {};
}

function saveEnvVariable(key, value) {
  const configPath = getConfigPath();
  let config = {};
  
  // 1. Read the existing file
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) { console.error('配置文件读取出错:', e); }

  // 2. Update the file content (both objects and strings can be stored)
  config[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  // 3. Key improvement: type checking
  // Only write strings or numbers into process.env, to prevent objects becoming "[object Object]"
  if (typeof value === 'string' || typeof value === 'number') {
    process.env[key] = value;
  }
}

const globalConfig = loadEnvVariables();

// Define a global variable
let SESSION_CDP_PORT = 0; // Initially 0
let IS_INTERNAL_MODE_ACTIVE = false;

if (globalConfig?.chromeMCPSettings?.type === 'internal' && globalConfig?.chromeMCPSettings?.enabled) {
  
  // Change 1: use port '0' so the system auto-assigns a definitely-safe free port
  app.commandLine.appendSwitch('remote-debugging-port', '0');
  
  // Change 2: bind explicitly to 127.0.0.1 to avoid firewall alerts
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  
  app.commandLine.appendSwitch('remote-allow-origins', '*');
  
  IS_INTERNAL_MODE_ACTIVE = true;
  console.log('[CDP] 已请求系统自动分配内置浏览器调试端口...');
}
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096'); // Allow up to 4GB of memory
// New: detect whether a port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(port, HOST, () => {
      server.once('close', () => resolve(true))
      server.close()
    })
    server.on('error', () => resolve(false))
  })
}

// New: find an available port
async function findAvailablePort(startPort = DEFAULT_PORT, maxAttempts = 20000) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`无法找到可用端口，已尝试 ${startPort} 到 ${startPort + maxAttempts - 1}`)
}


// Create the splash-screen window
function createSkeletonWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    frame: false,
    titleBarStyle: 'hiddenInset', // macOS-specific: hide the title bar but still show the native buttons
    trafficLightPosition: { x: 10, y: 12 }, // Custom button position (optional)
    show: true,
    icon: 'static/source/icon.png',
    webPreferences: {
      preload: path.join(__dirname, 'static/js/preload.js'),
      nodeIntegration: false,
      sandbox: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: false,
      devTools: isDev,
      partition: 'persist:main-session',
      webviewTag: true,
    }
  })

  remoteMain.enable(mainWindow.webContents)
  
  // Load the splash-screen page
  mainWindow.loadFile(path.join(__dirname, 'static/skeleton.html'))
  
  // Set up auto-update
  setupAutoUpdater()
  
  // Window-state sync
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state', 'maximized')
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state', 'normal')
  })
  
  // Window-close handling - minimize to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      return false
    }
    return true
  })
}

function getAcpxPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'acpx');
  } else {
    return path.join(__dirname, 'node_modules', 'acpx');
  }
}

// The modified start-backend function
/**
 * Start the backend service
 * Logic: pass port 0 -> capture REAL_PORT_FOUND -> return the real port
 */
async function startBackend() {
  return new Promise((resolve, reject) => {
    try {
      console.log('🔍 准备启动后端进程...');
      const npmCliPath = isDev 
        ? path.join(__dirname, 'node_modules', 'npm', 'bin', 'npm-cli.js')
        : path.join(process.resourcesPath, 'npm', 'bin', 'npm-cli.js');
      const spawnOptions = {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: {
          ...process.env,
          NODE_ENV: isDev ? 'development' : 'production',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1', // Force Python to flush its buffer in real time
          ELECTRON_NODE_EXEC: process.execPath, 
          ELECTRON_NPM_CLI: npmCliPath,
          ELECTRON_RESOURCES_PATH: app.isPackaged ? process.resourcesPath : path.join(__dirname),
          ELECTRON_ACPM_PATH: getAcpxPath(),
        }
      };

      if (process.platform === 'win32') {
        spawnOptions.windowsHide = !isDev;
      }

      // Get the host config
      const BACKEND_HOST = (globalConfig?.networkVisible === 'global') ? '0.0.0.0' : '127.0.0.1';

      let execPath = "";
      let backendArgs = [];

      if (isDev) {
        execPath = pythonExec;
        // Use -u to ensure output isn't buffered, even when importing many libraries
        backendArgs = ['-u', 'server.py', '--host', BACKEND_HOST, '--port', '3456'];
      } else {
        const serverExecutable = process.platform === 'win32' ? 'server.exe' : 'server';
        const resourcesPath = process.resourcesPath || path.join(process.execPath, '..', 'resources');
        execPath = path.join(resourcesPath, 'server', serverExecutable);
        backendArgs = ['--host', BACKEND_HOST, '--port', '3456'];
        spawnOptions.cwd = path.dirname(execPath);
      }

      console.log(`🚀 执行路径: ${execPath}`);
      backendProcess = spawn(execPath, backendArgs, spawnOptions);

      let isHandshaked = false;

      // Core listening logic
      const onData = (data) => {
        const output = data.toString();
        // 1. Still keep the log buffer for the frontend to view
        appendLogToBuffer('BACKEND', output);

        if (isDev) {
            // In dev mode, print the raw output to the console for easier debugging
            process.stdout.write(`[PY] ${output}`);
        }

        // 2. Try to parse the port-handshake signal
        const match = output.match(/REAL_PORT_FOUND:(\d+)/);
        if (match && !isHandshaked) {
          const actualPort = parseInt(match[1], 10);
          if (actualPort > 0) {
            isHandshaked = true;
            PORT = actualPort; // Update the global PORT variable
            console.log(`✅ 握手成功！后端运行端口: ${PORT}`);
            resolve(PORT);
          }
        }
      };

      backendProcess.stdout.on('data', onData);
      backendProcess.stderr.on('data', onData);

      // Process-error handling
      backendProcess.on('error', (err) => {
        console.error('❌ 后端启动失败:', err);
        reject(err);
      });

      // Handle unexpected process exit
      backendProcess.on('close', (code) => {
        console.log(`ℹ️ 后端进程已退出 (code ${code})`);
        if (!isHandshaked) {
          reject(new Error(`后端进程在分配端口前已关闭，退出码: ${code}`));
        }
      });

      // 5-minute timeout protection
      setTimeout(() => {
        if (!isHandshaked) {
          if (backendProcess) backendProcess.kill();
          reject(new Error('后端启动超时：未能从 Python 日志捕获 REAL_PORT_FOUND 信号'));
        }
      }, 360000*5);

    } catch (err) {
      reject(err);
    }
  });
}

// The modified wait-for-backend function
async function waitForBackend() {
  const MAX_RETRIES = 60; // Wait at most 30 seconds
  const RETRY_INTERVAL = 500;
  let retries = 0;

  console.log(`⏳ 正在等待 http://127.0.0.1:${PORT}/health 响应...`);
  console.log(`⏳ 更新后的首次启动时会花费更久的时间，请耐心等待...`);
  console.log(`⏳ The first launch after an update may take longer, please be patient...`);
  while (retries < MAX_RETRIES) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (response.ok) {
        console.log('✨ 后端健康检查通过！');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backend-ready', { port: PORT });
        }
        return;
      }
    } catch (err) {
      retries++;
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
  throw new Error('后端已启动但健康检查响应超时');
}
// Generic download handler
function handleDownloadItem(event, item, webContents) {
  // Fix: use the globally defined mainWindow directly instead of getAllWindows()[0]
  if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('主窗口不存在或已销毁，无法发送下载状态');
      return;
  }
  const win = mainWindow;

  const downloadId = Date.now().toString();
  
  // Put it into the Map to manage (your original logic)
  activeDownloads.set(downloadId, item);

  const fileName = item.getFilename();
  const filePath = item.getSavePath();

  // 1. Send the start event
  win.webContents.send('download-started', {
      id: downloadId,
      filename: fileName,
      totalBytes: item.getTotalBytes(),
      path: filePath
  });

  // 2. Listen for status updates
  item.on('updated', (event, state) => {
      if (state === 'interrupted') {
          win.webContents.send('download-updated', { id: downloadId, state: 'interrupted' });
      } else if (state === 'progressing') {
          if (item.isPaused()) {
              win.webContents.send('download-updated', { id: downloadId, state: 'paused' });
          } else {
              win.webContents.send('download-updated', {
                  id: downloadId,
                  state: 'progressing',
                  receivedBytes: item.getReceivedBytes(),
                  totalBytes: item.getTotalBytes(),
                  progress: item.getTotalBytes() > 0 ? item.getReceivedBytes() / item.getTotalBytes() : 0
              });
          }
      }
  });

  // 3. Listen for completion
  item.once('done', (event, state) => {
      win.webContents.send('download-done', {
          id: downloadId,
          state: state,
          path: item.getSavePath()
      });
      // Download complete; remove the reference
      activeDownloads.delete(downloadId);
  });
}


// Handle control commands from the frontend (pause/resume/cancel)
ipcMain.handle('download-control', (event, { id, action }) => {
  // Likewise use the top-level activeDownloads
  const item = activeDownloads.get(id);
  
  if (!item) {
    console.log(`未找到下载任务 ID: ${id}`);
    return;
  }

  switch (action) {
    case 'pause':
      if (!item.isPaused()) item.pause();
      break;
    case 'resume':
      if (item.canResume()) item.resume();
      break;
    case 'cancel':
      item.cancel();
      break;
  }
});

// Open the folder containing the file
ipcMain.handle('show-item-in-folder', (event, filePath) => {
    if(filePath) shell.showItemInFolder(filePath);
});

// Configure auto-update
function setupAutoUpdater() {
  autoUpdater.autoDownload = false; // Disable auto-download first
  if (isDev) {
    autoUpdater.on('error', (err) => {
      mainWindow.webContents.send('update-error', err.message);
    });
  }
  autoUpdater.on('update-available', (info) => {
    updateAvailable = true;
    // Show the update button and start downloading
    mainWindow.webContents.send('update-available', info);
    autoUpdater.downloadUpdate(); // Auto-start the download
  });
  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('download-progress', {
      percent: progressObj.percent.toFixed(1),
      transferred: (progressObj.transferred / 1024 / 1024).toFixed(2),
      total: (progressObj.total / 1024 / 1024).toFixed(2)
    });
  });
  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update-downloaded');
  });
}

const PROTOCOL = 'sap';

// --- 1. Acquire the single-instance lock as early as possible ---
const gotTheLock = app.requestSingleInstanceLock();

// --- 2. If not the first instance, exit immediately; don't run any other code ---
if (!gotTheLock) {
  // On Windows, a second instance starts because a protocol link was clicked
  // We need to parse the args, pass them to the first instance, then exit immediately
  const startUrl = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
  if (startUrl) {
    // Nothing really needs to happen here, since the second-instance event fires in the first instance
    // The second instance can just exit
    console.log('Second instance detected with URL:', startUrl);
  }
  app.quit();
  return; // <- key: return directly to prevent all subsequent code from running
}

// --- 3. Only the first instance reaches here ---
let pendingExtensionUrl = null;

// Windows cold-start handling (the first instance starts with a protocol argument)
const startUrl = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
if (startUrl) {
  pendingExtensionUrl = startUrl;
}

app.on('second-instance', (event, commandLine) => {
  // Fires when a second instance starts; here we activate the first instance's window and handle the URL
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  
  // Parse the URL from the command-line arguments
  const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
  handleProtocolUrl(url);
});

// Register the protocol (only in the first instance)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

ipcMain.handle('get-window-size', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win.getSize();
});
const CHROME_VERSION = '124.0.0.0';
const CHROME_MAJOR = '124';
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure,LogAds');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Only initialize when the lock is acquired (the first instance)
app.whenReady().then(async () => {
  try {


    const partySession = session.fromPartition('persist:party-browser-session');

    partySession.on('will-download', (event, item, webContents) => {
        console.log('捕获到下载请求 (来自 Webview 分区):', item.getFilename());
        handleDownloadItem(event, item, webContents);
    });

    // Intercept request headers for deep spoofing
    partySession.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
        const headers = details.requestHeaders;
        
        // 1. Force the UA
        headers['User-Agent'] = REAL_CHROME_UA;

        // 2. Forge Sec-Ch-Ua (Client Hints)
        // This is what Google focuses on checking
        const brand = `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not-A.Brand";v="99"`;
        headers['Sec-Ch-Ua'] = brand;
        headers['Sec-Ch-Ua-Mobile'] = '?0';
        headers['Sec-Ch-Ua-Full-Version'] = `"${CHROME_VERSION}"`;
        headers['Sec-Ch-Ua-Full-Version-List'] = brand;
        
        // 3. Platform spoofing (set dynamically based on process.platform)
        let platform = 'Windows';
        if (process.platform === 'darwin') platform = 'macOS';
        else if (process.platform === 'linux') platform = 'Linux';
        headers['Sec-Ch-Ua-Platform'] = `"${platform}"`;

        // 4. Remove Electron-specific headers
        delete headers['Sec-Ch-Ua-Model']; // Desktop usually has no Model header
        delete headers['Electron-Major-Version'];
        delete headers['X-Electron-App-Name'];

        callback({ requestHeaders: headers });
    });
    app.on('session-created', (sess) => {
        // console.log('detected a new session:', sess.getUserAgent()); 
        
        // Attach a download listener to every newly created session (including webview's)
        sess.on('will-download', (event, item, webContents) => {
            console.log('捕获到下载请求 (来自 Webview/Session):', item.getFilename());
            handleDownloadItem(event, item, webContents);
        });
    });
    session.defaultSession.on('will-download', (event, item, webContents) => {
        console.log('捕获到下载请求 (来自主窗口):', item.getFilename());
        handleDownloadItem(event, item, webContents);
    });    
      // Default config
    global.vmcCfg = {
      receive: { enable: false, port: 39539,syncExpression: false },
      send:    { enable: false, host: '127.0.0.1', port: 39540 }
    };
    ipcMain.handle('get-vmc-config', () => {
      // Ensure the fields exist to avoid undefined
      global.vmcCfg.receive.syncExpression ??= false;
      return global.vmcCfg;
    });
    // Create the splash-screen window
    createSkeletonWindow()
    if (global.vmcCfg.receive.enable) startVMCReceiver(global.vmcCfg);
    // Start the backend service (now auto-finds an available port)
    await startBackend()
    ipcMain.handle('get-backend-logs', () => {
      return logBuffer.join('\n');
    });
    // Wait for the backend service to be ready
    await waitForBackend()
    
    // Once the backend is ready, load the full content
    console.log(`Backend server is running at http://${HOST}:${PORT}`)

    if (IS_INTERNAL_MODE_ACTIVE) {
        try {
            // Electron writes the active port to the DevToolsActivePort file under userData
            const portFile = path.join(app.getPath('userData'), 'DevToolsActivePort');
            
            // Give it a moment to ensure the file is written (usually present at Ready; a simple poll would be safer, but reading directly here is usually fine)
            // If reading fails, wait 500ms and retry
            if (!fs.existsSync(portFile)) {
                await new Promise(r => setTimeout(r, 500));
            }
            
            if (fs.existsSync(portFile)) {
                const content = fs.readFileSync(portFile, 'utf8');
                // The file's first line is the port, the second line is the path
                const realPort = parseInt(content.split('\n')[0], 10);
                
                if (!isNaN(realPort)) {
                    SESSION_CDP_PORT = realPort;
                    console.log(`✅ [CDP] 成功获取系统分配内置浏览器调试端口: ${SESSION_CDP_PORT}`);
                }
            } else {
                console.error('❌ [CDP] 未找到 DevToolsActivePort 文件，无法获取端口');
            }
        } catch (e) {
            console.error('❌ [CDP] 读取端口文件失败:', e);
        }
    }

    ipcMain.handle('get-app-path', () => {
      return app.getAppPath();
    });

    // 1. Get the CDP status (for frontend init)
    ipcMain.handle('get-internal-cdp-info', () => {
      return {
        active: IS_INTERNAL_MODE_ACTIVE,
        port: SESSION_CDP_PORT
      };
    });

    // 3. Handle saving the Chrome config (also calls saveEnvVariable)
    // The settings from the frontend is an object; saveEnvVariable can now handle it
    ipcMain.handle('save-chrome-config', async (event, settings) => {
      saveEnvVariable('chromeMCPSettings', settings);
      return true;
    });

    // Add the IPC handler for getting port info
    ipcMain.handle('get-server-info', () => {
      return {
        port: PORT,
        defaultPort: DEFAULT_PORT,
        isDefaultPort: PORT === DEFAULT_PORT
      }
    })

    ipcMain.handle('set-env', async (event, arg) => {
      saveEnvVariable(arg.key, arg.value);
    });
    // Restart the app
    ipcMain.handle('restart-app', () => {
      app.relaunch();
      app.quit();
    })

    ipcMain.handle('save-screenshot-direct', async (event, { buffer }) => {
      // 1. Determine the save path: userData/uploaded_files
      // Make sure this path matches the static directory mounted by the Python backend
      const uploadDir = path.join(app.getPath('userData'),'Super-Agent-Party', 'uploaded_files');
      
      // 2. Ensure the directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // 3. Generate the filename
      const filename = `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 6)}.jpg`;
      const filePath = path.join(uploadDir, filename);

      // 4. Write the file
      fs.writeFileSync(filePath, Buffer.from(buffer));
      
      // 5. Return only the filename; the frontend builds the URL
      return filename;
    });

    // Add the following code inside main.js's app.whenReady().then(async () => {

    ipcMain.handle('open-extension-window', async (_, { url, extension }) => {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      
      // Decide the window properties based on the extension config
      const windowConfig = {
        width: extension.width || 800,
        height: extension.height || 600,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: false,
          webviewTag: true,
          devTools: isDev,
          preload: path.join(__dirname, 'static/js/preload.js')
        }
      };

      // If the extension needs transparency and no frame
      if (extension.transparent) {
        Object.assign(windowConfig, {
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: false,
          hasShadow: false,
          backgroundColor: 'rgba(0, 0, 0, 0)',
        });
      } else {
        // Regular window config
        Object.assign(windowConfig, {
          frame: true,
          transparent: false,
          titleBarStyle: isMac ? 'hiddenInset' : 'default',
          icon: 'static/source/icon.png'
        });
      }

      const extensionWindow = new BrowserWindow(windowConfig);
      
      // Enable the remote module
      remoteMain.enable(extensionWindow.webContents);
      
      // Load the URL
      await extensionWindow.loadURL(url);
      
      // If it's a transparent window, set some special behaviors
      if (extension.transparent) {
        // You can set behaviors like mouse passthrough as needed
        // extensionWindow.setIgnoreMouseEvents(false);
      }
      
      return extensionWindow.id;
    });


ipcMain.handle('upload-to-workspace', async (event, { targetDirPath, sourceFilePaths }) => {
  try {
    if (!fs.existsSync(targetDirPath)) {
      return { success: false, error: '目标路径不存在' };
    }

    for (const source of sourceFilePaths) {
      const fileName = path.basename(source);
      const destPath = path.join(targetDirPath, fileName);
      
      // Native synchronous copy (doesn't support copying a whole folder, only files)
      fs.copyFileSync(source, destPath);
    }
    return { success: true };
  } catch (error) {
    console.error('上传失败:', error);
    return { success: false, error: error.message };
  }
});

    // Actually create the VRM pet window (reused by IPC and global shortcuts)
    async function createVrmWindow(windowConfig = {}) {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;

      // Keep pet windows tight around the character to minimize the transparent area that blocks
      // clicks to the apps behind. The character's on-screen size is normalized to window height
      // (see loadGlbPet), so a smaller window mostly trims empty margin rather than shrinking the
      // character. Width is trimmed conservatively (a quadruped friend is wider than it is tall).
      const windowWidth = Math.min(windowConfig.width || 540, 500);
      const windowHeight = Math.min(windowConfig.height || 960, 520);

      // Stagger additional pets to the left so a summoned "friend" appears beside the
      // existing character(s) instead of stacking on top. (Pet windows are mostly
      // transparent with the model centered, so a ~half-width shift reads as side-by-side.)
      const aliveCount = vrmWindows.filter(w => w && !w.isDestroyed()).length;
      const staggerX = aliveCount * Math.round(windowWidth * 0.5);
      const defaultX = Math.max(0, width - windowWidth - 40 - staggerX);
      const x = windowConfig.x !== undefined ? windowConfig.x : defaultX;
      // Fix: avoid a negative y coordinate when the screen height is less than the window height
      let defaultY;
      if (height >= windowHeight) {
        defaultY = height - windowHeight; // When the screen is tall enough, place it at the bottom
      } else {
        defaultY = 0; // When the screen isn't tall enough, place it at the top to keep the window on-screen
      }
      const y = windowConfig.y !== undefined ? windowConfig.y : defaultY;

      const vrmWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x,
        y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        acceptFirstMouse: true,
        backgroundColor: 'rgba(0, 0, 0, 0)',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: true,
          enableRemoteModule: true,
          sandbox: false,
          webgl: true,
          devTools: isDev,
          webAudio: true,
          autoplayPolicy: 'no-user-gesture-required',
          // Keep the render loop running while the (transparent) window is dragged/occluded,
          // otherwise macOS shows a stale, clipped frame during drag.
          backgroundThrottling: false,
          preload: path.join(__dirname, 'static/js/preload.js')
        }
      });

      // Load the page
      // A summoned "friend" carries its model id via query so the window loads a
      // different character (and marks itself as a non-main pet).
      let vrmUrl = `http://${HOST}:${PORT}/vrm.html`;
      if (windowConfig.modelId) {
        vrmUrl += `?model=${encodeURIComponent(windowConfig.modelId)}&friend=1`;
      }
      await vrmWindow.loadURL(vrmUrl);
      // Default settings (no passthrough, interactive)
      vrmWindow.setIgnoreMouseEvents(false);
      vrmWindow.setAlwaysOnTop(true);
      // Store the window reference
      vrmWindows.push(vrmWindow);

      // Window-close handling
      vrmWindow.on('closed', () => {
        vrmWindows = vrmWindows.filter(w => w !== vrmWindow);
      });

      return vrmWindow.id;  // Optional: return the window ID for later operations
    }

    ipcMain.handle('start-vrm-window', async (_, windowConfig = {}) => {
      // Remember the most recent window size, reused when 'summoning' via a global shortcut
      lastVrmConfig = {
        width: windowConfig.width || lastVrmConfig.width,
        height: windowConfig.height || lastVrmConfig.height,
      };
      return await createVrmWindow(windowConfig);
    });

    // Global shortcut: summon the pet (show it if hidden, or create it at the last size if it doesn't exist)
    async function summonVrmPet() {
      const alive = vrmWindows.filter(w => w && !w.isDestroyed());
      if (alive.length > 0) {
        alive.forEach(w => { try { w.show(); w.setAlwaysOnTop(true); } catch (e) {} });
      } else {
        await createVrmWindow(lastVrmConfig);
      }
    }

    // Global shortcut: hide the pet (hide rather than close, for quick re-summoning)
    function hideVrmPet() {
      vrmWindows.forEach(w => { try { if (w && !w.isDestroyed()) w.hide(); } catch (e) {} });
    }

    // VRM-pet show/hide global shortcuts (work even when the main window is hidden)
    let currentVrmShowKey = null;
    let currentVrmHideKey = null;

    ipcMain.handle('unregister-vrm-show-shortcut', () => {
      if (currentVrmShowKey) { globalShortcut.unregister(currentVrmShowKey); currentVrmShowKey = null; }
      return true;
    });
    ipcMain.handle('register-vrm-show-shortcut', (event, key) => {
      if (currentVrmShowKey) { globalShortcut.unregister(currentVrmShowKey); currentVrmShowKey = null; }
      if (!key) return false;
      try {
        const ok = globalShortcut.register(key, () => { summonVrmPet(); });
        if (ok) { currentVrmShowKey = key; console.log(`[VRM] show-pet global shortcut ${key} registered`); return true; }
        console.warn(`[VRM] show-pet global shortcut ${key} failed to register`);
        return false;
      } catch (e) { console.error('[VRM] show-pet shortcut error:', e); return false; }
    });

    ipcMain.handle('unregister-vrm-hide-shortcut', () => {
      if (currentVrmHideKey) { globalShortcut.unregister(currentVrmHideKey); currentVrmHideKey = null; }
      return true;
    });
    ipcMain.handle('register-vrm-hide-shortcut', (event, key) => {
      if (currentVrmHideKey) { globalShortcut.unregister(currentVrmHideKey); currentVrmHideKey = null; }
      if (!key) return false;
      try {
        const ok = globalShortcut.register(key, () => { hideVrmPet(); });
        if (ok) { currentVrmHideKey = key; console.log(`[VRM] hide-pet global shortcut ${key} registered`); return true; }
        console.warn(`[VRM] hide-pet global shortcut ${key} failed to register`);
        return false;
      } catch (e) { console.error('[VRM] hide-pet shortcut error:', e); return false; }
    });

    // VRM-pet autonomous wandering: move the requesting window to a random nearby spot within the current screen's work area
    const wanderingWindows = new Set();
    // Summon a "friend": open another pet window loading the given model id (placed beside
    // the existing pet via the stagger logic in createVrmWindow).
    ipcMain.handle('summon-vrm-friend', async (_, opts = {}) => {
      if (!opts || !opts.modelId) return { ok: false };
      // A friend window defaults to 540x960. On macOS a visible window's top is clamped to the
      // menu bar (workArea.y), so a window taller than the work area rests pinned at the top with
      // no room above it -> dragging it UP does nothing. Cap the friend's default height so it fits
      // inside the work area with margin; createVrmWindow then rests it at workArea-bottom, below the
      // menu bar, leaving headroom to drag upward. An explicit height from the caller is respected.
      const { height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
      const friendHeight = opts.height || Math.min(960, workHeight - 160);
      await createVrmWindow({ modelId: opts.modelId, width: opts.width, height: friendHeight });
      return { ok: true };
    });

    // JS mouse-follow window drag (used by friend windows). setPosition has no macOS
    // "title bar can't go above the menu bar" limit, so dragging works in every direction.
    ipcMain.handle('vrm-window-pos', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      return win && !win.isDestroyed() ? win.getPosition() : [0, 0];
    });
    ipcMain.handle('vrm-window-move', (e, { x, y } = {}) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) { try { win.setPosition(Math.round(x), Math.round(y)); } catch (er) {} }
      return true;
    });

    ipcMain.handle('vrm-wander', async (event, opts = {}) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed() || wanderingWindows.has(win)) return { moved: false };
      return await runVrmWander(win, opts);
    });

    async function runVrmWander(win, opts = {}) {
      try {
        const range = Math.max(20, Number(opts && opts.range) || 250);
        const duration = Math.max(200, Number(opts && opts.duration) || 1500);
        const [x, y] = win.getPosition();
        const [w, h] = win.getSize();
        const wa = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
        const angle = Math.random() * Math.PI * 2;
        const dist = range * (0.4 + Math.random() * 0.6);
        let tx = Math.round(x + Math.cos(angle) * dist);
        let ty = Math.round(y + Math.sin(angle) * dist);
        tx = Math.min(Math.max(tx, wa.x), wa.x + wa.width - w);
        ty = Math.min(Math.max(ty, wa.y), wa.y + wa.height - h);
        if (tx === x && ty === y) return { moved: false };
        wanderingWindows.add(win);
        await new Promise((resolve) => {
          const steps = Math.max(1, Math.round(duration / 16));
          let i = 0;
          const timer = setInterval(() => {
            if (win.isDestroyed()) { clearInterval(timer); return resolve(); }
            i++;
            const t = i / steps;
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
            try { win.setPosition(Math.round(x + (tx - x) * ease), Math.round(y + (ty - y) * ease)); } catch (e) {}
            if (i >= steps) { clearInterval(timer); resolve(); }
          }, 16);
        });
        return { moved: true };
      } catch (e) {
        console.error('[VRM] wander error:', e);
        return { moved: false };
      } finally {
        wanderingWindows.delete(win);
      }
    }
    // Desktop screenshot
    ipcMain.handle('capture-desktop', async () => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 } // Change as needed
      })
      if (!sources.length) throw new Error('无法获取屏幕源')
      const pngBuffer = sources[0].thumbnail.toPNG() // Return the native Buffer
      return pngBuffer // To the renderer process
    })

    ipcMain.handle('crop-desktop', async (e, { rect }) => {
      const png = await cropDesktop(rect)          // Whether it's sharp or nativeImage
      return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
    })

    ipcMain.handle('show-screenshot-overlay', async (_, { hideWindow = true } = {}) => {
      // 1. Decide whether to hide the main window based on the hideWindow param
      if (hideWindow) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
      }

      // 2. Create a full-screen, frameless, transparent window
      const { width, height } = screen.getPrimaryDisplay().bounds
      shotOverlay = new BrowserWindow({
        x: 0, y: 0, width, height,
        frame: false, 
        transparent: true, 
        alwaysOnTop: true,
        skipTaskbar: true, 
        resizable: false, 
        movable: false,
        enableLargerThanScreen: true,
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, 'static/js/shotPreload.js')
        }
      })
      
      shotOverlay.setIgnoreMouseEvents(false)
      shotOverlay.loadFile(path.join(__dirname, 'static/shotOverlay.html'))
      shotOverlay.webContents.on('did-finish-load', () => {
        shotOverlay.webContents.send('set-shot-language', currentLanguage)
      })

      shotOverlay.setVisibleOnAllWorkspaces(true)

      return new Promise((resolve) => {
        ipcMain.once('screenshot-selected', (e, rect) => {
          shotOverlay.close()
          shotOverlay = null
          resolve(rect)
        })
      })
    })

    ipcMain.handle('cancel-screenshot-overlay', () => {
      if (shotOverlay && !shotOverlay.isDestroyed()) {
        shotOverlay.close()
        shotOverlay = null
      }
    })


    // Add IPC handlers
    ipcMain.handle('set-ignore-mouse-events', (event, ignore, options) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        win.setIgnoreMouseEvents(ignore, options);
    });
    ipcMain.handle('dialog:openDirectory', async () => {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
      });
      return result;
    });
    // Add new IPC handlers
    ipcMain.handle('get-ignore-mouse-status', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win.isIgnoreMouseEvents();
    });
    ipcMain.handle('stop-vrm-window', (_, windowId) => {
      if (windowId !== undefined) {
        const win = vrmWindows.find(w => w.id === windowId);
        if (win && !win.isDestroyed()) {
          win.close();
        }
        vrmWindows = vrmWindows.filter(w => w.id !== windowId);
      } else {
        // Close all windows
        vrmWindows.forEach(win => {
          if (!win.isDestroyed()) {
            win.close();
          }
        });
        vrmWindows = [];
      }
    });
    // Handle downloads uniformly
    ipcMain.handle('download-file', async (event, payload) => {

      const { url, filename } = payload;   // Destructure here
      const dlItem = await download(mainWindow, url, {
        filename,
        saveAs: true,
        openFolderWhenDone: true
      });
      return { success: true, savePath: dlItem.getSavePath() };
    });
    // Check-for-updates IPC
    ipcMain.handle('check-for-updates', async () => {
      if (isDev) {
        console.log('Auto updates are disabled in development mode.')
        return { updateAvailable: false }
      }
      try {
        const result = await autoUpdater.checkForUpdates()
        // Return only the necessary serializable data
        return {
          updateAvailable: updateAvailable,
          updateInfo: result ? {
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate
          } : null
        }
      } catch (error) {
        console.error('检查更新出错:', error)
        return { 
          updateAvailable: false, 
          error: error.message 
        }
      }
    })

    // Download-update IPC
    ipcMain.handle('download-update', () => {
      if (updateAvailable) {
        return autoUpdater.downloadUpdate()
      }
    })

    // Install-update IPC
    ipcMain.handle('quit-and-install', () => {
      setTimeout(() => autoUpdater.quitAndInstall(), 500);
    });
            
    // Load the main page
    await mainWindow.loadURL(`http://${HOST}:${PORT}`)
    ipcMain.on('set-language', (_, lang) => {
      if (lang === 'auto') {
        // Get the system setting; default 'en-US', or 'zh-CN' if the system language is Chinese
        const systemLang = app.getLocale().split('-')[0];
        lang = systemLang === 'zh' ? 'zh-CN' : 'en-US';
      }
      currentLanguage = lang;
      updateTrayMenu();
      updatecontextMenu();
    });
    // Create the system tray
    createTray();
    updatecontextMenu();
    // The block below is where the 'main-process IPC + default config' goes
    ipcMain.handle('set-vmc-config', async (_, cfg) => {
      if (cfg.receive.enable) {
        if (!vmcReceiverActive || cfg.receive.port !== global.vmcCfg?.receive.port) {
          if (vmcReceiverActive) stopVMCReceiver();
          startVMCReceiver(cfg);
        }
      } else {
        stopVMCReceiver();
      }
      global.vmcCfg = cfg;
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('vmc-config-changed', cfg);
      });
      return { success: true };
    });

    ipcMain.handle('send-vmc-frame', (event, frameData) => {
      if (!global.vmcCfg?.send.enable) return;

      const { host, port } = global.vmcCfg.send;
      const { bones, blends } = frameData;
      const packets = [];

      // 1. Send Root (keeps the previously corrected zeroing logic)
      packets.push({
        address: '/VMC/Ext/Root/Pos',
        args: [
          { type: 's', value: 'root' },
          { type: 'f', value: 0 }, { type: 'f', value: 0 }, { type: 'f', value: 0 },
          { type: 'f', value: 0 }, { type: 'f', value: 0 }, { type: 'f', value: 0 }, { type: 'f', value: 1 }
        ]
      });

      // 2. Send bones (the core fix is here)
      bones.forEach(b => {
        if (b.name === 'root') return;

        // Warudo strictly requires PascalCase
        // Three.js uses "hips", Warudo wants "Hips"
        // Three.js uses "leftUpperArm", Warudo wants "LeftUpperArm"
        const vmcName = b.name.charAt(0).toUpperCase() + b.name.slice(1);

        packets.push({
          address: '/VMC/Ext/Bone/Pos',
          args: [
            { type: 's', value: vmcName },  // <--- use the converted capitalized name here
            { type: 'f', value: b.pos.x },
            { type: 'f', value: b.pos.y },
            { type: 'f', value: b.pos.z },
            { type: 'f', value: b.rot.x },
            { type: 'f', value: b.rot.y },
            { type: 'f', value: b.rot.z },
            { type: 'f', value: b.rot.w }
          ]
        });
      });

      // 3. Send expressions (BlendShape names usually need mapping too)
      blends.forEach(blend => {
        // We already mapped the expression names in vrm.js (Joy, A, I...), so use them directly here
        packets.push({
          address: '/VMC/Ext/Blend/Val',
          args: [
            { type: 's', value: blend.name },
            { type: 'f', value: blend.weight }
          ]
        });
      });

      // 4. Apply
      if (blends.length > 0) {
        packets.push({ address: '/VMC/Ext/Blend/Apply', args: [] });
      }

      // 5. OK (required by Warudo)
      packets.push({ 
        address: '/VMC/Ext/OK', 
        args: [{ type: 'i', value: 1 }] 
      });

      // ... send logic stays unchanged ...
      try {
        const bundleBuffer = osc.writePacket({
          timeTag: osc.timeTag(0),
          packets: packets
        });
        vmcSendSocket.send(bundleBuffer, port, host, (err) => {
            if (err) console.error(err);
        });
      } catch (e) { console.error(e); }
    });

    // Window-control events
    ipcMain.handle('window-action', (_, action) => {
      switch (action) {
        case 'show':
          mainWindow.show()
          break
        case 'hide':
          mainWindow.hide()
          break
        case 'minimize':
          mainWindow.minimize()
          break
        case 'maximize':
          mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
          break
        case 'close':
          mainWindow.close()
          break
      }
    })
    ipcMain.handle('toggle-window-size', async (event, { width, height }) => {
      const win = BrowserWindow.fromWebContents(event.sender);

      if (win.isMaximized()) {
        // 1. Start restoring
        win.unmaximize();

        if (isMac){
          // 2. Only consider it 'truly restored' once the size stops changing for 50ms straight
          let last = win.getNormalBounds();
          for (let i = 0; i < 10; i++) {          // At most 500ms
            await new Promise(r => setTimeout(r, 50));
            const curr = win.getNormalBounds();
            if (curr.width === last.width && curr.height === last.height) break;
            last = curr;
          }
        }else {
          // 2. Wait for the window to 'fully' become a normal state
          for (let i = 0; i < 20; i++) {          // At most 1s
            await new Promise(r => setTimeout(r, 50));
            if (!win.isMaximized()) break;        // Break out once it has truly exited
          }
        }


        // 3. Now change the assistant size; the system won't override it anymore
        win.setSize(width, height, true);
      } else {
        if (isMac) {
            win.maximize();
        }else{
            win.setSize(width, height, true);
        }
      }
    });

    ipcMain.handle('set-always-on-top', (e, flag) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      win.setAlwaysOnTop(flag, 'screen-saver');
    });
    // Window-state sync
    mainWindow.on('maximize', () => {
      mainWindow.webContents.send('window-state', 'maximized')
    })
    mainWindow.on('unmaximize', () => {
      mainWindow.webContents.send('window-state', 'normal')
    })
    
    // Window-close handling - minimize to tray instead of quitting
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault()
        mainWindow.hide()
        return false
      }
      return true
    })
    mainWindow.on('resize', () => {
      const size = mainWindow.getSize();
      mainWindow.webContents.send('window-resized', size);
    });

    // New: enhanced copy function (supports pasting as both an image and a file)
    function copyImageToClipboardWithFile(image) {
      try {
        // 1. Save the image to a temp directory
        const tempDir = os.tmpdir();
        // Generate a timestamped filename to avoid conflicts
        const fileName = `image_${Date.now()}.png`;
        const filePath = path.join(tempDir, fileName);
        
        // Convert the nativeImage to a buffer and write it to disk
        const buffer = image.toPNG();
        fs.writeFileSync(filePath, buffer);

        // 2. Prepare the clipboard data object
        const clipboardData = {
          image: image, // Write the bitmap data (for pasting into the chat box / Photoshop)
        };

        // 3. Add file-path data based on the OS (for pasting into a folder)
        if (process.platform === 'win32') {
          // --- Windows (CF_HDROP) ---
          // Build the DROPFILES struct
          // Layout: offset(4) + pt(8) + fNC(4) + fWide(4) + path(UTF16) + double-null
          const pathBuffer = Buffer.from(filePath, 'ucs2');
          const dropFiles = Buffer.alloc(20 + pathBuffer.length + 4);
          
          dropFiles.writeUInt32LE(20, 0); // pFiles (offset)
          dropFiles.writeUInt32LE(1, 16); // fWide (Unicode flag)
          pathBuffer.copy(dropFiles, 20); // Write the path
          dropFiles.writeUInt32LE(0, 20 + pathBuffer.length); // The trailing double null

          clipboardData['CF_HDROP'] = dropFiles;
          
        } else if (process.platform === 'darwin') {
          // --- macOS (NSFilenamesPboardType) ---
          // Write the property-list XML
          const plist = `
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
              <array>
                <string>${filePath}</string>
              </array>
            </plist>
          `;
          clipboardData['NSFilenamesPboardType'] = plist;
        }
        // Linux usually supports text/uri-list; omitted here, but can be added if needed

        // 4. Write all formats at once
        clipboard.write(clipboardData);
        
        console.log(`已复制图片及文件路径: ${filePath}`);

      } catch (err) {
        console.error('增强复制失败，回退到普通复制:', err);
        // On error, at least try writing the plain image
        clipboard.writeImage(image);
      }
    }

    // Modify the show-context-menu IPC handler

    ipcMain.handle('show-context-menu', async (event, { menuType, data }) => {
      let menuTemplate = [];
      const win = BrowserWindow.fromWebContents(event.sender);
      
      // Use locales[currentLanguage] directly
      const lang = locales[currentLanguage]; 

      // --- A. Image menu ---
      if (menuType === 'image') {
        menuTemplate = [
          {
            label: lang.openNewTab,
            click: () => {
              win.webContents.send('create-tab', data.src);
            }
          },
          { type: 'separator' },
          {
            label: lang.copyImageLink,
            click: () => clipboard.writeText(data.src)
          },
          {
            label: lang.copyImage,
            click: async () => {
              try {
                if (data.src.startsWith('data:')) {
                  const image = nativeImage.createFromDataURL(data.src);
                  clipboard.writeImage(image);
                } else if (data.src.startsWith('http')) {
                  const response = await fetch(data.src);
                  const blob = await response.blob();
                  const buffer = await blob.arrayBuffer();
                  const image = nativeImage.createFromBuffer(Buffer.from(buffer));
                  clipboard.writeImage(image);
                } else {
                  const image = nativeImage.createFromPath(data.src);
                  clipboard.writeImage(image);
                }
              } catch (error) {
                console.error('复制图片失败:', error);
              }
            }
          },
          {
            label: lang.saveImageAs,
            click: async () => {
              try {
                let buffer = null;
                let defaultExtension = 'png';

                if (data.src.startsWith('data:')) {
                  const image = nativeImage.createFromDataURL(data.src);
                  buffer = image.toPNG();
                } else if (data.src.startsWith('http')) {
                  const response = await fetch(data.src);
                  const blob = await response.blob();
                  buffer = Buffer.from(await blob.arrayBuffer());
                  const lowerSrc = data.src.toLowerCase();
                  if (lowerSrc.endsWith('.jpg') || lowerSrc.endsWith('.jpeg')) defaultExtension = 'jpg';
                  else if (lowerSrc.endsWith('.gif')) defaultExtension = 'gif';
                  else if (lowerSrc.endsWith('.webp')) defaultExtension = 'webp';
                } else {
                  buffer = fs.readFileSync(data.src);
                  defaultExtension = path.extname(data.src).replace('.', '') || 'png';
                }

                const { filePath } = await dialog.showSaveDialog(win, {
                  title: lang.saveImageAs,
                  defaultPath: `image_${Date.now()}.${defaultExtension}`,
                  filters: [
                    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                    { name: 'All Files', extensions: ['*'] }
                  ]
                });

                if (filePath) {
                  fs.writeFileSync(filePath, buffer);
                }
              } catch (error) {
                console.error('图片另存为失败:', error);
                dialog.showErrorBox('保存失败', '无法保存该图片: ' + error.message);
              }
            }
          }
        ];
      } 
      // --- B. Link menu ---
      else if (menuType === 'link') {
        menuTemplate = [
          {
            label: lang.openNewTab,
            click: () => {
              win.webContents.send('create-tab', data.url);
            }
          },
          { type: 'separator' },
          {
            label: lang.copyLink,
            click: () => clipboard.writeText(data.url)
          },
          {
            label: lang.copyLinkText,
            click: () => clipboard.writeText(data.text || '')
          }
        ];
      }
      // --- C. Plain-text / selection menu ---
      else if (menuType === 'text') {
        menuTemplate = [
          { label: lang.copy, role: 'copy' },
          { 
            label: `Search "${data.text.length > 15 ? data.text.slice(0, 15) + '...' : data.text}"`,
            click: () => {
               win.webContents.send('trigger-search', `Search "${data.text}"`);
            } 
          },
          { type: 'separator' },
          { label: lang.selectAll, role: 'selectAll' }
        ];
      }
      // --- D. Default / blank-area menu ---
      else {
        menuTemplate = [
          { label: lang.cut, role: 'cut' },
          { label: lang.copy, role: 'copy' },
          { label: lang.paste, role: 'paste' },
          { type: 'separator' },
          { label: lang.selectAll, role: 'selectAll' }
        ];
      }

      // --- E. Add 'Inspect Element' in dev mode ---
      if (isDev) {
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({
          label: lang.inspect,
          click: () => {
            win.webContents.openDevTools({ mode: 'detach' });
          }
        });
      }

      menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup({ window: win });
    });

    // Listen for the close event
    ipcMain.handle('request-stop-telegrambot', async (event) => {
      const win = BrowserWindow.getAllWindows()[0]; // Get the main window
      if (win && !win.isDestroyed()) {
        // Run a renderer-process method via webContents
        await win.webContents.executeJavaScript(`
          window.stopTelegramBotHandler && window.stopTelegramBotHandler()
        `);
      }
    });
    ipcMain.handle('request-stop-discordbot', async (event) => {
      const win = BrowserWindow.getAllWindows()[0]; // Get the main window
      if (win && !win.isDestroyed()) {
        // Run a renderer-process method via webContents
        await win.webContents.executeJavaScript(`
          window.stopDiscordBotHandler && window.stopDiscordBotHandler()
        `);
      }
    });
    ipcMain.handle('request-stop-slackbot', async (event) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(`
          window.stopSlackBotHandler && window.stopSlackBotHandler()
        `);
      }
    });
    ipcMain.handle('exec-command', (event, command) => {
      return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
    });
    // Other IPC handlers...
    ipcMain.on('open-external', (event, url) => {
      shell.openExternal(url)
        .then(() => console.log(`Opened ${url} in the default browser.`))
        .catch(err => console.error(`Error opening ${url}:`, err))
    })
    ipcMain.handle('readFile', async (_, path) => {
      return fs.promises.readFile(path);
    });
    // File-dialog handler
    ipcMain.handle('open-file-dialog', async (options) => {
      const allAllowed = [...ALLOWED_EXTENSIONS, ...ALLOWED_IMAGE_EXTENSIONS, ...ALLOWED_VIDEO_EXTENSIONS];
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: locales[currentLanguage].supportedFiles, extensions: allAllowed },
          { name: locales[currentLanguage].allFiles, extensions: ['*'] }
        ]
      })
      return result
    })
    ipcMain.handle('open-image-dialog', async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: locales[currentLanguage].supportedimages, extensions: ALLOWED_IMAGE_EXTENSIONS },
          { name: locales[currentLanguage].allFiles, extensions: ['*'] }
        ]
      })
      // Return an array of objects containing filename and path
      return result
    });
    ipcMain.handle('check-path-exists', (_, path) => {
      return fs.existsSync(path)
    })

  } catch (err) {
    console.error('启动失败:', err)
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close()
    }
    dialog.showErrorBox('启动失败', `服务启动失败: ${err.message}`)
    app.quit()
  }


  let currentGlobalKey = null;

  ipcMain.handle('unregister-global-shortcut', () => {
    if (currentGlobalKey) {
      globalShortcut.unregister(currentGlobalKey);
      currentGlobalKey = null;
    }
    return true;
  });

  ipcMain.handle('register-global-shortcut', (event, key) => {
    // If one was registered before, unregister it first
    if (currentGlobalKey) {
      globalShortcut.unregister(currentGlobalKey);
    }
    try {
      // Register the new shortcut
      const success = globalShortcut.register(key, () => {
        // When the global shortcut is pressed, notify the main window's frontend
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) w.webContents.send('global-shortcut-triggered');
        });
      });
      
      if (success) {
        currentGlobalKey = key;
        console.log(`[ASR] 全局快捷键 ${key} 注册成功`);
        return true;
      } else {
        console.warn(`[ASR] 全局快捷键 ${key} 注册失败，可能被系统或其他软件占用`);
        return false;
      }
    } catch (e) {
      console.error('[ASR] 全局快捷键异常:', e);
      return false;
    }
  });

  // ================= VRM text-input toggle global shortcut (separate from ASR) =================
  let currentVrmInputKey = null;

  ipcMain.handle('unregister-vrm-input-shortcut', () => {
    if (currentVrmInputKey) {
      globalShortcut.unregister(currentVrmInputKey);
      currentVrmInputKey = null;
    }
    return true;
  });

  ipcMain.handle('register-vrm-input-shortcut', (event, key) => {
    if (currentVrmInputKey) {
      globalShortcut.unregister(currentVrmInputKey);
      currentVrmInputKey = null;
    }
    if (!key) return false;
    try {
      const success = globalShortcut.register(key, () => {
        // Notify all windows; only the VRM window listens for this event
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) w.webContents.send('vrm-input-toggle-triggered');
        });
      });
      if (success) {
        currentVrmInputKey = key;
        console.log(`[VRM] text-input global shortcut ${key} registered`);
        return true;
      }
      console.warn(`[VRM] text-input global shortcut ${key} failed to register (may be taken by the system or another app)`);
      return false;
    } catch (e) {
      console.error('[VRM] text-input global shortcut error:', e);
      return false;
    }
  });
// ================= [New: workspace file-tree background logic] =================
    // 1. Read the directory contents (lazy-load)
    ipcMain.handle('read-directory', async (event, dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        const result = items.map(item => ({
          name: item.name,
          path: path.join(dirPath, item.name),
          isDirectory: item.isDirectory()
        }));

        // Sort rule: folders first, then alphabetical order
        result.sort((a, b) => {
          if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
          }
          return a.isDirectory ? -1 : 1;
        });

        return { success: true, data: result };
      } catch (error) {
        console.error('读取目录失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 2. Delete a file or folder (move to trash for safety)
    ipcMain.handle('delete-workspace-file', async (event, filePath) => {
      try {
        await shell.trashItem(filePath); // Move to the system trash; safer than fs.rm
        return { success: true };
      } catch (error) {
        console.error('删除文件失败:', error);
        return { success: false, error: error.message };
      }
    });
    // ==============================================================

// ================= [New: live-watch workspace file changes] =================
ipcMain.handle('start-workspace-watch', (event, dirPath) => {
  console.log(`[Chokidar] 请求开始监听工作区: ${dirPath}`);
  
  if (!fs.existsSync(dirPath)) {
    console.log('[Chokidar] 目录不存在，监听失败');
    return { success: false, error: 'Directory does not exist' };
  }

  // If a watcher already exists, close it first
  if (workspaceWatcher) {
    workspaceWatcher.close();
  }

  workspaceWatcher = chokidar.watch(dirPath, {
    ignored: /(^|[\/\\])\..|node_modules/, 
    persistent: true,
    ignoreInitial: true, 
    awaitWriteFinish: {  
      stabilityThreshold: 100,
      pollInterval: 50
    }
  });

  // Key fix: get the app's main window directly instead of relying on event.sender, to ensure the message definitely gets sent
  const notifyRenderer = (action, filePath) => {
    console.log(`[Chokidar] 检测到文件变化: ${action} -> ${filePath}`);
    const win = BrowserWindow.getAllWindows()[0]; // Get the main window
    if (win && !win.isDestroyed()) {
      win.webContents.send('workspace-changed', { action, path: filePath });
    }
  };

  workspaceWatcher
    .on('add', path => notifyRenderer('add', path))
    .on('unlink', path => notifyRenderer('unlink', path))
    .on('addDir', path => notifyRenderer('addDir', path))
    .on('unlinkDir', path => notifyRenderer('unlinkDir', path));

  console.log('[Chokidar] 监听已成功启动');
  return { success: true };
});

ipcMain.handle('stop-workspace-watch', () => {
  if (workspaceWatcher) {
    workspaceWatcher.close();
    workspaceWatcher = null;
    console.log('[Chokidar] 监听已停止');
  }
  return { success: true };
});
// ==============================================================

})

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// App-quit handling
app.on('before-quit', async (event) => {
  // Prevent handling the quit event repeatedly
  if (isQuitting) return;
  
  // Mark the quitting state and prevent the default quit (so we can do async work)
  isQuitting = true;
  event.preventDefault();
  
  console.log('正在准备退出应用...');

  try {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    
    // 1. Stop the frontend bots (keeps your original logic)
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.webContents.executeJavaScript(`
        if (window.stopDiscordBotHandler) window.stopDiscordBotHandler();
        if (window.stopTelegramBotHandler) window.stopTelegramBotHandler();
        if (window.stopSlackBotHandler) window.stopSlackBotHandler();
      `);
      // Give the frontend a moment to clean up
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 2. New: tell the Python backend to shut down gracefully
    // As long as PORT exists, try sending the HTTP request
    if (PORT && backendProcess) {
      try {
        console.log('通知后端执行优雅关闭...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2-second timeout

        await fetch(`http://${HOST}:${PORT}/sys/shutdown`, { 
          method: 'POST',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        // Give Python 1.5 seconds to run node_mgr.stop() inside lifespan
        console.log('等待后端清理资源...');
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (err) {
        console.log('后端优雅关闭请求失败或超时 (可能后端已关闭):', err.message);
      }
    }

    // 3. The final coup de grâce (keeps your original logic as a safeguard)
    // If Python isn't fully dead, or errored out, force-kill it
    if (backendProcess) {
      console.log('执行强制进程清理...');
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      } else {
        backendProcess.kill('SIGKILL');
      }
      backendProcess = null;
    }

  } catch (error) {
    console.error('退出时发生错误:', error);
  } finally {
    // 4. Finally quit Electron
    app.exit(0);
  }
});


// Auto-quit handling
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle renderer-process crashes
app.on('render-process-gone', (event, webContents, details) => {
  console.error('渲染进程崩溃:', details);
  console.error('退出代码:', details.exitCode, '原因:', details.reason);
  // Write the details to a file for later analysis
  fs.appendFileSync('crash.log', JSON.stringify(details) + '\n');
});
// Handle uncaught exceptions in the main process
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err)
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.close()
  }
  dialog.showErrorBox('致命错误', `未捕获异常: ${err.message}`)
  app.quit()
})

function createTray() {
  const iconPath = path.join(__dirname, 'static/source/icon_tray.png');
  if (!tray) {
    tray = new Tray(iconPath);
    tray.setToolTip('Super Agent Party');
    tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        } else {
          mainWindow.show();
        }
      }
    });
  }
  updateTrayMenu();
}
function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: locales[currentLanguage].show,
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: locales[currentLanguage].exit,
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])
  
  tray.setContextMenu(contextMenu);
}

function updatecontextMenu() {
  menu = Menu.buildFromTemplate([
    {
      label: locales[currentLanguage].cut,
      role: 'cut'
    },
    {
      label: locales[currentLanguage].copy,
      role: 'copy'
    },
    {
      label: locales[currentLanguage].paste,
      role: 'paste'
    }
  ]);
}

// app.on('web-contents-created', (e, webContents) => {
//   webContents.on('new-window', (event, url) => {
//   event.preventDefault();
//   shell.openExternal(url);
//   });
// });

app.on('web-contents-created', (event, contents) => {
  // Intercept all new-window requests (including window.open and target="_blank" inside <webview>)
  contents.setWindowOpenHandler((details) => {
    const { url } = details;
    
    // If the main window is still around, tell its Vue page to create a new tab
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('create-tab', url);
    }
    
    // Firmly prevent Electron from creating a native popup
    return { action: 'deny' };
  });

  // (keeps your original code: intercept side-button back, etc.)
  contents.on('input-event', (_ev, input) => {
    if (input.type === 'mouseDown' && (input.button === 3 || input.button === 4)) {
      contents.stopNavigation();
    }
  });
  contents.on('before-input-event', (_ev, input) => {
    const { alt, key } = input;
    if (alt && (key === 'Left' || key === 'Right')) {
      input.preventDefault = true;
    }
  });
});
app.commandLine.appendSwitch('disable-http-cache');

// --- [Modified 3] protocol-handling core function & IPC ---

// URL-handling logic
// The key part of handleProtocolUrl in main.js
function handleProtocolUrl(url) {
  if (!url) return;
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'install') {
      const type = urlObj.searchParams.get('type'); // 'mcp'
      const repo = urlObj.searchParams.get('repo');
      const mcpType = urlObj.searchParams.get('mcpType'); // 'stdio' / 'sse'
      const config = urlObj.searchParams.get('config'); // JSON string

      if (repo || config) {
        const payload = { type, repo, mcpType, config };
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
          mainWindow.webContents.send('remote-install-any', payload); 
        } else {
          pendingExtensionUrl = url; 
        }
      }
    }
  } catch (e) { console.error('协议解析失败:', e); }
}

// The corresponding check-pending-install also needs changing
ipcMain.handle('check-pending-install', () => {
  if (pendingExtensionUrl) {
    try {
      const urlObj = new URL(pendingExtensionUrl);
      const res = {
        type: urlObj.searchParams.get('type'),
        repo: urlObj.searchParams.get('repo'),
        config: urlObj.searchParams.get('config'),
        mcpType: urlObj.searchParams.get('mcpType') // New
      };
      pendingExtensionUrl = null;
      return res;
    } catch (e) { return null; }
  }
  return null;
});

// macOS listener (clicking a link on Mac triggers this)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});