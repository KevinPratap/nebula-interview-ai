const { contextBridge, ipcRenderer } = require('electron');

// IPC channel allowlists for security
const ALLOWED_SEND_CHANNELS = ['send-to-sidecar', 'open-external-url', 'minimize-window', 'set-drawer-status', 'set-subpill-status', 're-register-hotkey', 'toggle-listening', 'update-stealth', 'set-opacity', 'set-ignore-mouse-events', 'resize-window', 'sync-hit-zones', 'quit-and-install'];
const ALLOWED_INVOKE_CHANNELS = ['get-platform', 'open-file-dialog', 'get-app-path', 'download-update', 'check-for-updates', 'check-sidecar-health'];
const ALLOWED_RECEIVE_CHANNELS = ['hotkey-action', 'hotkey-triggered', 'status-received', 'error-received', 'transcript-received', 'live-transcript-received', 'transcript-data', 'ai-response', 'ai-response-received', 'ai-chunk-received', 'sync-status', 'account-info-received', 'auth-complete-received', 'session-status-received', 'session-started-received', 'settings-data-received', 'audio-devices-data-received', 'context-update-received', 'context-count-received', 'resume-parsed-received', 'context-fetched-received', 'registration-report', 'update-status', 'update-available', 'update-ready', 'open-external-url', 'toggle-stealth', 'ready-received', 'session-status', 'saved-notes', 'notes-ready'];

// Expose as electronAPI (new API)
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, ...args) => {
    if (ALLOWED_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel, callback) => {
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  invoke: (channel, ...args) => {
    if (ALLOWED_INVOKE_CHANNELS.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error("Channel '" + channel + "' not allowed"));
  },
  removeAllListeners: (channel) => {
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});

// Also expose as window.electron.ipcRenderer (legacy API that App.tsx uses)
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, ...args) => {
      if (ALLOWED_SEND_CHANNELS.includes(channel)) {
        ipcRenderer.send(channel, ...args);
      }
    },
    on: (channel, callback) => {
      if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }
    },
    invoke: (channel, ...args) => {
      if (ALLOWED_INVOKE_CHANNELS.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error("Channel '" + channel + "' not allowed"));
    },
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});
