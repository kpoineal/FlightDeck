'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');

// One worker per profile. No renderer is given a database path or SQL capability.
function openStateRepository(databasePath) {
  const worker = new Worker(path.join(__dirname, 'state-worker.js'), { workerData: { databasePath } });
  let sequence = 0;
  let closed = false;
  const requests = new Map();
  const fail = error => {
    closed = true;
    for (const request of requests.values()) request.reject(error);
    requests.clear();
  };
  worker.on('error', fail);
  worker.on('exit', code => fail(new Error(`STATE_WORKER_EXIT:${code}`)));
  worker.on('message', message => {
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    if (message.error) request.reject(Object.assign(new Error(message.error.code, { cause: message.error.cause }), { code: message.error.code }));
    else request.resolve(message.result);
  });
  function call(method, input = {}) {
    if (closed) return Promise.reject(new Error('STATE_REPOSITORY_CLOSED'));
    if (requests.size >= 256) return Promise.reject(new Error('STATE_QUEUE_FULL'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject });
      worker.postMessage({ id, method, input });
    });
  }
  return {
    call,
    async close() {
      if (closed) return;
      try { await call('close'); } finally { closed = true; await worker.terminate(); }
    },
  };
}
module.exports = { openStateRepository };
