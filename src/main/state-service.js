'use strict';
const { migrateStateProfile } = require('./state-migration');
const { randomUUID } = require('node:crypto');

// Created once by the application, before any renderer is allowed to write.
function createStateService(profileDirectory, { demo = false } = {}) {
  let opening;
  let owner = null;
  const leases = new Map();
  const watched = new WeakSet();
  const repository = () => opening ||= migrateStateProfile(profileDirectory, { demo }).then(async repository => {
    try {
      if (await repository.call('needsMaintenance')) {
        const status = await repository.call('status');
        await repository.call('command', { commandId: `startup-${randomUUID()}`, expectedRevision: status.revision,
          type: 'maintenance', payload: {} });
      }
      return repository;
    } catch (failure) { await repository.close(); throw failure; }
  }).catch(failure => { opening = undefined; throw failure; });
  return {
    async query(method, input) {
      if (!['projection', 'getThread', 'listHistory', 'radarPage', 'today', 'sourceOwners', 'dueMonitors',
        'collisionGroups', 'previewScannerDeletion', 'status', 'listProposals', 'listRetainedEvidence'].includes(method)) {
        throw new Error('INVALID_STATE_QUERY');
      }
      return (await repository()).call(method, input);
    },
    async command(input) {
      if (input?.type === 'reseedDemo' && !demo) throw Object.assign(new Error('DEMO_ONLY'), { code: 'DEMO_ONLY' });
      return (await repository()).call('command', input);
    },
    acquireEngine(sender, request) {
      const { key, scheduled = false } = typeof request === 'string' ? { key: request } : request || {};
      if (typeof key !== 'string' || key.length > 200) return false;
      if (owner?.isDestroyed?.()) owner = null;
      if (scheduled && owner && owner !== sender) return false;
      if (scheduled) owner = sender;
      if (leases.has(key)) return false;
      leases.set(key, sender);
      if (!watched.has(sender)) {
        watched.add(sender);
        const release = () => {
          if (owner === sender) owner = null;
          for (const [id, window] of leases) if (window === sender) leases.delete(id);
        };
        sender.once('destroyed', release);
        sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (!inPlace && mainFrame) release(); });
        sender.on('render-process-gone', release);
      }
      return true;
    },
    releaseEngine(sender, key) {
      if (leases.get(key) === sender) leases.delete(key);
    },
    async close() { if (opening) await (await opening).close(); },
  };
}
module.exports = { createStateService };
