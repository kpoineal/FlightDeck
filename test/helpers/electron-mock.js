'use strict';

/**
 * Module-level mocks for 'electron' and 'node-pty'.
 * Must be required BEFORE any module that depends on these packages.
 */

const Module = require('module');

const electronMock = {
  shell: { openExternal: () => {} },
  screen: { getAllDisplays: () => [] },
  app: { getPath: () => '/tmp' },
  BrowserWindow: class BrowserWindow {},
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: () => {}, send: () => {}, on: () => {}, removeListener: () => {} },
  Tray: class Tray {
    setToolTip() {}
    setContextMenu() {}
  },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
};

const nodePtyMock = {
  spawn: () => ({
    onData: () => {},
    onExit: () => {},
    kill: () => {},
    pid: 12345,
  }),
};

const os = require('os');
const path = require('path');
const fs = require('fs');

class ElectronStoreMock {
  constructor() {
    this._data = {};
    this._path = path.join(os.tmpdir(), 'flightdeck-test-store.json');
  }
  get path() { return this._path; }
  get(key) { return key == null ? undefined : this._data[key]; }
  set(key, value) {
    if (typeof key === 'object') {
      Object.assign(this._data, key);
    } else {
      this._data[key] = value;
    }
  }
  delete(key) { delete this._data[key]; }
  get store() { return { ...this._data }; }
  clear() { this._data = {}; }
}

const electronStoreMock = ElectronStoreMock;

const mocks = { electron: electronMock, 'node-pty': nodePtyMock, 'electron-store': electronStoreMock };

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request in mocks) return `__mock_${request}`;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

for (const [name, exports] of Object.entries(mocks)) {
  const id = `__mock_${name}`;
  const m = new Module(id);
  m.exports = exports;
  m.loaded = true;
  require.cache[id] = m;
}

module.exports = { electronMock, nodePtyMock };
