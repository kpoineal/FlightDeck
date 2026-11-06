'use strict';
const { randomUUID } = require('node:crypto');
const { IPC_CHANNELS } = require('../shared/ipc-contract');

function createStateFlush(ipcMain, timeoutMs = 10000) {
  const pending = new Map();
  const listener = (event, token, accepted) => {
    const request = pending.get(token);
    if (request?.sender !== event.sender) return;
    request.finish(accepted === true);
  };
  ipcMain.on(IPC_CHANNELS.STATE_FLUSH_ACK, listener);
  return {
    async flush(windows) {
      return (await Promise.all(windows.filter(win => win && !win.isDestroyed()).map(win =>
        new Promise(resolve => {
          const sender = win.webContents;
          const token = randomUUID();
          const finish = result => {
            clearTimeout(timer);
            sender.removeListener?.('destroyed', destroyed);
            pending.delete(token);
            resolve(result);
          };
          const destroyed = () => finish(false);
          const timer = setTimeout(() => finish(false), timeoutMs);
          pending.set(token, { sender, finish });
          sender.once?.('destroyed', destroyed);
          try { sender.send(IPC_CHANNELS.STATE_FLUSH_REQUEST, token); } catch (_) { finish(false); }
        }),
      ))).every(Boolean);
    },
    close() {
      for (const request of [...pending.values()]) request.finish(false);
      ipcMain.removeListener(IPC_CHANNELS.STATE_FLUSH_ACK, listener);
    },
  };
}
module.exports = { createStateFlush };
