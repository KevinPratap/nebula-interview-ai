const electron = require('electron');
const { app, BrowserWindow, ipcMain, globalShortcut, Menu, Tray, nativeImage, dialog, screen } = electron;
const { autoUpdater } = require('electron-updater');
const { join, dirname } = require('path');
const { spawn } = require('child_process');
const { readFileSync, writeFileSync, appendFileSync, existsSync } = require('fs');

// Initialize quit flag
app.isQuitting = false;

// Set quit flag when app is actually quitting (fixes tray Quit button)
app.on('before-quit', () => {
    app.isQuitting = true;
});

let LOG_FILE = null;
const logBuffer = [];
function logToFile(msg) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${msg}\n`;
    if (!LOG_FILE) {
        logBuffer.push(formatted);
        console.log(formatted);
        return;
    }
    try {
        appendFileSync(LOG_FILE, formatted);
    } catch (e) { }
}

let mainWindow = null;
let sidecarProcess = null;
let tray = null;
let sidecarRestartAttempts = 0;
let sidecarEverStarted = false;
const windowStatePath = join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        if (existsSync(windowStatePath)) {
            const data = readFileSync(windowStatePath, 'utf8');
            const state = JSON.parse(data);

            // Validate saved position against available displays
            if (state.x !== undefined && state.y !== undefined) {
                const displays = screen.getAllDisplays();
                const onScreen = displays.some(display => {
                    const margin = 100; // allow window to be partially off-screen by up to 100px
                    return state.x >= display.bounds.x - margin &&
                           state.x < display.bounds.x + display.bounds.width - 100 + margin &&
                           state.y >= display.bounds.y - margin &&
                           state.y < display.bounds.y + display.bounds.height - 100 + margin;
                });

                if (!onScreen) {
                    // Position is off-screen — default to right side of primary display
                    const primary = screen.getPrimaryDisplay();
                    state.x = primary.workArea.x + primary.workArea.width - 900;
                    state.y = primary.workArea.y;
                    logToFile(`Main: Window position off-screen, resetting to [${state.x}, ${state.y}]`);
                }
            }

            return state;
        }
    } catch (e) {
        logToFile(`Main: Error loading window state: ${e.message}`);
    }
    return { width: 900, height: 720 }; // Default v1.1.0
}

function saveWindowState(bounds) {
    try {
        writeFileSync(windowStatePath, JSON.stringify(bounds));
    } catch (e) {
        logToFile(`Main: Error saving window state: ${e.message}`);
    }
}

logToFile("Main: App script loading...");

function createWindow() {
    logToFile("Main: Creating window...");
    const savedState = loadWindowState();
    
    mainWindow = new BrowserWindow({
        x: savedState.x,
        y: savedState.y,
        width: 900,
        height: 54,
        show: false,
        autoHideMenuBar: true,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: false,
        maximizable: false,
        fullscreenable: false,
        icon: join(__dirname, process.platform === 'win32' ? 'public/logo.ico' : 'public/logo.png'),
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            sandbox: false,
            contextIsolation: true
        }
    });

    // Save state on move or resize (debounced via event)
    let saveTimeout;
    const updateState = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            if (!mainWindow.isDestroyed()) {
                saveWindowState(mainWindow.getBounds());
            }
        }, 500);
    };

    mainWindow.on('move', updateState);
    mainWindow.on('resize', updateState);

    const devUrl = 'http://localhost:5180';
    const isDev = false;

    const loadWithRetry = (url, attempts = 0) => {
        // Pre-flight: check index.html exists
        const indexPath = join(__dirname, 'dist', 'index.html');
        if (!isDev && !existsSync(indexPath)) {
            console.error(`UI bundle not found at ${indexPath}. Run 'npx vite build' first.`);
            dialog.showErrorBox('Nebula - Build Error', 
                `UI bundle not found at:\n${indexPath}\n\nRun 'npx vite build' in the app directory.`);
            mainWindow.loadURL(`data:text/html,<html><body style="background:#0a0a0c;color:#ccc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#e44">Build Error</h1><p>UI bundle not found.</p><p style="font-size:12px;color:#888">Run <code>npx vite build</code></p></div></body></html>`);
            mainWindow.show();
            return;
        }

        const loadPromise = isDev
            ? mainWindow.loadURL(url)
            : mainWindow.loadFile(indexPath);

        loadPromise.then(() => {
            console.log(`Successfully loaded UI`);
            mainWindow.show();
            console.log('Main: Window should be visible now. isVisible:', mainWindow.isVisible());
            mainWindow.focus();
        }).catch(e => {
            if (isDev && attempts < 20) {
                console.log(`Failed to load dev URL, retrying in 1s... (${attempts + 1}/20)`);
                setTimeout(() => loadWithRetry(url, attempts + 1), 1000);
            } else {
                console.error(`Failed to load UI:`, e);
                // Show fallback error page
                mainWindow.loadURL(`data:text/html,<html><body style="background:#0a0a0c;color:#ccc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#e44">UI Load Error</h1><p style="color:#999">${e.message || 'Unknown error'}</p></div></body></html>`);
                mainWindow.show();
            }
        });
    };

    // Minimize to tray on close instead of quitting (v1.3.0)
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });

    loadWithRetry(devUrl);

    createTray();
    setTimeout(() => {
        logToFile("Main: Initializing global shortcuts (5s delay)...");
        console.log("Main: Initializing global shortcuts...");
        registerShortcuts();
    }, 5000);
    setupAutoUpdater(); // One-time setup v1.1.1
    startSidecar();
}

function createTray() {
    const iconPath = join(__dirname, process.platform === 'win32' ? 'public/logo.ico' : 'public/logo.png');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 20, height: 20 }));

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Assistant', click: () => mainWindow?.show() },
        { label: 'Hide Assistant', click: () => mainWindow?.hide() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setToolTip('Nebula Assistant');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow?.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow?.show();
            mainWindow?.focus();
        }
    });

    tray.on('double-click', () => {
        mainWindow?.show();
        mainWindow?.focus();
    });
}

function registerShortcuts(config = {}) {
    logToFile(`Main: registerShortcuts called with ${JSON.stringify(config)}`);
    globalShortcut.unregisterAll();
    logToFile("Main: [DEBUG] All shortcuts unregistered.");

    // Test Key: See if ANYTHING can register
    try {
        const testKey = 'Control+Shift+K';
        const testSuccess = globalShortcut.register(testKey, () => {
            logToFile("Main: [HOTKEY EVENT] Control+Shift+K -> TEST SUCCESS");
            mainWindow?.webContents.send('status-received', { msg: "TEST KEY FIRED", is_error: false });
        });
        logToFile(`Main: [DEBUG] Test Key (${testKey}) Registration -> ${testSuccess}`);
    } catch (e) {
        logToFile(`Main: [DEBUG] Test Key Exception: ${e.message}`);
    }

    const keys = {
        activation: config.hotkey || 'F2',
        manual: config.hotkey_manual || 'Alt+Z',
        chat: config.hotkey_chat || 'Alt+C',
        strategy: config.hotkey_strategy || 'Alt+S',
        settings: config.hotkey_settings || 'Alt+,',
        scan: config.hotkey_screen || 'Alt+X',
        history: config.hotkey_history || 'Alt+H',
        retry: config.hotkey_retry || 'Alt+R',
        close: config.hotkey_close || 'Alt+W'
    };

    const registrationStats = [];

    const safeRegister = (key, action, ipcChannel = 'hotkey-action') => {
        if (!key || key === 'NONE' || key === 'None') {
            registrationStats.push({ action, key: 'DISABLED', success: true });
            return;
        }

        try {
            // Check if already taken
            if (globalShortcut.isRegistered(key)) {
                logToFile(`Main: [CONFLICT] ${key} is ALREADY IN USE. External App or Duplicate Nebula Binding?`);
            }

            const success = globalShortcut.register(key, () => {
                logToFile(`Main: [HOTKEY EVENT] ${key} -> ${action}`);
                console.log(`Main: [HOTKEY EVENT] ${key} -> ${action}`);

                if (!mainWindow) {
                    logToFile(`Main: Hotkey fired but mainWindow is NULL`);
                    console.error("Main: Hotkey fired but mainWindow is NULL");
                    return;
                }

                // Visual feedback to UI immediately
                mainWindow.webContents.send('status-received', { msg: `EVENT: ${key}`, is_error: false });

                // Ensure window is visible/focused if it's a UI-opening action
                if (action.startsWith('toggle') || action === 'activation') {
                    if (!mainWindow.isVisible()) {
                        logToFile(`Main: Showing window for ${action}`);
                        console.log(`Main: Showing window for ${action}`);
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }

                if (ipcChannel === 'hotkey-triggered') {
                    mainWindow.webContents.send('hotkey-triggered');
                } else {
                    mainWindow.webContents.send('hotkey-action', action);
                }
            });

            registrationStats.push({ action, key, success });

            if (!success) {
                logToFile(`Main: Failed to register hotkey: ${key} for ${action}`);
                console.error(`Main: Failed to register hotkey: ${key} for ${action}`);
                mainWindow?.webContents.send('status-received', { msg: `HOTKEY ${key} BUSY`, is_error: true });
            } else {
                logToFile(`Main: Successfully registered ${key} for ${action}`);
                console.log(`Main: Successfully registered ${key} for ${action}`);
            }
        } catch (e) {
            console.error(`Hotkey registration exception for ${key}:`, e);
            registrationStats.push({ action, key, success: false, error: e.message });
        }
    };

    safeRegister(keys.activation, 'activation', 'hotkey-triggered');
    safeRegister(keys.manual, 'trigger-manual');
    safeRegister(keys.chat, 'toggle-chat');
    safeRegister(keys.strategy, 'toggle-strategy');
    safeRegister(keys.settings, 'toggle-settings');
    safeRegister(keys.scan, 'trigger-scan');
    safeRegister(keys.history, 'toggle-history');
    safeRegister(keys.retry, 'trigger-retry');
    safeRegister(keys.close, 'trigger-close-drawer');

    // --- System / Fixed Hotkeys ---

    // Alt+Space: Show/Hide Toggle (v51.42: Check if user already took this key)
    if (!Object.values(keys).includes('Alt+Space')) {
        try {
            const success = globalShortcut.register('Alt+Space', () => {
                logToFile("Main: [HOTKEY EVENT] Alt+Space -> hide/show");
                if (mainWindow?.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow?.show();
                    mainWindow?.focus();
                }
            });
            registrationStats.push({ action: 'hide-show', key: 'Alt+Space', success });
        } catch (e) {
            logToFile(`Main: Exception registering Alt+Space: ${e.message}`);
        }
    } else {
        logToFile("Main: Custom Hotkey overrides Alt+Space System Shortcut.");
    }

    // Window Positioning
    const posKeys = [
        { key: 'Alt+Shift+1', zone: 'top' },
        { key: 'Alt+Shift+2', zone: 'middle' },
        { key: 'Alt+Shift+3', zone: 'bottom' }
    ];

    posKeys.forEach(({ key, zone }) => {
        try {
            const success = globalShortcut.register(key, () => {
                logToFile(`Main: [HOTKEY EVENT] ${key} -> reposition ${zone}`);
                console.log(`Main: [HOTKEY EVENT] ${key} -> reposition ${zone}`);
                repositionWindow(zone);
            });
            registrationStats.push({ action: `reposition-${zone}`, key, success });
            logToFile(`Main: Registered ${key} (reposition-${zone}) -> ${success}`);
        } catch (e) {
            logToFile(`Main: Exception registering ${key}: ${e.message}`);
            registrationStats.push({ action: `reposition-${zone}`, key, success: false, error: e.message });
        }
    });

    // Report back to UI
    mainWindow?.webContents.send('registration-report', registrationStats);
}

function setupAutoUpdater() {
    // --- Auto-Update Lifecycle (v51.35) ---
    autoUpdater.autoDownload = false;

    autoUpdater.on('checking-for-update', () => {
        mainWindow?.webContents.send('update-status', 'Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
        mainWindow?.webContents.send('update-status', 'Update available!');
        mainWindow?.webContents.send('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
        mainWindow?.webContents.send('update-status', 'Up to date.');
    });

    autoUpdater.on('error', (err) => {
        mainWindow?.webContents.send('update-status', `Error: ${err.message}`);
    });

    autoUpdater.on('download-progress', (progressObj) => {
        mainWindow?.webContents.send('update-status', `Downloading: ${Math.round(progressObj.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        mainWindow?.webContents.send('update-status', 'Update downloaded');
        mainWindow?.webContents.send('update-ready');
    });

    // --- IPC Handlers for Updates (Single Registration v1.1.1) ---
    ipcMain.handle('check-for-updates', async () => {
        return autoUpdater.checkForUpdates();
    });

    ipcMain.handle('download-update', async () => {
        return autoUpdater.downloadUpdate();
    });

    ipcMain.on('quit-and-install', () => {
        autoUpdater.quitAndInstall();
    });

    // Check for updates on startup
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 5000);
}

function repositionWindow(zone) {
    if (!mainWindow) return;
    const { width: winWidth, height: winHeight } = mainWindow.getBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: scrWidth, height: scrHeight } = primaryDisplay.workArea; // Work Area v1.2.8
    const { x: scrX, y: scrY } = primaryDisplay.workArea;

    const x = scrX + Math.floor((scrWidth - winWidth) / 2);
    let y = scrY;

    if (zone === 'top') {
        y = scrY; // Exactly at screen top (v1.2.9)
    } else if (zone === 'middle') {
        // Vertical center of the PILL (at y=20) must be screen center (scrHeight/2)
        y = scrY + Math.floor((scrHeight / 2) - 20 - 24);
    } else if (zone === 'bottom') {
        // Window Y = (Bottom of Work Area) - 40 (margin) - 48 (pill) - 20 (padding)
        y = scrY + scrHeight - 40 - 48 - 20;
    }

    mainWindow.setPosition(x, y, true);
    console.log(`Main: Repositioned window to ${zone} -> [${x}, ${y}]`);
}

function startSidecar() {
    const rootDir = app.isPackaged ? dirname(app.getPath('exe')) : __dirname;
    let pythonPath;
    let scriptPath;
    let args;

    if (app.isPackaged) {
        pythonPath = join(process.resourcesPath, 'engine_sidecar.exe');
        scriptPath = ''; // Not needed for EXE
        args = [];
    } else {
        pythonPath = join(rootDir, '.venv/Scripts/python.exe');
        scriptPath = join(rootDir, 'engine_sidecar.py');
        args = [scriptPath];
    }

    logToFile(`Main: Starting sidecar from ${pythonPath}`);
    logToFile(`Main: Sidecar CWD: ${rootDir}`);

    sidecarProcess = spawn(pythonPath, args, {
        cwd: rootDir,
        env: { 
            ...process.env, 
            PYTHONUNBUFFERED: '1', 
            // HTTPS verification enabled (removed PYTHONHTTPSVERIFY flag)
            NEBULA_USER_DATA: app.getPath('userData')
        },
        windowsHide: true
    });

    sidecarProcess.on('error', (err) => {
        logToFile(`Main: Failed to start sidecar: ${err.message}`);
        console.error('Failed to start sidecar:', err);
        // Show error to user
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('error-received', { msg: `Sidecar failed to start: ${err.message}. Check Python setup.` });
        }
        // Also log to file for non-window startup detection
        logToFile(`Main: Sidecar error shown to user: ${err.message}`);
    });

    let restartAttempts = 0;
    const MAX_RESTARTS = 5;

    sidecarProcess.on('exit', (code, signal) => {
        logToFile(`Sidecar Process exited with code ${code} and signal ${signal}`);

        // Reset attempts on clean exit (code 0 = intentional shutdown)
        if (code === 0) {
            sidecarRestartAttempts = 0;
            logToFile(`Sidecar exited cleanly. No restart needed.`);
            return;
        }

        // Exponential backoff: 2s, 4s, 8s, 16s, 32s, capped at 60s
        sidecarRestartAttempts++;
        const delay = Math.min(2000 * Math.pow(2, sidecarRestartAttempts - 1), 60000);
        logToFile(`Sidecar crashed! Attempting restart ${sidecarRestartAttempts} in ${delay}ms...`);

        // Notify UI
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('status-received', { msg: `Sidecar restarting (${sidecarRestartAttempts})...`, is_error: false });
        }

        setTimeout(() => {
            if (!app.isQuitting) {
                startSidecar();
            }
        }, delay);
    });

    let sidecarBuffer = '';
    let sidecarStarted = false;

    sidecarProcess.stdout.on('data', (data) => {
        // Sidecar sent data = it's alive. Reset restart counter on first message.
        if (!sidecarStarted) {
            sidecarStarted = true;
            sidecarRestartAttempts = 0;
            logToFile(`Sidecar confirmed alive. Restart counter reset.`);
        }

        sidecarBuffer += data.toString();
        const lines = sidecarBuffer.split('\n');

        // Keep the last partial line in the buffer
        sidecarBuffer = lines.pop();

        lines.filter(l => l.trim()).forEach(line => {
            try {
                const json = JSON.parse(line);
                if (json.type === 'open-external-url') {
                    const { shell } = require('electron');
                    logToFile(`Main: [SIDE CAR] Intercepted OAuth URL: ${json.payload}`);
                    shell.openExternal(json.payload);
                }
                if (json.type !== 'volume') {
                    console.log(`Main: Routing ${json.type} to UI`);
                }
                mainWindow?.webContents.send(`${json.type}-received`, json.payload);
            } catch (e) {
                // If it's not JSON, it's a debug log
                console.log('Sidecar Raw:', line);
            }
        });
    });

    sidecarProcess.stderr.on('data', (data) => {
        console.error(`Sidecar Error: ${data}`);
    });

    // Forward Main stdin to Sidecar for manual testing (Diagnostic)
    process.stdin.on('data', (data) => {
        if (sidecarProcess) {
            sidecarProcess.stdin.write(data);
        }
    });
}

ipcMain.on('toggle-listening', (_, enabled) => {
    console.log(`Main: Received toggle-listening -> ${enabled}`);
    if (sidecarProcess) {
        console.log(`Main: Sending toggle-listening to sidecar -> ${enabled}`);
        sidecarProcess.stdin.write(JSON.stringify({ action: 'toggle-listening', payload: enabled }) + '\n');
    }
});

ipcMain.handle('get-platform', () => {
    console.log('Main: IPC [get-platform] invoke');
    return process.platform;
});

ipcMain.on('set-opacity', (_, level) => {
    if (mainWindow) {
        mainWindow.setOpacity(level / 255);
    }
});

ipcMain.on('update-stealth', (_, enabled) => {
    if (mainWindow) {
        mainWindow.setContentProtection(enabled);
        mainWindow.setSkipTaskbar(enabled);
    }
});

ipcMain.on('resize-window', (_, { width, height }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const { width: currentW, height: currentH } = mainWindow.getBounds();
        
        // Dynamic Resolution Awareness (v1.2.8)
        const primaryDisplay = screen.getPrimaryDisplay();
        const { height: workHeight } = primaryDisplay.workArea;
        
        // Max height is workHeight minus bottom margin (40px)
        const maxSafeHeight = workHeight - 40;
        
        // Constraints: Min height 100, Max height synced to Screen Resolution
        const targetH = Math.min(Math.max(height, 100), maxSafeHeight);
        
        if (targetH !== currentH) {
            mainWindow.setSize(width || currentW, targetH, true);
        }
    }
});

ipcMain.on('sync-hit-zones', (_, { height }) => {
    currentAppHeight = height;
});

ipcMain.on('open-external-url', (_, url) => {
    logToFile(`Main: [IPC] Opening external URL: ${url}`);
    const { shell } = require('electron');
    shell.openExternal(url);
    
    // v51.42: If AlwaysOnTop is enabled, it blocks the browser.
    // We temporarily disable it so the user can interact with the browser.
    if (mainWindow && mainWindow.isAlwaysOnTop()) {
        mainWindow.setAlwaysOnTop(false);
        // Return to AlwaysOnTop after 30 seconds or when window regained focus
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(true);
            }
        }, 30000);
    }
});

ipcMain.on('re-register-hotkey', (_, config) => {
    logToFile(`Main: [IPC] re-register-hotkey received with ${JSON.stringify(config)}`);
    registerShortcuts(config);
});

ipcMain.handle('open-file-dialog', async () => {
    if (!mainWindow) return null;
    
    // Temporarily disable AlwaysOnTop so dialog is visible
    const wasAlwaysOnTop = mainWindow.isAlwaysOnTop();
    if (wasAlwaysOnTop) mainWindow.setAlwaysOnTop(false);

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Documents', extensions: ['txt', 'pdf', 'doc', 'docx'] }]
    });

    // Restore AlwaysOnTop status
    if (wasAlwaysOnTop) mainWindow.setAlwaysOnTop(true);

    if (!canceled && filePaths.length > 0) {
        return filePaths.map(path => ({ type: 'link', path }));
    }
    return null;
});

ipcMain.on('send-to-sidecar', (event, { action, payload }) => {
    console.log(`Main: IPC [send-to-sidecar] action=${action}`);
    if (sidecarProcess && sidecarProcess.stdin.writable) {
        
        // Enrich payload with display info if it's a vision/trigger action (v51.65)
        if (action === "analyze-screen" || action === "trigger-ai" || action === "capture-snapshot") {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                const bounds = win.getBounds();
                const currentDisplay = screen.getDisplayMatching(bounds);
                console.log(`Main: Enrichment - Window Bounds: ${JSON.stringify(bounds)}, Matches Display: ${JSON.stringify(currentDisplay.bounds)}`);
                payload = { 
                    ...payload, 
                    display_info: {
                        x: currentDisplay.bounds.x,
                        y: currentDisplay.bounds.y,
                        width: currentDisplay.bounds.width,
                        height: currentDisplay.bounds.height
                    }
                };
            }
        }
        
        logToFile(`Main: Routing ${action} to sidecar with payload: ${JSON.stringify(payload)}`);
        const msg = JSON.stringify({ action, payload: payload || {} }) + '\n';
        sidecarProcess.stdin.write(msg);
    } else {
        logToFile(`Main: [CRITICAL] Cannot send ${action}, sidecar not available or stdin locked`);
        console.error(`Main: Cannot send ${action}, sidecar not available`);
    }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setIgnoreMouseEvents(ignore, options);
});

let isDrawerOpen = false;
let isSubPillActive = false;
let currentAppHeight = 54; // Default v1.2.7
let mouseMonitorInterval = null;
let cachedBounds = null;

// IPC: minimize to tray (v1.3.0)
ipcMain.on('minimize-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
    }
});

// IPC: sidecar health check (v1.3.0)
ipcMain.handle('check-sidecar-health', () => {
    return {
        alive: sidecarProcess !== null && !sidecarProcess.killed,
        pid: sidecarProcess?.pid || null
    };
});

ipcMain.on('set-drawer-status', (_, open) => {
    isDrawerOpen = open;
});

ipcMain.on('set-subpill-status', (_, active) => {
    isSubPillActive = active;
});

function startMouseMonitor() {
    if (mouseMonitorInterval) clearInterval(mouseMonitorInterval);

    // Refresh bounds immediately
    if (mainWindow) cachedBounds = mainWindow.getBounds();

    // Update bounds on window move/resize to avoid redundant getBounds() calls in polling loop
    mainWindow?.on('move', () => { cachedBounds = mainWindow.getBounds(); });
    mainWindow?.on('resize', () => { cachedBounds = mainWindow.getBounds(); });

    mouseMonitorInterval = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !cachedBounds) return;

        try {
            const point = screen.getCursorScreenPoint();
            const bounds = cachedBounds;

            const isWithinWin = (
                point.x >= bounds.x &&
                point.x <= bounds.x + bounds.width &&
                point.y >= bounds.y &&
                point.y <= bounds.y + bounds.height
            );

            if (!isWithinWin) {
                if (mainWindow.isIgnored !== true) {
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                    mainWindow.isIgnored = true;
                }
                return;
            }

            const rx = point.x - bounds.x;
            const ry = point.y - bounds.y;

            // V51.39 Audit Fix: Exact hit-zones for 800px pill centered in 900px window
            // RX: (900-800)/2 = 50px to 850px
            const overPill = (rx >= 50 && rx <= 850 && ry >= 0 && ry <= 54);
            
            // Sub-Pill Hit Zone: ONLY if active and drawer is closed
            // rx bounds added to ensure side margins are clickable v51.90
            const overSubPills = !isDrawerOpen && isSubPillActive && (rx >= 50 && rx <= 850 && ry > 54 && ry <= 120);
            
            // Drawer Hit Zone: rx bounds added to ensure side margins are clickable v51.90
            // Dynamic Height Sync: ry uses the reported content height v1.2.7
            const overDrawer = isDrawerOpen && (rx >= 50 && rx <= 850 && ry >= 0 && ry <= currentAppHeight + 120);

            if (overPill || overSubPills || overDrawer) {
                if (mainWindow.isIgnored !== false) {
                    mainWindow.setIgnoreMouseEvents(false);
                    mainWindow.isIgnored = false;
                }
            } else {
                if (mainWindow.isIgnored !== true) {
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                    mainWindow.isIgnored = true;
                }
            }
        } catch (e) {
            console.error("Mouse monitor error:", e);
        }
    }, 100); // Decreased to 100ms for faster click-through response v51.90
}

app.whenReady().then(() => {
    LOG_FILE = join(app.getPath('userData'), 'nebula_debug.log');
    logBuffer.forEach(line => {
        try { appendFileSync(LOG_FILE, line); } catch (e) { }
    });
    logToFile("Main: App Ready. LOG_FILE initialized.");
    createWindow();
    startMouseMonitor();
});

app.on("will-quit", () => {
    if (mouseMonitorInterval) clearInterval(mouseMonitorInterval);
    globalShortcut.unregisterAll();
    if (sidecarProcess) sidecarProcess.kill();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
