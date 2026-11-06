'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { openStateRepository } = require('./state-repository');
const hash = data => createHash('sha256').update(data).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };

function readJson(file, missing) {
  try {
    const bytes = fs.readFileSync(file);
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  }
  catch (error) {
    if (error.code === 'ENOENT') return { bytes: null, value: missing };
    fail('IMPORT_READ_FAILED');
  }
}
function syncWrite(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function atomicMarker(file, value) {
  const pending = `${file}.pending`;
  // A prior interrupted marker is not authoritative. The committed database is verified below.
  if (fs.existsSync(pending)) fs.unlinkSync(pending);
  syncWrite(pending, JSON.stringify(value, null, 2));
  fs.renameSync(pending, file);
}

async function canonicalizeState(hot, cold = [], fingerprint = 'generated') {
  const { normalizeItem, normalizeDeletedItemIds } = await import(pathToFileURL(
    path.join(__dirname, '..', 'svelte', 'lib', 'models', 'item.js')).href);
  const { normalizeActionProposal, recoverStaleExecutingActionProposal } = await import(pathToFileURL(
    path.join(__dirname, '..', 'svelte', 'lib', 'action-proposals.js')).href);
  if (!hot || typeof hot !== 'object' || Array.isArray(hot) || !Array.isArray(cold)) fail('MALFORMED_IMPORT');
  for (const key of ['items', 'trackingItems', 'radarItems', 'scanners', 'history', 'actionProposals', 'deletedItemIds']) {
    if (hot[key] !== undefined && !Array.isArray(hot[key])) fail('MALFORMED_IMPORT');
  }
  const deletedItemIds = normalizeDeletedItemIds(hot.deletedItemIds);
  const deleted = new Set(deletedItemIds);
  const assignedIds = [];
  function tier(entries, name) {
    const records = new Map();
    entries.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('MALFORMED_THREAD');
      let id = String(raw.id || '').trim();
      if (!id) {
        id = `import_${hash(JSON.stringify([name, index, raw])).slice(0, 24)}`;
        assignedIds.push({ tier: name, index, id });
      }
      if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify({ ...raw, id })) fail('DUPLICATE_ID_CONFLICT');
      records.set(id, { ...raw, id });
    });
    return records;
  }
  let hotRecords;
  if (Array.isArray(hot.items)) hotRecords = tier(hot.items, 'hot');
  else {
    hotRecords = tier(hot.trackingItems || [], 'tracking');
    for (const [id, raw] of tier(hot.radarItems || [], 'radar')) {
      if (!hotRecords.has(id)) hotRecords.set(id, raw);
    }
  }
  const merged = tier(cold, 'cold');
  const hotIds = new Set(hotRecords.keys());
  for (const [id, raw] of hotRecords) merged.set(id, raw);
  const threads = [...merged.entries()].filter(([id]) => !deleted.has(id)).map(([id, raw]) => ({
    item: normalizeItem(raw), residency: hotIds.has(id) ? 'hot' : 'cold',
  }));
  const proposals = (hot.actionProposals || []).map(raw => {
    let proposal = normalizeActionProposal(raw);
    if (!proposal) fail('MALFORMED_PROPOSAL');
    if (raw.auditOnly === true) proposal.auditOnly = true;
    if (proposal.state === 'Executing') proposal = recoverStaleExecutingActionProposal(proposal);
    return proposal;
  });
  const history = (hot.history || []).map((entry, index) => {
    if (!entry || typeof entry !== 'object') fail('MALFORMED_AUDIT');
    return { ...entry, id: entry.id || `import_audit_${hash(JSON.stringify([index, entry])).slice(0, 24)}` };
  });
  const preferences = {};
  for (const key of ['density', 'filter', 'collapsedSections', 'scannerSortPrefs', 'meetings', 'meetingsLastFetched',
    'briefingsByMeetingId', 'briefingSeenAt']) {
    if (hot[key] !== undefined) preferences[key] = hot[key];
  }
  preferences.connectionIntent = hot.connectionIntent ?? hot.connected === true;
  return {
    fingerprint, threads, scanners: hot.scanners || [], proposals, history, deletedItemIds, preferences,
    originals: { hot, cold, assignedIds },
  };
}

// Called before the first production projection; legacy domain writes are already disabled.
async function migrateStateProfile(profileDirectory, { demo = false, fault = () => {} } = {}) {
  const namespace = demo ? 'demo' : 'normal';
  const directory = path.join(profileDirectory, `state-${namespace}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const active = path.join(directory, 'state.sqlite');
  const staging = path.join(directory, 'import.sqlite');
  const marker = path.join(directory, 'backend.json');
  const markerState = readJson(marker, null).value;
  if (fs.existsSync(marker) && !markerState) fail('UNSUPPORTED_BACKEND_MARKER');
  if (markerState && (markerState.backend !== 'sqlite' || markerState.namespace !== namespace
    || markerState.schemaVersion !== 1)) fail('UNSUPPORTED_BACKEND_MARKER');
  if (fs.existsSync(marker) && !fs.existsSync(active)) fail('ACTIVE_DATABASE_MISSING');
  if (fs.existsSync(active)) {
    const repository = openStateRepository(active);
    try {
      await repository.call('integrity');
      const status = await repository.call('status');
      if (!status.importFingerprint) fail('IMPORT_INCOMPLETE');
      if (markerState?.fingerprint && markerState.fingerprint !== status.importFingerprint) fail('BACKEND_FINGERPRINT_MISMATCH');
      // An existing DB is never replaced/reimported from stale JSON.
      atomicMarker(marker, { backend: 'sqlite', schemaVersion: status.schemaVersion, namespace, fingerprint: status.importFingerprint });
      return repository;
    } catch (error) { await repository.close().catch(() => {}); throw error; }
  }
  const hot = readJson(path.join(profileDirectory, 'flightdeck-data.json'), {});
  const cold = readJson(path.join(profileDirectory, demo ? 'flightdeck-demo-cold.json' : 'flightdeck-cold.json'), {});
  if (!hot.value || typeof hot.value !== 'object' || Array.isArray(hot.value)
    || !cold.value || typeof cold.value !== 'object' || Array.isArray(cold.value)) fail('MALFORMED_STORE');
  const key = demo ? 'flightdeck.demo.v2' : 'flightdeck.persisted.v2';
  const keyed = key => Object.hasOwn(hot.value, key) ? hot.value[key]
    : key.split('.').reduce((value, part) => value?.[part], hot.value);
  const canonical = keyed(key);
  const selected = canonical !== undefined ? canonical : (!demo ? keyed('flightdeck.persisted.v1') : undefined) ?? {};
  const fingerprint = hash(Buffer.concat([hot.bytes || Buffer.alloc(0), Buffer.from('\n'), cold.bytes || Buffer.alloc(0)]));
  const input = await canonicalizeState(selected, Object.hasOwn(cold.value, 'items') ? cold.value.items : [], fingerprint);
  fault('canonicalized');
  const backupDirectory = path.join(directory, `backup-${fingerprint}`);
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  for (const [name, source] of [['hot.json', hot], ['cold.json', cold]]) {
    if (!source.bytes) continue;
    const destination = path.join(backupDirectory, name);
    if (!fs.existsSync(destination)) syncWrite(destination, source.bytes);
    const copy = fs.readFileSync(destination);
    if (hash(copy) !== hash(source.bytes)) fail('BACKUP_VERIFY_FAILED');
    JSON.parse(copy.toString('utf8'));
  }
  const manifest = path.join(backupDirectory, 'manifest.json');
  if (!fs.existsSync(manifest)) syncWrite(manifest, JSON.stringify({
    schemaVersion: 1, fingerprint, namespace, hotHash: hot.bytes ? hash(hot.bytes) : null,
    coldHash: cold.bytes ? hash(cold.bytes) : null, threads: input.threads.length,
    deleted: input.deletedItemIds.length, proposals: input.proposals.length,
    assignedIds: input.originals.assignedIds,
  }, null, 2));
  fault('backup-verified');
  // Only an inactive staging DB is eligible for restart cleanup.
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(staging + suffix)) fs.unlinkSync(staging + suffix);
  }
  const repository = openStateRepository(staging);
  try {
    await repository.call('import', input);
    fault('import-committed');
    const status = await repository.call('status');
    if (status.counts.threads !== input.threads.length) fail('IMPORT_VERIFY_FAILED');
    await repository.call('integrity');
    for (const { item } of input.threads) {
      const restored = await repository.call('getThread', { id: item.id });
      if (!restored || restored.id !== item.id
        || JSON.stringify(restored.updateHistory) !== JSON.stringify(item.updateHistory)) fail('IMPORT_VERIFY_FAILED');
    }
  } catch (error) { await repository.close().catch(() => {}); throw error; }
  await repository.close();
  fault('staging-closed');
  fs.renameSync(staging, active);
  fault('database-renamed');
  atomicMarker(marker, { backend: 'sqlite', schemaVersion: 1, fingerprint, namespace });
  fault('marker-written');
  return openStateRepository(active);
}

module.exports = { canonicalizeState, migrateStateProfile };
