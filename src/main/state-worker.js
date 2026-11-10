'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync, backup } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createHash } = require('node:crypto');
let db;
let itemModel;
let proposalModel;
let scannerModel;
let todayModel;
let mailbox;
let inboxFilters;
const dirtyTodayThreads = new Set();
let resetTodayProjection = false;
const todayProjectionStats = { threadsRebuilt: 0, eventsRead: 0 };
const SCHEMA_VERSION = 1;
const RADAR_ACTIVITY_ORDER = "coalesce(json_extract(detail,'$.lastChangedAt'),json_extract(detail,'$.lastRunAt'),json_extract(detail,'$.discoveredAt'),json_extract(detail,'$.trackedAt'),'') DESC,id";
const json = value => JSON.stringify(value);
const parse = value => JSON.parse(value);
const error = code => { throw Object.assign(new Error(code), { code }); };

const ready = (async () => {
  [itemModel, proposalModel, scannerModel, todayModel, mailbox, inboxFilters] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, '..', 'svelte', 'lib', 'models', 'item.js')).href),
    import(pathToFileURL(path.join(__dirname, '..', 'svelte', 'lib', 'action-proposals.js')).href),
    import(pathToFileURL(path.join(__dirname, '..', 'svelte', 'lib', 'models', 'scanner.js')).href),
    import(pathToFileURL(path.join(__dirname, '..', 'svelte', 'lib', 'today.js')).href),
    import(pathToFileURL(path.join(__dirname, '..', 'svelte', 'lib', 'mailbox.js')).href),
    import(pathToFileURL(path.join(__dirname, '..', 'svelte', 'lib', 'inbox-filters.js')).href),
  ]);
  db = new DatabaseSync(workerData.databasePath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > SCHEMA_VERSION) error('NEWER_SCHEMA');
  if (version === 0) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length) error('UNKNOWN_SCHEMA');
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata VALUES('revision','0');
      CREATE TABLE scanners(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE threads(
        id TEXT PRIMARY KEY, scanner_id TEXT REFERENCES scanners(id), residency TEXT NOT NULL,
        lifecycle TEXT NOT NULL, changed_at TEXT NOT NULL, revision INTEGER NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX threads_lifecycle ON threads(lifecycle,changed_at,id);
      CREATE INDEX threads_scanner ON threads(scanner_id,lifecycle,id);
      CREATE INDEX threads_residency ON threads(residency,id);
      CREATE TABLE thread_sources(thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
        identity TEXT NOT NULL, PRIMARY KEY(thread_id,identity));
      CREATE INDEX source_identity ON thread_sources(identity,thread_id);
      CREATE TABLE thread_events(thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, timestamp TEXT, kind TEXT, detail TEXT NOT NULL, PRIMARY KEY(thread_id,ordinal));
      CREATE INDEX event_time ON thread_events(timestamp,kind);
      CREATE TABLE retained_events(thread_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        detail TEXT NOT NULL, PRIMARY KEY(thread_id,ordinal));
      CREATE TABLE deleted_items(id TEXT PRIMARY KEY);
      CREATE TABLE scanner_exclusions(scanner_id TEXT REFERENCES scanners(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL, PRIMARY KEY(scanner_id,item_id));
      CREATE TABLE proposals(id TEXT PRIMARY KEY, source_item_id TEXT, state TEXT NOT NULL, revision INTEGER NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX proposal_source ON proposals(source_item_id,state);
      CREATE TABLE audit_events(id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, at TEXT, detail TEXT NOT NULL);
      CREATE INDEX audit_time ON audit_events(at,id);
      CREATE TABLE preferences(key TEXT PRIMARY KEY, detail TEXT NOT NULL);
      CREATE TABLE command_receipts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE import_originals(key TEXT PRIMARY KEY, detail TEXT NOT NULL);
      PRAGMA user_version=1;
      COMMIT;
    `);
  }
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec(`CREATE INDEX IF NOT EXISTS threads_activity ON threads(
    coalesce(json_extract(detail,'$.lastChangedAt'),json_extract(detail,'$.lastRunAt'),
    json_extract(detail,'$.discoveredAt'),json_extract(detail,'$.trackedAt'),''),id);
    CREATE INDEX IF NOT EXISTS threads_monitor ON threads(
      json_extract(detail,'$.monitorEnabled'),json_extract(detail,'$.nextRunAt'),id);
    CREATE INDEX IF NOT EXISTS event_proposal ON thread_events(json_extract(detail,'$.proposalId'));
    CREATE INDEX IF NOT EXISTS event_latest_lifecycle ON thread_events(thread_id,timestamp DESC,ordinal)
      WHERE kind='lifecycle' AND json_extract(detail,'$.summary')<>'Status changed to archived';
    CREATE INDEX IF NOT EXISTS threads_archive_page ON threads(
      (lifecycle='archived' OR json_extract(detail,'$.archived')=1),
      coalesce(json_extract(detail,'$.lastChangedAt'),json_extract(detail,'$.lastRunAt'),
        json_extract(detail,'$.discoveredAt'),json_extract(detail,'$.trackedAt'),'') DESC,id);
    CREATE INDEX IF NOT EXISTS threads_view_counts ON threads(lifecycle,
      coalesce(json_extract(detail,'$.archived'),0),json_extract(detail,'$.snoozeUntil'),
      json_extract(detail,'$.severity'),json_extract(detail,'$.monitorEnabled'));
    CREATE INDEX IF NOT EXISTS events_unread ON thread_events(thread_id)
      WHERE json_extract(detail,'$.seen')=0;
    CREATE INDEX IF NOT EXISTS threads_unread_flags ON threads(
      json_extract(detail,'$.isNew'),json_extract(detail,'$.hasNewUpdate'),id);
    CREATE INDEX IF NOT EXISTS threads_severity ON threads(lower(json_extract(detail,'$.severity')),id);`);
  checkIntegrity();
})();

function revision() { return Number(db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value); }
function setMeta(key, value) {
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(key, String(value));
}
function checkIntegrity() {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') error('INTEGRITY_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length) error('FOREIGN_KEY_FAILED');
  return { ok: true };
}
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (failure) { db.exec('ROLLBACK'); throw failure; }
}
function getThread(id) {
  const row = db.prepare('SELECT * FROM threads WHERE id=?').get(id);
  if (!row) return null;
  const events = db.prepare('SELECT detail FROM thread_events WHERE thread_id=? ORDER BY ordinal').all(id).map(row => parse(row.detail));
  return { ...parse(row.detail), updateHistory: events, repositoryRevision: row.revision, residency: row.residency };
}
function putThread(raw, residency, nextRevision) {
  dirtyTodayThreads.add(raw.id);
  const normalized = itemModel.normalizeItem(raw);
  if (db.prepare('SELECT 1 FROM deleted_items WHERE id=?').get(normalized.id)) error('DELETED');
  let scannerId = normalized.scannerId || null;
  if (scannerId && !db.prepare('SELECT 1 FROM scanners WHERE id=?').get(scannerId)) {
    normalized.importedScannerId = scannerId;
    scannerId = null;
    normalized.scannerId = null;
  }
  const { updateHistory, repositoryRevision, residency: ignored, ...detail } = normalized;
  db.prepare(`INSERT INTO threads VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET scanner_id=excluded.scanner_id,residency=excluded.residency,
    lifecycle=excluded.lifecycle,changed_at=excluded.changed_at,revision=excluded.revision,detail=excluded.detail`)
    .run(normalized.id, scannerId, residency, normalized.lifecycleStatus || 'unknown',
      normalized.lastChangedAt || normalized.discoveredAt || '', nextRevision, json(detail));
  db.prepare('DELETE FROM thread_sources WHERE thread_id=?').run(normalized.id);
  for (const identity of itemModel.collectItemSourceIdentities(normalized)) {
    db.prepare('INSERT OR IGNORE INTO thread_sources VALUES(?,?)').run(normalized.id, identity);
  }
  db.prepare('DELETE FROM thread_events WHERE thread_id=?').run(normalized.id);
  itemModel.capItemUpdateHistory(updateHistory).forEach((event, ordinal) => {
    db.prepare('INSERT INTO thread_events VALUES(?,?,?,?,?)').run(normalized.id, ordinal, event.timestamp || null, event.kind || null, json(event));
  });
  return normalized.id;
}
  function projectThread(id) {
    const row = db.prepare('SELECT detail,revision,residency FROM threads WHERE id=?').get(id);
    if (!row) return null;
    const recent = db.prepare('SELECT detail FROM thread_events WHERE thread_id=? ORDER BY ordinal LIMIT 1').get(id);
    const unread = db.prepare("SELECT 1 FROM thread_events WHERE thread_id=? AND json_extract(detail,'$.seen')=0 LIMIT 1").get(id);
    return { ...parse(row.detail), updateHistory: recent ? [parse(recent.detail)] : [],
      hasNewUpdate: parse(row.detail).hasNewUpdate || !!unread,
      historyPartial: true, repositoryRevision: row.revision, residency: row.residency };
  }
  function projection() {
    const preferences = Object.fromEntries(db.prepare('SELECT * FROM preferences').all().map(row => [row.key, parse(row.detail)]));
    return {
      revision: revision(), value: {
        ...preferences,
        items: db.prepare("SELECT id FROM threads WHERE residency='hot' ORDER BY id LIMIT 500").all().map(row => projectThread(row.id)),
        scanners: db.prepare('SELECT detail FROM scanners ORDER BY id').all().map(row => parse(row.detail)),
        actionProposals: db.prepare('SELECT detail FROM proposals ORDER BY id').all().map(row => parse(row.detail)),
        history: db.prepare('SELECT detail FROM audit_events ORDER BY ordinal LIMIT 200').all().map(row => parse(row.detail)),
        // Tombstones stay authoritative in the worker; only commands can add them.
        deletedItemIds: [],
      },
    };
  }

  function applyChanges(payload, next) {
    if (!Array.isArray(payload.changes) || payload.changes.length > 2000) error('INVALID_CHANGES');
    const changed = [];
    const deleted = [];
    for (const change of [...payload.changes].sort((a, b) => Number(b.domain === 'scanners') - Number(a.domain === 'scanners'))) {
      switch (change.domain) {
        case 'threads': {
          if (change.remove) { deleteThread(change.id, next); deleted.push(change.id); break; }
          const current = getThread(change.id);
          if (!current && !change.create) error('NOT_FOUND');
          if (current && change.create) error('RECORD_CONFLICT');
          // Status actions clear this legacy flag; normalization stores only canonical lifecycle fields.
          if (!change.patch || typeof change.patch !== 'object' || Array.isArray(change.patch)
            || Object.keys(change.patch).some(key => key !== 'completed' && !Object.hasOwn(itemModel.normalizeItem({ id: change.id }), key))
            || (Object.hasOwn(change.patch, 'completed') && typeof change.patch.completed !== 'boolean')) error('INVALID_PATCH');
          if (change.markRead !== undefined && typeof change.markRead !== 'boolean') error('INVALID_PATCH');
          let patch = change.patch;
          // Acknowledge stored history first; newer local unseen events in the patch must stay unread.
          const storedHistory = change.markRead === true && current
            ? current.updateHistory.map(event => ({ ...event, seen: true })) : current?.updateHistory;
          if (change.markRead === true && current) {
            patch = { isNew: false, hasNewUpdate: false, updateHistory: storedHistory, ...patch };
          }
          if (current && change.partialHistory && patch.updateHistory) {
            const incoming = patch.updateHistory;
            patch = { ...patch, updateHistory: [...incoming, ...storedHistory.filter(event =>
              !incoming.some(candidate => candidate.eventId ? candidate.eventId === event.eventId
                : candidate.timestamp === event.timestamp && candidate.kind === event.kind && candidate.summary === event.summary))] };
          }
          changed.push(putThread({ ...current, ...patch, id: change.id }, 'hot', next));
          break;
        }
        case 'scanners':
          if (change.remove) error('USE_SCANNER_DISPOSITION');
          putScanner(change.value, next); break;
        case 'proposals':
          if (change.remove) {
            const row = db.prepare('SELECT detail FROM proposals WHERE id=?').get(change.id);
            if (row && !proposalModel.canPermanentlyDeleteActionProposal(parse(row.detail))) error('INVALID_PROPOSAL_DELETE');
            if (row) {
              const proposal = parse(row.detail);
              const thread = getThread(proposal.sourceItemId);
              const audit = db.prepare('SELECT detail FROM audit_events').all().map(row => parse(row.detail));
              const effect = proposalModel.classifyActionProposalEffect(proposal, {
                threadEvents: thread?.updateHistory || [], globalEvents: audit,
              });
              if (effect !== 'no-effect') {
                const ordinal = db.prepare('SELECT coalesce(max(ordinal),-1)+1 AS n FROM retained_events WHERE thread_id=?').get(proposal.sourceItemId || change.id).n;
                db.prepare('INSERT INTO retained_events VALUES(?,?,?)').run(proposal.sourceItemId || change.id, ordinal,
                  json({ kind: 'action', event: 'proposal-deleted', proposalId: change.id, effect, proposal }));
              }
            }
            db.prepare('DELETE FROM proposals WHERE id=?').run(change.id);
          } else putProposal(change.value, next);
          break;
        case 'history':
          if (change.remove) db.prepare('DELETE FROM audit_events WHERE id=?').run(change.id);
          else db.prepare('INSERT OR REPLACE INTO audit_events VALUES(?,?,?,?)')
            .run(change.id, -next * 2000 + (change.order || 0), change.value.at || null, json(change.value));
          break;
        case 'deletedItemIds':
          if (change.remove) error('TOMBSTONE_REMOVAL_REFUSED');
          deleteThread(change.id, next); deleted.push(change.id); break;
        case 'preferences':
          if (!['density', 'filter', 'collapsedSections', 'scannerSortPrefs', 'connectionIntent', 'meetings',
            'meetingsLastFetched', 'briefingsByMeetingId', 'briefingSeenAt'].includes(change.id)) error('INVALID_PREFERENCE');
          db.prepare('INSERT OR REPLACE INTO preferences VALUES(?,?)').run(change.id, json(change.value)); break;
        default: error('INVALID_DOMAIN');
      }
    }
    return { changed, deleted };
  }

  function maintain(next) {
    const day = 86400000;
    const now = Date.now();
    for (const row of db.prepare("SELECT id,detail FROM threads WHERE lifecycle='complete'").all()) {
      const item = getThread(row.id);
      const at = item.lastChangedAt || item.updateHistory[0]?.timestamp || item.lastRunAt || item.trackedAt;
      if (Date.parse(at) < now - 7 * day) putThread({ ...item, lifecycleStatus: 'archived', monitorEnabled: false, nextRunAt: null }, item.residency, next);
    }
    db.prepare(`UPDATE threads SET residency='cold' WHERE residency='hot' AND lifecycle IN ('complete','archived')
      AND julianday(coalesce(json_extract(detail,'$.lastChangedAt'),json_extract(detail,'$.lastRunAt'),
        json_extract(detail,'$.trackedAt'),json_extract(detail,'$.discoveredAt'))) < julianday(?)`)
      .run(new Date(now - day).toISOString());
    const overflow = db.prepare(`SELECT id FROM threads WHERE residency='hot' ORDER BY
      lifecycle IN ('complete','archived') DESC, json_extract(detail,'$.discoveredAt'),id`).all();
    for (const row of overflow.slice(0, Math.max(0, overflow.length - 500))) {
      db.prepare("UPDATE threads SET residency='cold' WHERE id=?").run(row.id);
    }
    db.prepare("DELETE FROM audit_events WHERE julianday(at) <= julianday(?) OR at IS NULL")
      .run(new Date(now - 30 * day).toISOString());
    db.exec('DELETE FROM audit_events WHERE id NOT IN (SELECT id FROM audit_events ORDER BY ordinal LIMIT 200)');
  }

  const viewWhere = (view, now) => {
    const active = "lifecycle NOT IN ('complete','archived') AND coalesce(json_extract(detail,'$.archived'),0)=0";
    const awake = `(julianday(json_extract(detail,'$.snoozeUntil')) IS NULL OR julianday(json_extract(detail,'$.snoozeUntil'))<=julianday('${new Date(now).toISOString()}'))`;
    switch (view) {
      case 'archived': return "(lifecycle='archived' OR json_extract(detail,'$.archived')=1)=1";
      case 'completed': return "lifecycle='complete'";
      case 'snoozed': return `${active} AND NOT ${awake}`;
      case 'priority': return `${active} AND ${awake} AND (json_extract(detail,'$.severity')='Critical' OR lifecycle='blocked')`;
      case 'monitored': return `${active} AND ${awake} AND json_extract(detail,'$.monitorEnabled')=1`;
      default: return `${active} AND ${awake}`;
    }
  };
  function radarPage(input) {
    const limit = boundedLimit(input.limit);
    const current = revision();
    if (input.revision !== undefined && input.revision !== current) error('CURSOR_EXPIRED');
    const now = input.now || Date.now();
    const where = [viewWhere(input.view, now)], params = [];
    const normalizeFilter = value => String(value ?? '').trim().toLowerCase();
    let quickFilter = normalizeFilter(input.quickFilter);
    const facets = { ...input.refineFilters };
    const unread = `id IN (
      SELECT id FROM threads INDEXED BY threads_unread_flags
        WHERE json_extract(detail,'$.isNew')=1 OR json_extract(detail,'$.hasNewUpdate')=1
      UNION SELECT thread_id FROM thread_events INDEXED BY events_unread WHERE json_extract(detail,'$.seen')=0)`;
    const quickSql = { unread, new: "json_extract(detail,'$.isNew')=1",
      updated: "json_extract(detail,'$.hasNewUpdate')=1",
      critical: "lower(json_extract(detail,'$.severity'))='critical'", blocked: "lifecycle='blocked'" };
    if (Object.hasOwn(quickSql, quickFilter)) { where.push(quickSql[quickFilter]); quickFilter = ''; }
    // These are normalized enum/boolean fields. Dates, signal identities and arbitrary
    // scanner IDs stay with the JS oracle (Date.parse/local boundaries/Unicode).
    for (const facet of ['severity', 'lifecycle', 'read', 'monitoring']) {
      if (!Array.isArray(facets[facet]) || !facets[facet].length) continue;
      const alternatives = facets[facet].map(value => {
        const normalized = normalizeFilter(value);
        if (facet === 'severity' || facet === 'lifecycle') {
          params.push(normalized);
          return facet === 'severity' ? "lower(json_extract(detail,'$.severity'))=?" : 'lifecycle=?';
        }
        if (facet === 'read') return normalized === 'unread' ? unread : normalized === 'read' ? `NOT (${unread})` : '0';
        if (normalized === 'paused') return "json_extract(detail,'$.monitorPaused')=1";
        if (['enabled','monitoring'].includes(normalized)) return "json_extract(detail,'$.monitorEnabled')=1 AND coalesce(json_extract(detail,'$.monitorPaused'),0)<>1";
        if (['disabled','off'].includes(normalized)) return "coalesce(json_extract(detail,'$.monitorEnabled'),0)<>1";
        return '0';
      });
      where.push(`(${alternatives.map(value => `(${value})`).join(' OR ')})`);
      delete facets[facet];
    }
    if (input.scannerId && input.scannerId !== 'all') { where.push('scanner_id=?'); params.push(input.scannerId); }
    if (input.query?.trim()) {
      where.push(`(lower(json_extract(detail,'$.title')) LIKE ? OR lower(json_extract(detail,'$.summary')) LIKE ?
        OR lower(json_extract(detail,'$.reason')) LIKE ? OR lower(json_extract(detail,'$.owner')) LIKE ?
        OR lower(json_extract(detail,'$.counterparties')) LIKE ?)`);
      params.push(...Array(5).fill(`%${input.query.trim().toLowerCase()}%`));
    }
    const order = RADAR_ACTIVITY_ORDER;
    const priorityOrder = `(coalesce(json_extract(detail,'$.isNew'),0) OR coalesce(json_extract(detail,'$.hasNewUpdate'),0)
      OR EXISTS(SELECT 1 FROM thread_events e WHERE e.thread_id=threads.id AND json_extract(e.detail,'$.seen')=0)) DESC,
      (${viewWhere('priority', now)}) DESC, CASE json_extract(detail,'$.severity') WHEN 'Critical' THEN 0 WHEN 'Elevated' THEN 1 WHEN 'Observe' THEN 2 ELSE 3 END,${order}`;
    const offset = Number.isInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
    const rows = [];
    let total = 0;
    const hasFacets = !!quickFilter || Object.values(facets).some(values => values?.length);
    if (!hasFacets) {
      total = db.prepare(`SELECT count(*) AS n FROM threads WHERE ${where.join(' AND ')}`).get(...params).n;
      rows.push(...db.prepare(`SELECT id FROM threads WHERE ${where.join(' AND ')}
        ORDER BY ${input.sort === 'priority' ? priorityOrder : order} LIMIT ? OFFSET ?`).all(...params, limit, offset)
        .map(row => projectThread(row.id)));
    }
    // Facets are the same pure predicate as the renderer. Only a bounded page leaves the worker.
    for (const row of hasFacets ? db.prepare(`SELECT id,detail,
      EXISTS(SELECT 1 FROM thread_events e WHERE e.thread_id=threads.id AND json_extract(e.detail,'$.seen')=0) AS unread
      FROM threads WHERE ${where.join(' AND ')}
      ORDER BY ${input.sort === 'priority' ? priorityOrder : order}`).iterate(...params) : []) {
      const item = { ...parse(row.detail), updateHistory: row.unread ? [{ seen: false }] : [] };
      if (!inboxFilters.matchesInboxFilters(item, { quickFilter, facets }, { now })) continue;
      if (total >= offset && rows.length < limit) rows.push(projectThread(row.id));
      total++;
    }
    const counts = Object.fromEntries(['inbox', 'priority', 'monitored', 'snoozed', 'completed', 'archived']
      .map(view => [view, db.prepare(`SELECT count(*) AS n FROM threads INDEXED BY ${
        view === 'archived' ? 'threads_archive_page' : 'threads_view_counts'} WHERE ${viewWhere(view, now)}`).get().n]));
    const scannerCounts = db.prepare('SELECT scanner_id,count(*) AS n FROM threads GROUP BY scanner_id').all();
    return { revision: current, rows, total, counts, scannerCounts, offset, more: offset + limit < total };
  }

  let todayCache;
  let todayInputCache;
  // Histories are reduced once per changed thread, not once per global revision.
  // Keep receipt identities until the final fold: deduplication is global and order-sensitive.
  function summarizeTodayThread(row, days, now) {
    todayProjectionStats.threadsRebuilt++;
    const raw = parse(row.detail);
    const fields = ['id','title','lifecycleStatus','archived','severity','snoozeUntil','dueAt','lastChangedAt',
      'completedAt','scannerId','suggestedNextSteps','completedNextSteps'];
    const item = Object.fromEntries(fields.map(key => [key, raw[key]]));
    const counts = days.map(() => ({ discovery: 0, update: 0, lifecycle: 0, communication: 0 }));
    const actions = [];
    const confirmed = [];
    const seen = new Set();
    let latest = null, latestTime = -Infinity, nextEventAt = Infinity;
    for (const eventRow of db.prepare('SELECT detail FROM thread_events WHERE thread_id=? ORDER BY ordinal').iterate(row.id)) {
      todayProjectionStats.eventsRead++;
      const entry = parse(eventRow.detail);
      const time = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
      // Match the oracle's stable timestamp sort, including invalid dates and future lifecycle entries.
      if (entry.kind === 'lifecycle' && entry.summary !== 'Status changed to archived'
        && (latest === null || (time || 0) > latestTime)) {
        latest = entry;
        latestTime = time || 0;
      }
      if (!Number.isFinite(time)) continue;
      if (time > now) { nextEventAt = Math.min(nextEventAt, time); continue; }
      const day = days.findIndex(bucket => time >= bucket.from && time < bucket.to);
      if (day < 0) continue;
      const kind = todayModel.todayActivityKind(entry);
      if (!kind) continue;
      if (kind === 'communication' && day === days.length - 1) confirmed.push(entry);
      const key = todayModel.todayActivityKey(item, entry, kind);
      if (seen.has(key)) continue;
      seen.add(key);
      if (kind === 'communication') actions.push({ entry, day });
      else counts[day][kind]++;
    }
    // Completion uses the latest non-archive lifecycle; communications use receipt semantics.
    item.updateHistory = [...(latest ? [latest] : []), ...confirmed];
    return { item, counts, actions, nextEventAt, order: Buffer.from(item.id) };
  }
  function today(input) {
    const now = input.now || Date.now();
    if (!todayCache || todayCache.revision !== revision() || todayCache.now !== now) {
      const from = new Date(now); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
      const activity = todayModel.buildTodayOverview([], { now }).activity;
      if (!todayInputCache || todayInputCache.from !== from.getTime() || resetTodayProjection) {
        todayInputCache = { from: from.getTime(), records: new Map(), now };
        for (const row of db.prepare('SELECT id,detail FROM threads ORDER BY id').iterate()) {
          todayInputCache.records.set(row.id, summarizeTodayThread(row, activity, now));
        }
        resetTodayProjection = false;
      } else {
        // A rolled-back transaction may also dirty IDs: reload persisted truth, never speculative data.
        if (now < todayInputCache.now) {
          for (const id of todayInputCache.records.keys()) dirtyTodayThreads.add(id);
        } else {
          for (const [id, record] of todayInputCache.records) {
            if (record.nextEventAt <= now) dirtyTodayThreads.add(id);
          }
        }
        for (const id of dirtyTodayThreads) {
          const row = db.prepare('SELECT id,detail FROM threads WHERE id=?').get(id);
          if (row) todayInputCache.records.set(id, summarizeTodayThread(row, activity, now));
          else todayInputCache.records.delete(id);
        }
      }
      dirtyTodayThreads.clear();
      todayInputCache.now = now;
      const compact = [];
      const seenActions = new Set();
      for (const record of [...todayInputCache.records.values()].sort((a, b) => Buffer.compare(a.order, b.order))) {
        const { item, counts, actions } = record;
        compact.push(item);
        const included = activity.map(() => false);
        counts.forEach((value, index) => {
          for (const kind of ['discovery','update','lifecycle']) activity[index].counts[kind] += value[kind];
          included[index] = value.discovery + value.update + value.lifecycle > 0;
        });
        for (const { entry, day } of actions) {
          if (seenActions.has(entry.proposalId)) continue;
          seenActions.add(entry.proposalId);
          activity[day].counts.communication++;
          included[day] = true;
        }
        included.forEach((value, index) => { if (value) activity[index].items.push(item); });
      }
      const prefs = Object.fromEntries(db.prepare('SELECT * FROM preferences').all().map(row => [row.key, parse(row.detail)]));
      todayCache = { revision: revision(), now, overview: todayModel.buildTodayOverview(compact, {
        now, scanners: db.prepare('SELECT detail FROM scanners').all().map(row => parse(row.detail)),
        meetings: prefs.meetings || [], projectedActivity: activity,
      }) };
    }
    const overview = todayCache.overview;
    if (input.selection) {
      const rows = todayModel.todaySelectionItems(overview, input.selection);
      const limit = boundedLimit(input.limit);
      const offset = input.offset || 0;
      return { revision: revision(), rows: rows.slice(offset, offset + limit).map(item => projectThread(item.id)), total: rows.length, more: offset + limit < rows.length };
    }
    const result = {};
    for (const key of ['active','overdue','blocked','dueToday','completed','confirmed']) result[`${key}Count`] = overview[key].length;
    for (const key of ['statuses','deadlines','groups','activity']) {
      result[key] = overview[key].map(({ items, events, ...bucket }) => ({ ...bucket, count: items.length,
        statusCounts: Object.fromEntries(overview.statuses.map(status => [status.key, items.filter(item =>
          (['in-progress','blocked','waiting'].includes(item.lifecycleStatus) ? item.lifecycleStatus : 'unknown') === status.key).length])) }));
    }
    const hydrate = entry => ({ ...entry, item: projectThread(entry.item.id) });
    return { ...result, revision: revision(), completed: overview.completed.slice(0, 5).map(hydrate), confirmed: overview.confirmed.slice(0, 5).map(hydrate),
      attention: overview.attention.map(hydrate), schedule: overview.schedule,
      nextMove: overview.nextMove ? projectThread(overview.nextMove.id) : null };
  }
function putScanner(raw, nextRevision) {
  const scanner = scannerModel.normalizeScannerDefinition(raw);
  db.prepare(`INSERT INTO scanners VALUES(?,?,?) ON CONFLICT(id)
    DO UPDATE SET revision=excluded.revision,detail=excluded.detail`).run(scanner.id, nextRevision, json(scanner));
  db.prepare('DELETE FROM scanner_exclusions WHERE scanner_id=?').run(scanner.id);
  for (const id of scanner.excludedItemIds || []) {
    db.prepare('INSERT OR IGNORE INTO scanner_exclusions VALUES(?,?)').run(scanner.id, id);
  }
  return scanner.id;
}
function putProposal(raw, nextRevision) {
  let proposal = proposalModel.normalizeActionProposal(raw);
  if (!proposal) error('INVALID_PROPOSAL');
  if (raw.auditOnly === true) proposal.auditOnly = true;
  if (proposal.sourceItemId && db.prepare('SELECT 1 FROM deleted_items WHERE id=?').get(proposal.sourceItemId)) proposal.auditOnly = true;
  db.prepare('INSERT OR REPLACE INTO proposals VALUES(?,?,?,?,?)')
    .run(proposal.id, proposal.sourceItemId || null, proposal.state, nextRevision, json(proposal));
}
function deleteThread(id, nextRevision) {
  dirtyTodayThreads.add(id);
  const thread = getThread(id);
  const audit = db.prepare('SELECT detail FROM audit_events ORDER BY ordinal').all().map(row => parse(row.detail));
  const proposals = db.prepare('SELECT detail FROM proposals WHERE source_item_id=?').all(id).map(row => parse(row.detail));
  const removed = new Set();
  for (const proposal of proposals) {
    const effect = proposalModel.classifyActionProposalEffect(proposal, { threadEvents: thread?.updateHistory || [], globalEvents: audit });
    if (effect === 'no-effect') {
      db.prepare('DELETE FROM proposals WHERE id=?').run(proposal.id);
      removed.add(proposal.id);
    } else putProposal({ ...proposal, auditOnly: true }, nextRevision);
  }
  // Retain effectful/ambiguous evidence and remove only administrative no-effect history.
  for (const entry of audit) {
    if (removed.has(entry.payload?.proposalId) && entry.payload?.event !== 'succeeded') {
      db.prepare('DELETE FROM audit_events WHERE id=?').run(entry.id);
    }
  }
  for (const [ordinal, entry] of (thread?.updateHistory || []).entries()) {
    if (entry.kind === 'action' && !removed.has(entry.proposalId)) {
      db.prepare('INSERT OR REPLACE INTO retained_events VALUES(?,?,?)').run(id, ordinal, json(entry));
    }
  }
  db.prepare('INSERT OR IGNORE INTO deleted_items VALUES(?)').run(id);
  db.prepare('DELETE FROM threads WHERE id=?').run(id);
}
function boundedLimit(value, max = 100) {
  if (value === undefined) return max;
  if (!Number.isInteger(value) || value < 1 || value > max) error('INVALID_LIMIT');
  return value;
}
function listThreads(input) {
  const { cursor, limit, residency, lifecycle, scannerId } = input;
  if (Object.keys(input).some(key => !['cursor', 'limit', 'residency', 'lifecycle', 'scannerId'].includes(key))) error('INVALID_FILTER');
  const current = revision();
  let after = '';
  if (cursor) {
    let decoded;
    try { decoded = parse(Buffer.from(cursor, 'base64url').toString()); } catch (_) { error('INVALID_CURSOR'); }
    if (decoded.revision !== current || decoded.filter !== json({ residency, lifecycle, scannerId })) error('CURSOR_EXPIRED');
    after = decoded.id;
  }
  const where = ['id > ?'], params = [after];
  if (residency !== undefined) {
    if (!['hot', 'cold'].includes(residency)) error('INVALID_FILTER');
    where.push('residency=?'); params.push(residency);
  }
  if (lifecycle !== undefined) { where.push('lifecycle=?'); params.push(String(lifecycle)); }
  if (scannerId !== undefined) { where.push('scanner_id=?'); params.push(String(scannerId)); }
  const count = boundedLimit(limit);
  const rows = db.prepare(`SELECT id,scanner_id,residency,lifecycle,changed_at,revision,
    json_extract(detail,'$.title') AS title, json_extract(detail,'$.severity') AS severity
    FROM threads WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`).all(...params, count + 1);
  const more = rows.length > count;
  if (more) rows.pop();
  return { revision: current, rows, cursor: more ? Buffer.from(json({
    revision: current, id: rows.at(-1).id, filter: json({ residency, lifecycle, scannerId }),
  })).toString('base64url') : null };
}
function collisions(input) {
  const rows = db.prepare(`SELECT s.identity, t.id, t.scanner_id, t.residency, c.detail AS scanner
    FROM thread_sources s JOIN threads t ON t.id=s.thread_id LEFT JOIN scanners c ON c.id=t.scanner_id
    WHERE s.identity IN (SELECT identity FROM thread_sources GROUP BY identity HAVING count(*)>1)
    AND (s.identity > ? OR (s.identity = ? AND t.id > ?))
    ORDER BY s.identity,t.id LIMIT ?`).all(input.afterIdentity || '', input.afterIdentity || '', input.afterThreadId || '', boundedLimit(input.limit, 100));
  return { revision: revision(), rows, cursor: rows.length ? {
    afterIdentity: rows.at(-1).identity, afterThreadId: rows.at(-1).id,
  } : null };
}
function importState(input) {
  const existing = db.prepare("SELECT value FROM metadata WHERE key='import_fingerprint'").get();
  if (existing) {
    if (existing.value !== input.fingerprint) error('ALREADY_IMPORTED');
    return { ok: true, imported: false, revision: revision() };
  }
  if (revision() !== 0 || db.prepare('SELECT count(*) AS n FROM threads').get().n) error('NOT_EMPTY');
  return transaction(() => {
    for (const scanner of input.scanners) putScanner(scanner, 1);
    for (const id of input.deletedItemIds) db.prepare('INSERT OR IGNORE INTO deleted_items VALUES(?)').run(id);
    for (const entry of input.threads) putThread(entry.item, entry.residency, 1);
    for (const proposal of input.proposals) putProposal(proposal, 1);
    for (const [ordinal, entry] of input.history.entries()) {
      db.prepare('INSERT INTO audit_events VALUES(?,?,?,?)').run(entry.id, ordinal, entry.at || null, json(entry));
    }
    for (const [key, value] of Object.entries(input.preferences)) {
      db.prepare('INSERT INTO preferences VALUES(?,?)').run(key, json(value));
    }
    db.prepare('INSERT INTO import_originals VALUES(?,?)').run('canonical', json(input.originals));
    setMeta('import_fingerprint', input.fingerprint);
    setMeta('revision', 1);
    checkIntegrity();
    return { ok: true, imported: true, revision: 1, count: input.threads.length };
  });
}
function command(input) {
  if (!db.prepare("SELECT value FROM metadata WHERE key='import_fingerprint'").get()) error('IMPORT_INCOMPLETE');
  if (typeof input.commandId !== 'string' || !input.commandId || input.commandId.length > 200) error('INVALID_COMMAND_ID');
  const fingerprint = createHash('sha256').update(json({ type: input.type, payload: input.payload })).digest('hex');
  const prior = db.prepare('SELECT * FROM command_receipts WHERE id=?').get(input.commandId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) error('COMMAND_ID_REUSED');
    return parse(prior.detail);
  }
  if (input.expectedRevision !== revision()) error('CONFLICT');
  return transaction(() => {
    const next = revision() + 1;
    const payload = input.payload || {};
    let changedIds = [], deletedIds = [];
    switch (input.type) {
      case 'reseedDemo':
        resetTodayProjection = true;
        db.exec(`DELETE FROM proposals; DELETE FROM thread_events; DELETE FROM thread_sources; DELETE FROM threads;
          DELETE FROM scanner_exclusions; DELETE FROM scanners; DELETE FROM deleted_items; DELETE FROM retained_events;
          DELETE FROM audit_events; DELETE FROM preferences;`);
        {
          const result = applyChanges(payload, next);
          changedIds = result.changed;
          maintain(next);
        }
        break;
      case 'applyChanges': {
        const result = applyChanges(payload, next);
        changedIds = result.changed; deletedIds = result.deleted;
        maintain(next);
        break;
      }
      case 'maintenance':
        maintain(next); break;
      case 'patchThread': {
        const current = getThread(payload.id);
        if (!current) error('NOT_FOUND');
        if (payload.expectedRecordRevision !== current.repositoryRevision) error('RECORD_CONFLICT');
        const allowed = new Set(['severity', 'lifecycleStatus', 'monitorEnabled', 'nextRunAt', 'monitorPrompt', 'isNew',
          'hasNewUpdate', 'snoozeUntil', 'scheduleType', 'scheduleValue', 'oneTimeAt', 'weeklyDays', 'weeklyTimes',
          'workHoursOnly', 'completedNextSteps', 'summary', 'lastChangedAt', 'completedAt']);
        if (!payload.patch || Object.keys(payload.patch).some(key => !allowed.has(key))) error('INVALID_PATCH');
        changedIds = [putThread({ ...current, ...payload.patch }, current.residency, next)];
        break;
      }
      case 'deleteThread':
        deleteThread(payload.id, next); deletedIds = [payload.id]; break;
      case 'saveScanner':
        changedIds = [putScanner(payload.scanner, next)]; break;
      case 'deleteScanner': {
        const row = db.prepare('SELECT detail FROM scanners WHERE id=?').get(payload.id);
        if (!row) error('NOT_FOUND');
        if (!['delete-all', 'reassign'].includes(payload.disposition)) error('INVALID_DISPOSITION');
        if (payload.disposition === 'reassign' && payload.targetScannerId !== null && (payload.targetScannerId === payload.id
          || !db.prepare('SELECT 1 FROM scanners WHERE id=?').get(payload.targetScannerId))) error('INVALID_TARGET');
        const owned = db.prepare('SELECT id FROM threads WHERE scanner_id=?').all(payload.id);
        for (const { id } of owned) {
          if (payload.disposition === 'delete-all') { deleteThread(id, next); deletedIds.push(id); }
          else {
            const thread = getThread(id);
            putThread({ ...thread, scannerId: payload.targetScannerId }, thread.residency, next);
            changedIds.push(id);
          }
        }
        db.prepare('DELETE FROM scanners WHERE id=?').run(payload.id);
        if (payload.audit) db.prepare('INSERT INTO audit_events VALUES(?,?,?,?)')
          .run(payload.audit.id, -next * 2000, payload.audit.at, json(payload.audit));
        break;
      }
      case 'acceptScannerResults': {
        const row = db.prepare('SELECT detail FROM scanners WHERE id=?').get(payload.scannerId);
        if (!row) error('SCANNER_DELETED');
        const scanner = parse(row.detail);
        if (!scanner.enabled || !Array.isArray(payload.items) || payload.items.length > 100) error('INVALID_SCAN');
        for (const candidate of payload.items) {
          const item = itemModel.normalizeItem({ ...candidate, scannerId: scanner.id });
          if (db.prepare('SELECT 1 FROM deleted_items WHERE id=?').get(item.id)
            || db.prepare('SELECT 1 FROM scanner_exclusions WHERE scanner_id=? AND item_id=?').get(scanner.id, item.id)
            || db.prepare('SELECT 1 FROM threads WHERE id=?').get(item.id)) continue;
          let duplicate = false;
          for (const identity of itemModel.collectItemSourceIdentities(item)) {
            const owners = db.prepare(`SELECT t.scanner_id FROM thread_sources s
              JOIN threads t ON t.id=s.thread_id WHERE s.identity=?`).all(identity);
            if (owners.some(owner => owner.scanner_id === scanner.id || scanner.crossScannerDedup !== false)) {
              duplicate = true; break;
            }
          }
          if (!duplicate) changedIds.push(putThread(item, 'hot', next));
        }
        if (payload.scannerPatch) putScanner({ ...scanner, ...payload.scannerPatch, id: scanner.id }, next);
        maintain(next);
        break;
      }
      case 'saveProposal':
        putProposal(payload.proposal, next); changedIds = [payload.proposal.id]; break;
      case 'patchPreference': {
        if (!['density', 'filter', 'collapsedSections', 'scannerSortPrefs', 'connectionIntent',
          'meetings', 'meetingsLastFetched', 'briefingsByMeetingId', 'briefingSeenAt'].includes(payload.key)) error('INVALID_PREFERENCE');
        db.prepare('INSERT OR REPLACE INTO preferences VALUES(?,?)').run(payload.key, json(payload.value));
        break;
      }
      default: error('UNKNOWN_COMMAND');
    }
    setMeta('revision', next);
    const result = { ok: true, revision: next, changedIds, deletedIds };
    db.prepare('INSERT INTO command_receipts VALUES(?,?,?,?)').run(input.commandId, fingerprint, next, json(result));
    db.prepare('DELETE FROM command_receipts WHERE revision < ?').run(Math.max(0, next - 1000));
    return result;
  });
}

async function dispatch(method, input) {
  await ready;
  switch (method) {
    case 'status': return {
      revision: revision(), schemaVersion: SCHEMA_VERSION,
      todayProjection: { ...todayProjectionStats },
      importFingerprint: db.prepare("SELECT value FROM metadata WHERE key='import_fingerprint'").get()?.value || null,
      runtime: { node: process.versions.node, electron: process.versions.electron || null,
        sqlite: db.prepare('SELECT sqlite_version() AS version').get().version },
      counts: {
        threads: db.prepare('SELECT count(*) AS n FROM threads').get().n,
        sources: db.prepare('SELECT count(*) AS n FROM thread_sources').get().n,
        events: db.prepare('SELECT count(*) AS n FROM thread_events').get().n,
      },
    };
    case 'integrity': return checkIntegrity();
    case 'import': return importState(input);
    case 'command': return command(input);
    case 'projection': return projection();
    case 'needsMaintenance': return !!db.prepare(`SELECT 1 FROM threads WHERE
      (lifecycle='complete' AND julianday(changed_at)<julianday('now','-7 days'))
      OR (residency='hot' AND lifecycle IN ('complete','archived') AND julianday(changed_at)<julianday('now','-1 day')) LIMIT 1`).get()
      || db.prepare("SELECT count(*) AS n FROM threads WHERE residency='hot'").get().n > 500
      || !!db.prepare("SELECT 1 FROM audit_events WHERE julianday(at)<=julianday('now','-30 days') LIMIT 1").get();
    case 'radarPage': return radarPage(input);
    case 'today': return today(input);
    case 'sourceOwners': {
      if (!Array.isArray(input.identities) || input.identities.length > 500) error('INVALID_IDENTITIES');
      const rows = [];
      for (const identity of input.identities) {
        rows.push(...db.prepare(`SELECT t.id,t.scanner_id AS scannerId FROM thread_sources s
          JOIN threads t ON t.id=s.thread_id WHERE s.identity=? LIMIT 100`).all(identity)
          .map(row => ({ ...row, identity })));
      }
      const ids = (input.ids || []).slice(0, 100).filter(id => db.prepare('SELECT 1 FROM threads WHERE id=?').get(id));
      return { revision: revision(), rows, ids };
    }
    case 'collisionGroups': {
      if (input.revision !== undefined && input.revision !== revision()) error('CURSOR_EXPIRED');
      const identities = db.prepare(`SELECT identity,count(*) AS n FROM thread_sources WHERE identity>?
        GROUP BY identity HAVING count(*)>1 ORDER BY identity LIMIT ?`).all(input.after || '', boundedLimit(input.limit, 100) + 1);
      const more = identities.length > (input.limit || 100);
      if (more) identities.pop();
      const groups = identities.map(({ identity, n }) => {
        const owners = db.prepare(`SELECT t.id,t.scanner_id,t.residency,json_extract(t.detail,'$.title') AS title,c.detail AS scanner
          FROM thread_sources s JOIN threads t ON t.id=s.thread_id LEFT JOIN scanners c ON c.id=t.scanner_id
          WHERE s.identity=? ORDER BY t.id LIMIT 100`).all(identity).map(row => {
            const scanner = row.scanner ? parse(row.scanner) : null;
            return { threadId: row.id, title: row.title, tier: row.residency, scannerId: row.scanner_id,
              scannerName: scanner?.name || 'Unassigned / unavailable scanner', crossScannerDedup: scanner?.crossScannerDedup !== false };
          });
        const counts = db.prepare(`SELECT t.scanner_id,count(*) AS n FROM thread_sources s JOIN threads t ON t.id=s.thread_id
          WHERE s.identity=? GROUP BY t.scanner_id`).all(identity);
        return { identity, owners, ownerCount: n, truncated: n > owners.length,
          sameScannerCollision: counts.some(row => row.n > 1),
          allowsCrossScannerDuplicate: owners.some(owner => !owner.crossScannerDedup) };
      });
      return { revision: revision(), groups, cursor: more ? identities.at(-1).identity : null };
    }
    case 'previewScannerDeletion': {
      const row = db.prepare('SELECT detail FROM scanners WHERE id=?').get(input.id);
      if (!row) return { ok: false, code: 'NOT_FOUND' };
      const scanner = parse(row.detail);
      const counts = db.prepare('SELECT residency,count(*) AS n FROM threads WHERE scanner_id=? GROUP BY residency').all(input.id);
      const effects = { noEffectProposals: 0, effectfulProposals: 0 };
      const audit = db.prepare('SELECT detail FROM audit_events').all().map(row => parse(row.detail));
      const linked = db.prepare(`SELECT p.detail FROM proposals p JOIN threads t ON t.id=p.source_item_id WHERE t.scanner_id=?`).all(input.id);
      for (const row of linked) {
        const proposal = parse(row.detail);
        const effect = proposalModel.classifyActionProposalEffect(proposal, {
          threadEvents: getThread(proposal.sourceItemId)?.updateHistory || [], globalEvents: audit,
        });
        effects[effect === 'no-effect' ? 'noEffectProposals' : 'effectfulProposals']++;
      }
      const hotItems = counts.find(row => row.residency === 'hot')?.n || 0;
      const coldItems = counts.find(row => row.residency === 'cold')?.n || 0;
      return { ok: true, scanner, previewToken: String(revision()), itemIds: [], selectedItemIds: [], selectedProposalIds: [],
        counts: { hotItems, coldItems, uniqueItems: hotItems + coldItems, linkedProposals: linked.length,
          ...effects, audits: effects.effectfulProposals, tombstones: hotItems + coldItems, selections: 0 },
        reassignmentTargets: [{ id: null, name: 'Unassigned Inbox' }, ...db.prepare('SELECT id,detail FROM scanners WHERE id<>?').all(input.id)
          .map(row => ({ id: row.id, name: parse(row.detail).name }))] };
    }
    case 'dueMonitors': {
      const now = new Date(input.now || Date.now()).toISOString();
      return { revision: revision(), rows: db.prepare(`SELECT id FROM threads
        WHERE json_extract(detail,'$.monitorEnabled')=1 AND lifecycle NOT IN ('complete','archived')
        AND julianday(json_extract(detail,'$.nextRunAt'))<=julianday(?)
        AND (julianday(json_extract(detail,'$.snoozeUntil')) IS NULL
          OR julianday(json_extract(detail,'$.snoozeUntil'))<=julianday(?))
        ORDER BY json_extract(detail,'$.nextRunAt'),id LIMIT ?`).all(now, now, boundedLimit(input.limit))
        .map(row => projectThread(row.id)) };
    }
    case 'listThreads': return listThreads(input);
    case 'getThread': return getThread(input.id);
    case 'listHistory': return { revision: revision(), rows: db.prepare(
      'SELECT ordinal,detail FROM thread_events WHERE thread_id=? AND ordinal>? ORDER BY ordinal LIMIT ?')
      .all(input.id, input.after ?? -1, boundedLimit(input.limit, 50)).map(row => ({ ordinal: row.ordinal, ...parse(row.detail) })) };
    case 'listRetainedEvidence': return { revision: revision(), rows: db.prepare(
      'SELECT ordinal,detail FROM retained_events WHERE thread_id=? AND ordinal>? ORDER BY ordinal LIMIT ?')
      .all(input.id, input.after ?? -1, boundedLimit(input.limit, 50)).map(row => ({ ordinal: row.ordinal, ...parse(row.detail) })) };
    case 'listProposals': return { revision: revision(), rows: db.prepare(
      'SELECT id,revision,detail FROM proposals WHERE id>? ORDER BY id LIMIT ?')
      .all(input.after || '', boundedLimit(input.limit)).map(row => ({ ...parse(row.detail), repositoryRevision: row.revision })) };
    case 'sourceCollisions': return collisions(input);
    case 'queryPlan': return [
      ...db.prepare('EXPLAIN QUERY PLAN SELECT thread_id FROM thread_sources WHERE identity=?').all('generated'),
      ...db.prepare("EXPLAIN QUERY PLAN SELECT id FROM threads WHERE residency='cold' AND id>? ORDER BY id LIMIT 100").all(''),
      ...db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM threads WHERE ${viewWhere('archived', Date.now())}
        ORDER BY ${RADAR_ACTIVITY_ORDER} LIMIT 100 OFFSET 100`).all(),
    ];
    case 'backup':
      if (typeof backup !== 'function') error('BACKUP_UNAVAILABLE');
      await backup(db, input.path);
      return { ok: true };
    case 'close':
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      return { ok: true };
    default: error('UNKNOWN_METHOD');
  }
}

let queue = Promise.resolve();
parentPort.on('message', ({ id, method, input }) => {
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id, result: await dispatch(method, input) }); }
    catch (failure) { parentPort.postMessage({ id, error: { code: failure.code || 'REPOSITORY_FAILED', cause: failure.message } }); }
  });
});
