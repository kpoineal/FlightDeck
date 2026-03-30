const ElectronStore = require('electron-store');
const fs = require('fs');
const { log, logError } = require('./utils');

const store = new ElectronStore({
  name: 'flightdeck-data',
  defaults: {},
});

const coldStore = new ElectronStore({
  name: 'flightdeck-cold',
  defaults: {},
});

function storeGet(key) {
  return store.get(key);
}

function storeSet(key, value) {
  store.set(key, value);
}

function storeDelete(key) {
  store.delete(key);
}

function storeGetAll() {
  return store.store;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function storeGetSize() {
  try {
    const stats = fs.statSync(store.path);
    return { bytes: stats.size, formatted: formatBytes(stats.size) };
  } catch (e) {
    logError('[store] Failed to get store file size:', e.message);
    return { bytes: 0, formatted: '0 B' };
  }
}

function coldStoreGet(key) {
  return coldStore.get(key);
}

function coldStoreSet(key, value) {
  coldStore.set(key, value);
}

log('[store] Initialized at', store.path);
log('[store] Cold store at', coldStore.path);

module.exports = { storeGet, storeSet, storeDelete, storeGetAll, storeGetSize, store, coldStoreGet, coldStoreSet };
