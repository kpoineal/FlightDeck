const ElectronStore = require('electron-store').default || require('electron-store');
const fs = require('fs');
const { log, logError } = require('./utils');
const { measureStore } = require('./state-diagnostics');

function openSettings(name) {
  try { return new ElectronStore({ name, defaults: {} }); }
  catch (failure) {
    // Let the repository's strict importer surface the original-file refusal in the UI.
    // Never ask electron-store to clear an unreadable profile.
    const refuse = () => { throw Object.assign(new Error('SETTINGS_READ_FAILED'), { cause: failure }); };
    return { get: refuse, set: refuse, delete: refuse };
  }
}
const store = openSettings('flightdeck-data');

const coldStore = openSettings(process.argv.includes('--demo') || process.argv.includes('--demo-reseed') ? 'flightdeck-demo-cold' : 'flightdeck-cold');

function storeGet(key) {
  return measureStore('hot-get', store, () => store.get(key));
}

function storeSet(key, value) {
  measureStore('hot-set', store, () => store.set(key, value));
}

function storeDelete(key) {
  measureStore('hot-delete', store, () => store.delete(key));
}

function storeGetAll() {
  return measureStore('hot-get-all', store, () => store.store);
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
  return measureStore('cold-get', coldStore, () => coldStore.get(key));
}

function coldStoreSet(key, value) {
  measureStore('cold-set', coldStore, () => coldStore.set(key, value));
}

log('[store] Initialized at', store.path);
log('[store] Cold store at', coldStore.path);

module.exports = { storeGet, storeSet, storeDelete, storeGetAll, storeGetSize, store, coldStoreGet, coldStoreSet };
