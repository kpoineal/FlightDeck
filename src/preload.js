const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
  GET_APP_VERSION: 'get-app-version',
  ASK_WORKIQ: 'ask-workiq',
  ACCEPT_WORKIQ_EULA: 'accept-workiq-eula',
  READ_PROMPT_FILE: 'read-prompt-file',
  OPEN_MARKDOWN_WINDOW: 'open-markdown-window',
  OPEN_EXTERNAL: 'open-external',
  SHOW_DESKTOP_NOTIFICATION: 'show-desktop-notification',
  OPEN_TRACKER_POPOUT: 'open-tracker-popout',
  TRACKER_STATE_CHANGED: 'tracker-state-changed',
  TRACKER_STATE_SYNC: 'tracker-state-sync',
  NOTIFICATION_CLICKED: 'notification-clicked',
  STORE_GET: 'store-get',
  STORE_SET: 'store-set',
  STORE_DELETE: 'store-delete',
  STORE_GET_ALL: 'store-get-all',
  STORE_GET_SIZE: 'store-get-size',
  STORE_MIGRATE_FROM_LOCALSTORAGE: 'store-migrate-from-localstorage',
  STORE_GET_COLD_ITEMS: 'store-get-cold-items',
  STORE_SET_COLD_ITEMS: 'store-set-cold-items',
  CHECK_FOR_UPDATES: 'check-for-updates',
};

contextBridge.exposeInMainWorld('workiq', {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES),
  ask: (question) => ipcRenderer.invoke(IPC_CHANNELS.ASK_WORKIQ, question),
  acceptEula: () => ipcRenderer.invoke(IPC_CHANNELS.ACCEPT_WORKIQ_EULA),
  readPromptFile: (filename) => ipcRenderer.invoke(IPC_CHANNELS.READ_PROMPT_FILE, filename),
  openMarkdownWindow: (payload) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_MARKDOWN_WINDOW, payload),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  showDesktopNotification: (payload) => ipcRenderer.invoke(IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION, payload),
  openTrackerPopout: (itemId) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_TRACKER_POPOUT, itemId),
  storeGet: (key) => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET, key),
  storeSet: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.STORE_SET, key, value),
  storeDelete: (key) => ipcRenderer.invoke(IPC_CHANNELS.STORE_DELETE, key),
  storeGetAll: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_ALL),
  storeGetSize: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_SIZE),
  storeMigrateFromLocalStorage: (data) => ipcRenderer.invoke(IPC_CHANNELS.STORE_MIGRATE_FROM_LOCALSTORAGE, data),
  getColdItems: () => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET_COLD_ITEMS),
  setColdItems: (items) => ipcRenderer.invoke(IPC_CHANNELS.STORE_SET_COLD_ITEMS, items),
  broadcastStateChanged: () => ipcRenderer.send(IPC_CHANNELS.TRACKER_STATE_CHANGED),
  onStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event) => callback();
    ipcRenderer.on(IPC_CHANNELS.TRACKER_STATE_SYNC, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TRACKER_STATE_SYNC, listener);
  },
  onNotificationClicked: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_CLICKED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_CLICKED, listener);
    };
  },
});
