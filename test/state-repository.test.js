'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { createGeneratedProfile, removeGeneratedProfile } = require('./fixtures/state-profile');
const { openStateRepository } = require('../src/main/state-repository');
const { canonicalizeState, migrateStateProfile } = require('../src/main/state-migration');
const { createStateService } = require('../src/main/state-service');
const { EventEmitter } = require('node:events');

it('legacy completed flags are boolean-only inputs normalized to canonical lifecycle fields', async () => {
  const { directory } = createGeneratedProfile({});
  const service = createStateService(directory);
  try {
    let base = await service.query('projection');
    const id = base.value.items[0].id;
    for (const value of ['false', null, 0, {}]) {
      await assert.rejects(service.command({
        commandId: `invalid-completed-${JSON.stringify(value)}`, expectedRevision: base.revision,
        type: 'applyChanges', payload: { changes: [{ domain: 'threads', id, patch: { completed: value } }] },
      }), { code: 'INVALID_PATCH' });
      assert.equal((await service.query('status')).revision, base.revision);
    }
    const result = await service.command({
      commandId: 'legacy-completed', expectedRevision: base.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id, patch: { completed: true } }] },
    });
    const saved = await service.query('getThread', { id });
    assert.equal(saved.lifecycleStatus, 'archived');
    assert.equal(Object.hasOwn(saved, 'completed'), false);
    await assert.rejects(service.command({
      commandId: 'unknown-patch', expectedRevision: result.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id, patch: { unsupportedFlag: true } }] },
    }), { code: 'INVALID_PATCH' });
  } finally { await service.close(); removeGeneratedProfile(directory); }
});

it('explicit projection mark-read acknowledges all unseen history with isNew already false and survives reload', async () => {
  const { stateDelta } = await import('../src/shared/state-delta.mjs');
  const { markMailboxThreadRead, isMailboxUnread } = await import('../src/svelte/lib/mailbox.js');
  for (const projectedSeen of [false, true]) {
    const { directory } = createGeneratedProfile({});
    const databasePath = path.join(directory, 'mark-read.sqlite');
    let repository = openStateRepository(databasePath);
    try {
      const input = await canonicalizeState({
        items: ['target', 'untouched'].map(id => ({
          id, lifecycleStatus: 'in-progress', isNew: false, hasNewUpdate: false,
          updateHistory: Array.from({ length: 3 }, (_, index) => ({
            eventId: `${id}_${index}`, kind: 'update', summary: `Update ${index}`,
            timestamp: `2026-11-0${5 - index}T12:00:00Z`, seen: index === 0 && projectedSeen,
          })),
        })),
      }, []);
      await repository.call('import', input);
      const base = await repository.call('projection');
      const target = base.value.items.find(row => row.id === 'target');
      assert.equal(target.isNew, false);
      assert.equal(target.historyPartial, true);
      assert.equal(target.updateHistory.length, 1);
      assert.equal(isMailboxUnread(target), true);
      const changes = stateDelta(base.value, {
        ...base.value, items: base.value.items.map(row => row.id === target.id ? markMailboxThreadRead(row) : row),
      });
      assert.equal(changes.length, 1);
      assert.equal(changes[0].markRead, true);
      assert.equal(changes[0].patch.isNew, false);
      assert.equal(Object.hasOwn(changes[0].patch, 'mailboxReadRequestId'), false);
      const result = await repository.call('command', {
        commandId: 'mark-read', expectedRevision: base.revision, type: 'applyChanges', payload: { changes },
      });
      assert.equal(result.ok, true);
      await repository.close();
      repository = openStateRepository(databasePath);
      const detail = await repository.call('getThread', { id: target.id });
      assert.equal(detail.updateHistory.length, 3);
      assert.ok(detail.updateHistory.every(event => event.seen === true));
      assert.equal(isMailboxUnread(detail), false);
      assert.equal(Object.hasOwn(detail, 'mailboxReadRequestId'), false);
      const reloaded = await repository.call('projection');
      assert.equal(isMailboxUnread(reloaded.value.items.find(row => row.id === target.id)), false);
      const unread = await repository.call('radarPage', { view: 'inbox', quickFilter: 'unread' });
      assert.deepEqual(unread.rows.map(row => row.id), ['untouched']);
      assert.equal(unread.total, 1);
      assert.equal((await repository.call('getThread', { id: 'untouched' })).updateHistory.filter(event => !event.seen).length,
        projectedSeen ? 2 : 3);
    } finally { await repository.close(); removeGeneratedProfile(directory); }
  }
});

it('partial non-read edits and updates arriving after mark-read retain their unseen history', async () => {
  const { stateDelta, captureStateDelta } = await import('../src/shared/state-delta.mjs');
  const { markMailboxThreadRead, isMailboxUnread } = await import('../src/svelte/lib/mailbox.js');
  const { directory } = createGeneratedProfile({});
  const repository = openStateRepository(path.join(directory, 'mark-read-updates.sqlite'));
  try {
    await repository.call('import', await canonicalizeState({
      items: [{ id: 'target', lifecycleStatus: 'in-progress', isNew: true, hasNewUpdate: true,
        updateHistory: [0, 1, 2].map(index => ({
          eventId: `old_${index}`, kind: 'update', timestamp: `2026-11-0${5 - index}T12:00:00Z`,
          summary: `Old ${index}`, seen: false,
        })) }],
    }, []));
    let base = await repository.call('projection');
    const edited = { ...base.value, items: base.value.items.map(row => ({
      ...row, severity: 'Critical', isNew: false, hasNewUpdate: false,
      updateHistory: row.updateHistory.map(event => ({ ...event, seen: true })),
    })) };
    const ordinary = stateDelta(base.value, edited);
    assert.equal(Object.hasOwn(ordinary[0], 'markRead'), false);
    await repository.call('command', { commandId: 'non-read', expectedRevision: base.revision,
      type: 'applyChanges', payload: { changes: ordinary } });
    let detail = await repository.call('getThread', { id: 'target' });
    assert.equal(detail.severity, 'Critical');
    assert.equal(detail.updateHistory.filter(event => event.seen === false).length, 2);
    base = await repository.call('projection');
    const read = markMailboxThreadRead(base.value.items[0]);
    const incoming = { eventId: 'new', kind: 'update', timestamp: '2026-11-06T12:00:00Z',
      summary: 'Arrived after mark-read', seen: false };
    const current = { ...base.value, items: [{ ...read, hasNewUpdate: true, updateHistory: [incoming, ...read.updateHistory] }] };
    const captured = captureStateDelta(base.value, current);
    assert.equal(captured.changes[0].markRead, true);
    const result = await repository.call('command', { commandId: 'read-then-update', expectedRevision: base.revision,
      type: 'applyChanges', payload: { changes: captured.changes } });
    detail = await repository.call('getThread', { id: 'target' });
    assert.equal(detail.updateHistory.length, 4);
    assert.ok(detail.updateHistory.filter(event => event.eventId !== 'new').every(event => event.seen === true));
    assert.equal(detail.updateHistory.find(event => event.eventId === 'new').seen, false);
    assert.equal(detail.hasNewUpdate, true);
    assert.equal(isMailboxUnread(detail), true);
    assert.equal((await repository.call('radarPage', { view: 'inbox', quickFilter: 'unread' })).total, 1);
    const laterEdit = { ...current, items: current.items.map(row => ({ ...row, title: 'Later edit' })) };
    assert.equal(Object.hasOwn(stateDelta(captured.included, laterEdit)[0], 'markRead'), false,
      'an acknowledged read request must not be replayed by later edits');
    const readAgain = { ...laterEdit, items: laterEdit.items.map(markMailboxThreadRead) };
    const again = stateDelta(captured.included, readAgain);
    assert.equal(again[0].markRead, true, 'a new read action must have a new request identity');
    await repository.call('command', { commandId: 'read-again', expectedRevision: result.revision,
      type: 'applyChanges', payload: { changes: again } });
    assert.equal(isMailboxUnread(await repository.call('getThread', { id: 'target' })), false);
  } finally { await repository.close(); removeGeneratedProfile(directory); }
});

it('production projections, archive pages, global Today oracle, selection and source queries are bounded', async () => {
  const { directory } = createGeneratedProfile({});
  const repository = openStateRepository(path.join(directory, 'production.sqlite'));
  try {
    const now = new Date('2026-11-05T19:00:00Z').getTime();
    const today = new Date(now).toISOString();
    const old = '2026-09-01T12:00:00Z';
    const input = await canonicalizeState({
      items: [{ id: 'hot', title: 'Hot', status: 'In progress', dueAt: '2026-11-05', scannerId: 'scanner' }],
      scanners: [{ id: 'scanner', name: 'Scanner', enabled: false }],
    }, Array.from({ length: 240 }, (_, index) => ({
      id: `cold_${String(index).padStart(3, '0')}`, title: `Cold ${index}`, sourceType: 'email',
      sourceProvider: 'outlook', sourceId: `source_${Math.floor(index / 2)}`, scannerId: 'scanner',
      status: index % 2 ? 'Archived' : 'Blocked', lifecycleStatus: index % 2 ? 'archived' : 'blocked',
      dueAt: index % 3 ? '2026-11-05' : old, completedAt: today,
      updateHistory: [
        { kind: 'lifecycle', timestamp: today, summary: 'Status changed to complete', seen: true },
        { kind: 'action', timestamp: today, event: 'succeeded', proposalId: `proposal_${index}`,
          channel: 'teams', code: 'SEND_CONFIRMED', verification: 'runtime-backend-confirmed', seen: true },
        { kind: 'lifecycle', timestamp: old, summary: 'Status changed to blocked', seen: true },
      ],
    })));
    await repository.call('import', input);
    const plan = await repository.call('queryPlan');
    assert.match(JSON.stringify(plan), /threads_archive_page/);
    const projection = await repository.call('projection');
    assert.equal(projection.value.items.length, 1);
    assert.equal(projection.value.items[0].historyPartial, true);
    const archive = await repository.call('radarPage', { view: 'archived', now, limit: 100 });
    assert.equal(archive.total, 120);
    assert.equal(archive.rows.length, 100);
    const next = await repository.call('radarPage', { view: 'archived', now, limit: 100, offset: 100, revision: archive.revision });
    assert.equal(next.rows.length, 20);
    assert.ok(!archive.rows.some(row => row.id === next.rows[0].id));
    const { buildTodayOverview, todaySelectionItems } = await import('../src/svelte/lib/today.js');
    const oracle = buildTodayOverview(input.threads.map(entry => entry.item), { now, scanners: input.scanners });
    const actual = await repository.call('today', { now });
    for (const key of ['active','overdue','blocked','completed','confirmed']) assert.equal(actual[`${key}Count`], oracle[key].length, key);
    for (const key of ['statuses','deadlines','groups','activity']) {
      assert.deepEqual(actual[key].map(bucket => [bucket.key, bucket.count]), oracle[key].map(bucket => [bucket.key, bucket.items.length]));
    }
    const selection = { kind: 'status', key: 'blocked' };
    const selected = await repository.call('today', { now, selection, offset: 100, limit: 100 });
    assert.deepEqual(selected.rows.map(row => row.id), todaySelectionItems(oracle, selection).slice(100, 200).map(row => row.id));
    assert.equal(selected.total, 120);
    const detail = await repository.call('getThread', { id: next.rows.at(-1).id });
    assert.equal(detail.updateHistory.length, 3);
    const collisions = await repository.call('collisionGroups', { limit: 100 });
    assert.equal(collisions.groups.length, 100);
    assert.ok(collisions.cursor);
    assert.ok(collisions.groups.every(group => group.sameScannerCollision && group.owners.every(owner => owner.tier === 'cold')));
    const remainder = await repository.call('collisionGroups', { limit: 100, after: collisions.cursor });
    assert.equal(remainder.groups.length, 20);
    const owners = await repository.call('sourceOwners', { identities: [collisions.groups[0].identity], ids: [detail.id] });
    assert.equal(owners.rows.length, 2);
    assert.deepEqual(owners.ids, [detail.id]);
  } finally { await repository.close(); removeGeneratedProfile(directory); }
});

it('production incremental commands are atomic, retain receipts/evidence and never reimport stale JSON', async () => {
  const { directory } = createGeneratedProfile({});
  const original = fs.readFileSync(path.join(directory, 'flightdeck-data.json'));
  let service = createStateService(directory);
  try {
    const initial = await service.query('projection');
    const target = initial.value.items[0];
    const input = { commandId: 'incremental', expectedRevision: initial.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id: target.id, patch: { severity: 'Critical' } }] } };
    const result = await service.command(input);
    assert.deepEqual(await service.command(input), result, 'lost acknowledgements retry local receipts, not external sends');
    await assert.rejects(service.command({ ...input, commandId: 'stale' }), /CONFLICT/);
    const before = await service.query('getThread', { id: target.id });
    await assert.rejects(service.command({ commandId: 'atomic-failure', expectedRevision: result.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id: target.id, patch: { title: 'must roll back' } },
        { domain: 'threads', id: 'missing', patch: { title: 'missing' } }] } }), /NOT_FOUND/);
    assert.deepEqual(await service.query('getThread', { id: target.id }), before);
    const deletion = await service.command({ commandId: 'delete', expectedRevision: result.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'deletedItemIds', id: target.id }] } });
    await assert.rejects(service.command({ commandId: 'resurrect', expectedRevision: deletion.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id: target.id, create: true, patch: { title: 'stale' } }] } }), /DELETED/);
    assert.deepEqual(fs.readFileSync(path.join(directory, 'flightdeck-data.json')), original);
    await service.close();
    service = createStateService(directory);
    assert.equal(await service.query('getThread', { id: target.id }), null);
    assert.equal((await service.query('status')).revision, deletion.revision);
  } finally { await service.close(); removeGeneratedProfile(directory); }
});

it('Today incrementally reduces histories without losing rare receipts, lifecycle evidence or calendar transitions', async () => {
  const { directory } = createGeneratedProfile({});
  const repository = openStateRepository(path.join(directory, 'incremental-today.sqlite'));
  try {
    const now = Date.parse('2026-11-05T19:00:00Z');
    const at = new Date(now - 1000).toISOString();
    const future = new Date(now + 60000).toISOString();
    const old = '2020-01-01T12:00:00Z';
    const receipt = (timestamp, proposalId, extra = {}) => ({ kind: 'action', timestamp,
      event: 'succeeded', proposalId, channel: 'teams', code: 'SEND_CONFIRMED',
      verification: 'runtime-backend-confirmed', ...extra });
    const input = await canonicalizeState({
      items: [{ id: 'awake', status: 'Blocked', lifecycleStatus: 'blocked', dueAt: '2026-11-05', severity: 'Critical',
        snoozeUntil: future, updateHistory: [] }],
      scanners: [{ id: 'scanner', name: 'Scanner' }],
    }, Array.from({ length: 180 }, (_, index) => ({
      id: `archive_${String(index).padStart(3, '0')}`, lifecycleStatus: 'archived', scannerId: 'scanner',
      completedAt: at,
      updateHistory: [
        ...Array.from({ length: 12 }, (_, ordinal) => ({
          kind: 'update', timestamp: old, summary: `Long old history ${ordinal}`, seen: true,
        })),
        ...Array.from({ length: 12 }, (_, ordinal) => receipt(old, `old-${ordinal}`, { verification: '' })),
        ...(index === 179 ? [
          receipt('2026-11-04T12:00:00Z', 'repeated-day'),
          receipt(at, 'repeated-day'), receipt(at, 'rare-receipt'),
          receipt(future, 'future-receipt'), receipt(at, 'unverified', { verification: '' }),
          { kind: 'lifecycle', timestamp: at, summary: 'Status changed to complete' },
          { kind: 'lifecycle', timestamp: old, summary: 'Status changed to blocked' },
          { kind: 'lifecycle', timestamp: future, summary: 'Status changed to archived' },
          { kind: 'reply', timestamp: at, eventId: 'duplicate-event', summary: 'Rare update' },
          { kind: 'reply', timestamp: at, eventId: 'duplicate-event', summary: 'Duplicate update' },
        ] : [{ kind: 'lifecycle', timestamp: old, summary: 'Status changed to blocked' }]),
        ...(index === 0 ? [receipt(at, 'rare-receipt')] : []),
      ],
    })));
    await repository.call('import', input);
    const items = new Map(input.threads.map(entry => [entry.item.id, entry.item]));
    const { buildTodayOverview, todaySelectionItems } = await import('../src/svelte/lib/today.js');
    const check = async time => {
      const oracle = buildTodayOverview([...items.values()].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))),
        { now: time, scanners: input.scanners });
      const actual = await repository.call('today', { now: time });
      for (const key of ['active','overdue','blocked','dueToday','completed','confirmed']) {
        assert.equal(actual[`${key}Count`], oracle[key].length, key);
      }
      assert.deepEqual(actual.confirmed.map(entry => [entry.item.id, entry.id]), oracle.confirmed.slice(0, 5).map(entry => [entry.item.id, entry.id]));
      assert.deepEqual(actual.completed.map(entry => entry.item.id), oracle.completed.slice(0, 5).map(entry => entry.item.id));
      assert.deepEqual(actual.attention.map(entry => [entry.item.id, entry.reason]), oracle.attention.map(entry => [entry.item.id, entry.reason]));
      assert.equal(actual.nextMove?.id, oracle.nextMove?.id);
      for (const [kind, key] of Object.entries({ status: 'statuses', deadline: 'deadlines', scanner: 'groups', activity: 'activity' })) {
        assert.deepEqual(actual[key].map(bucket => [bucket.key, bucket.count, bucket.counts]),
          oracle[key].map(bucket => [bucket.key, bucket.items.length, bucket.counts]));
        for (const bucket of oracle[key]) {
          const selection = { kind, key: bucket.key };
          const expected = todaySelectionItems(oracle, selection);
          const selected = await repository.call('today', { now: time, selection, offset: 0, limit: 100 });
          assert.equal(selected.total, expected.length);
          assert.deepEqual(selected.rows.map(item => item.id), expected.slice(0, 100).map(item => item.id));
        }
      }
    };
    await check(now);
    const initialToday = await repository.call('today', { now });
    assert.equal(initialToday.completedCount, 1, 'rare retained completion survives older lifecycle evidence');
    assert.equal(initialToday.confirmedCount, 2, 'rare verified receipts survive cross-thread and cross-day duplicates');
    const before = (await repository.call('status')).todayProjection;
    let revision = (await repository.call('status')).revision;
    const mutate = async changes => {
      const result = await repository.call('command', { commandId: `incremental-${revision}`, expectedRevision: revision,
        type: 'applyChanges', payload: { changes } });
      revision = result.revision;
    };
    const target = items.get('archive_179');
    const updateHistory = [{ kind: 'lifecycle', timestamp: new Date(now).toISOString(), summary: 'Status changed to blocked' }, ...target.updateHistory];
    await mutate([{ domain: 'threads', id: target.id, patch: { status: 'Blocked', lifecycleStatus: 'blocked', updateHistory } }]);
    items.set(target.id, { ...target, status: 'Blocked', lifecycleStatus: 'blocked', updateHistory });
    await check(now);
    const after = (await repository.call('status')).todayProjection;
    assert.equal(after.threadsRebuilt - before.threadsRebuilt, 1, 'one edit must not rebuild unrelated threads');
    assert.equal(after.eventsRead - before.eventsRead, updateHistory.length, 'one edit must not reread retained unrelated histories');
    await check(now + 60000);
    await check(now - 2000);
    await check(Date.parse('2026-11-06T19:00:00Z'));
    await mutate([{ domain: 'deletedItemIds', id: 'archive_000' }]);
    items.delete('archive_000');
    await check(now);
    await mutate([{ domain: 'threads', id: 'aaaa-created', create: true, patch: {
      status: 'In progress', lifecycleStatus: 'in-progress', scannerId: 'scanner',
      updateHistory: [receipt(at, 'rare-receipt')],
    } }]);
    items.set('aaaa-created', await repository.call('getThread', { id: 'aaaa-created' }));
    await check(now + 2);
    const unicodeIds = ['unicode_\uE000', 'unicode_\u{10000}'];
    await mutate(unicodeIds.map(id => ({ domain: 'threads', id, create: true, patch: {
      status: 'In progress', updateHistory: [receipt(at, 'unicode-receipt')],
    } })));
    for (const id of unicodeIds) items.set(id, await repository.call('getThread', { id }));
    await check(now + 2);
    await assert.rejects(repository.call('command', {
      commandId: 'rolled-back-history-reduction', expectedRevision: revision, type: 'applyChanges',
      payload: { changes: [
        { domain: 'threads', id: 'aaaa-created', patch: { severity: 'Critical', updateHistory: [] } },
        { domain: 'threads', id: 'missing', patch: { severity: 'Critical' } },
      ] },
    }), /NOT_FOUND/);
    await check(now + 3);
    const stats = (await repository.call('status')).todayProjection;
    await mutate([{ domain: 'preferences', id: 'meetings', value: [] }]);
    await check(now + 4);
    assert.deepEqual((await repository.call('status')).todayProjection, stats, 'unrelated preference edits must not reread histories');
    await repository.call('integrity');
  } finally { await repository.close(); removeGeneratedProfile(directory); }
});

it('indexed Radar archive pages retain facet counts, rare unread evidence, priority order and revision cursors', async () => {
  const { directory } = createGeneratedProfile({});
  const repository = openStateRepository(path.join(directory, 'indexed-radar.sqlite'));
  try {
    const now = Date.parse('2026-11-05T19:00:00Z');
    const input = await canonicalizeState({ items: [], scanners: [{ id: 'scanner', name: 'Scanner' }] },
      Array.from({ length: 240 }, (_, index) => ({
        id: `thread_${String(index).padStart(3, '0')}`, title: `Title ${index}`,
        lifecycleStatus: index % 4 ? 'archived' : 'complete',
        severity: ['Observe', 'Elevated', 'Critical'][index % 3], scannerId: 'scanner',
        isNew: index === 7, hasNewUpdate: index === 11,
        sourceType: index % 2 ? 'email' : 'teams',
        evidenceLinks: index % 5 ? [] : [{ type: 'meeting' }],
        dueAt: index % 2 ? '2026-11-04' : '2026-11-20',
        monitorEnabled: index % 2 === 0, monitorPaused: index % 3 === 0,
        lastChangedAt: new Date(now - index * 86400000).toISOString(),
        updateHistory: Array.from({ length: 40 }, (_, ordinal) => ({
          kind: ordinal < 20 ? 'update' : 'action', summary: `History ${ordinal}`, timestamp: '2020-01-01T00:00:00Z',
          seen: !(index === 239 && ordinal === 19),
        })),
      })));
    await repository.call('import', input);
    assert.equal((await repository.call('radarPage', { view: 'archived', quickFilter: 'unread', now })).total, 3,
      'unseen evidence outside the one-event projection remains selectable');
    const { matchesInboxFilters } = await import('../src/svelte/lib/inbox-filters.js');
    const { compareMailboxThreads, compareInboxThreads } = await import('../src/svelte/lib/mailbox.js');
    const filters = [
      {}, { quickFilter: 'unread' }, { quickFilter: 'critical' }, { quickFilter: 'due-soon' },
      { quickFilter: 'new' }, { quickFilter: 'updated' }, { quickFilter: 'blocked' }, { quickFilter: 'constructor' },
      ...Object.entries({ severity: ['Elevated'], lifecycle: ['archived'], scanner: ['scanner'],
        read: ['read'], monitoring: ['paused'], due: ['overdue', 'none'], signal: ['meeting'],
        'activity-age': ['older'] }).map(([key, value]) => ({ refineFilters: { [key]: value } })),
      { refineFilters: { read: ['unread'], severity: ['Critical'], signal: ['email'] } },
    ];
    for (const sort of ['activity', 'priority']) {
      for (const filter of filters) {
        const expected = input.threads.map(entry => entry.item).filter(item => item.lifecycleStatus === 'archived')
          .filter(item => matchesInboxFilters(item, { quickFilter: filter.quickFilter, facets: filter.refineFilters }, { now }))
          .sort(sort === 'priority' ? compareMailboxThreads : compareInboxThreads);
        for (const offset of [0, 100]) {
          const actual = await repository.call('radarPage', { view: 'archived', now, sort, ...filter, offset, limit: 100 });
          assert.equal(actual.total, expected.length, JSON.stringify(filter));
          assert.deepEqual(actual.rows.map(item => item.id), expected.slice(offset, offset + 100).map(item => item.id));
          assert.equal(actual.more, offset + 100 < expected.length);
          assert.equal(actual.counts.archived, 180);
          assert.equal(actual.counts.completed, 60);
        }
      }
    }
    const page = await repository.call('radarPage', { view: 'archived', now, limit: 100 });
    await repository.call('command', { commandId: 'archive-mutation', expectedRevision: page.revision, type: 'applyChanges',
      payload: { changes: [{ domain: 'threads', id: 'thread_239', patch: { status: 'Blocked', lifecycleStatus: 'blocked' } }] } });
    await assert.rejects(repository.call('radarPage', { view: 'archived', revision: page.revision, offset: 100 }), /CURSOR_EXPIRED/);
    assert.equal((await repository.call('radarPage', { view: 'archived', quickFilter: 'unread', now })).total, 2);
  } finally { await repository.close(); removeGeneratedProfile(directory); }
});

it('production read retry reopens a repaired profile and demo reseeding refuses normal profiles', async () => {
  const { directory } = createGeneratedProfile({});
  const file = path.join(directory, 'flightdeck-data.json');
  const original = fs.readFileSync(file);
  const service = createStateService(directory);
  try {
    fs.writeFileSync(file, '{invalid');
    await assert.rejects(service.query('projection'), /IMPORT_READ_FAILED/);
    fs.writeFileSync(file, original);
    assert.ok((await service.query('projection')).value.items.length);
    await assert.rejects(service.command({ type: 'reseedDemo' }), /DEMO_ONLY/);
  } finally { await service.close(); removeGeneratedProfile(directory); }
});

it('main leases elect one scheduled owner, allow idle popout actions and release after navigation/crash', () => {
  const service = createStateService('unused-no-query');
  const a = new EventEmitter(), b = new EventEmitter();
  assert.equal(service.acquireEngine(a, { key: 'scanner:a', scheduled: true }), true);
  assert.equal(service.acquireEngine(b, { key: 'scanner:b', scheduled: true }), false);
  assert.equal(service.acquireEngine(b, 'scanner:a'), false);
  service.releaseEngine(a, 'scanner:a');
  assert.equal(service.acquireEngine(b, 'scanner:a'), true);
  b.emit('render-process-gone');
  assert.equal(service.acquireEngine(a, 'scanner:a'), true);
  a.emit('did-start-navigation', {}, 'file:generated', false, true);
  assert.equal(service.acquireEngine(b, { key: 'scanner:a', scheduled: true }), true);
});

it('demo reseeding is transactional and cannot change the normal repository', async () => {
  const { directory } = createGeneratedProfile({});
  const normal = createStateService(directory);
  const demo = createStateService(directory, { demo: true });
  try {
    const before = await normal.query('projection');
    const initial = await demo.query('projection');
    await demo.command({ commandId: 'demo-reseed', expectedRevision: initial.revision, type: 'reseedDemo',
      payload: { changes: [{ domain: 'threads', id: 'demo-only', create: true, patch: { title: 'Demo reseed' } }] } });
    assert.deepEqual((await demo.query('projection')).value.items.map(item => item.id), ['demo-only']);
    assert.deepEqual(await normal.query('projection'), before);
  } finally { await normal.close(); await demo.close(); removeGeneratedProfile(directory); }
});

it('due monitoring queries include cold active records without hydrating the archive', async () => {
  const { directory } = createGeneratedProfile({});
  const repository = openStateRepository(path.join(directory, 'monitoring.sqlite'));
  try {
    const now = new Date('2026-11-05T12:00:00Z').getTime();
    const base = { lifecycleStatus: 'in-progress', monitorEnabled: true, nextRunAt: '2026-11-04T12:00:00Z' };
    await repository.call('import', await canonicalizeState({ items: [] }, [
      { ...base, id: 'cold-due' },
      { ...base, id: 'cold-snoozed', snoozeUntil: '2026-11-06T12:00:00Z' },
      { ...base, id: 'cold-complete', lifecycleStatus: 'complete' },
      { ...base, id: 'cold-future', nextRunAt: '2026-11-06T12:00:00Z' },
    ]));
    assert.equal((await repository.call('projection')).value.items.length, 0);
    const due = await repository.call('dueMonitors', { now, limit: 1 });
    assert.deepEqual(due.rows.map(item => item.id), ['cold-due']);
    assert.equal(due.rows[0].historyPartial, true);
  } finally { await repository.close(); removeGeneratedProfile(directory); }
});

it('empty scanner acceptance still persists scheduling metadata once', async () => {
  const { directory } = createGeneratedProfile({});
  const service = createStateService(directory);
  try {
    const initial = await service.query('projection');
    const scanner = initial.value.scanners[0];
    const enabled = await service.command({ commandId: 'enable', expectedRevision: initial.revision, type: 'saveScanner',
      payload: { scanner: { ...scanner, enabled: true } } });
    const nextRunAt = '2027-01-01T12:00:00Z';
    await service.command({ commandId: 'empty-result', expectedRevision: enabled.revision, type: 'acceptScannerResults',
      payload: { scannerId: scanner.id, items: [], scannerPatch: { nextRunAt } } });
    assert.equal((await service.query('projection')).value.scanners.find(row => row.id === scanner.id).nextRunAt, nextRunAt);
  } finally { await service.close(); removeGeneratedProfile(directory); }
});

it('null canonical state and null cold arrays refuse migration instead of resurrecting legacy keys', async () => {
  for (const coldNull of [false, true]) {
    const { directory } = createGeneratedProfile({});
    try {
      if (coldNull) fs.writeFileSync(path.join(directory, 'flightdeck-cold.json'), '{"items":null}');
      else fs.writeFileSync(path.join(directory, 'flightdeck-data.json'), JSON.stringify({
        'flightdeck.persisted.v2': null, 'flightdeck.persisted.v1': { items: [{ id: 'stale' }] },
      }));
      await assert.rejects(migrateStateProfile(directory), /MALFORMED_IMPORT/);
      assert.equal(fs.existsSync(path.join(directory, 'state-normal', 'state.sqlite')), false);
    } finally { removeGeneratedProfile(directory); }
  }
});

it('Today database aggregates match the local calendar oracle across DST and date-only deadlines', async () => {
  const originalZone = process.env.TZ;
  try {
    for (const zone of ['America/New_York', 'Europe/Berlin', 'Pacific/Auckland']) {
      process.env.TZ = zone;
      const { directory } = createGeneratedProfile({});
      const repository = openStateRepository(path.join(directory, 'timezone.sqlite'));
      try {
        const now = Date.parse('2026-11-01T18:00:00Z');
        const input = await canonicalizeState({ items: [
          { id: 'deadline', status: 'In progress', dueAt: '2026-11-01' },
          { id: 'snoozed', status: 'Blocked', snoozeUntil: '2026-11-02T00:00:00Z' },
          { id: 'completed', status: 'Archived', completedAt: '2026-11-01T06:30:00Z', updateHistory: [
            { kind: 'lifecycle', timestamp: '2026-11-01T07:00:00Z', summary: 'Status changed to archived' },
            { kind: 'lifecycle', timestamp: '2026-11-01T06:30:00Z', summary: 'Status changed to complete' },
          ] },
          { id: 'reopened', status: 'Archived', completedAt: '2026-11-01T06:00:00Z', updateHistory: [
            { kind: 'lifecycle', timestamp: '2026-11-01T07:00:00Z', summary: 'Status changed to in-progress' },
          ] },
        ] });
        await repository.call('import', input);
        const { buildTodayOverview } = await import('../src/svelte/lib/today.js');
        const oracle = buildTodayOverview(input.threads.map(entry => entry.item), { now });
        const actual = await repository.call('today', { now });
        assert.equal(actual.activeCount, oracle.active.length, zone);
        assert.equal(actual.completedCount, oracle.completed.length, zone);
        assert.deepEqual(actual.deadlines.map(bucket => bucket.count), oracle.deadlines.map(bucket => bucket.items.length), zone);
        assert.deepEqual(actual.activity.map(bucket => bucket.counts), oracle.activity.map(bucket => bucket.counts), zone);
      } finally { await repository.close(); removeGeneratedProfile(directory); }
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});

it('normalized worker imports, pages, CAS edits, idempotent receipts, deletes and restarts without resurrection', async () => {
  const { directory, fixture } = createGeneratedProfile({ size: 'small' });
  let repository;
  try {
    repository = await migrateStateProfile(directory);
    let status = await repository.call('status');
    assert.equal(status.counts.threads, 100);
    assert.equal(status.schemaVersion, 1);
    assert.ok(status.counts.sources >= 100);
    const page = await repository.call('listThreads', { limit: 3 });
    assert.equal(page.rows.length, 3);
    assert.ok(page.cursor);
    assert.equal(Object.hasOwn(page.rows[0], 'updateHistory'), false);
    const next = await repository.call('listThreads', { limit: 3, cursor: page.cursor });
    assert.notEqual(page.rows[0].id, next.rows[0].id);
    const thread = await repository.call('getThread', { id: page.rows[0].id });
    assert.ok((await repository.call('listHistory', { id: thread.id, limit: 1 })).rows.length <= 1);
    const command = {
      commandId: 'change', type: 'patchThread', expectedRevision: status.revision,
      payload: { id: thread.id, expectedRecordRevision: thread.repositoryRevision, patch: { severity: 'Critical' } },
    };
    const receipt = await repository.call('command', command);
    assert.equal(receipt.revision, 2);
    assert.deepEqual(await repository.call('command', command), receipt);
    await assert.rejects(repository.call('command', { ...command, payload: { ...command.payload, patch: { severity: 'Observe' } } }), /COMMAND_ID_REUSED/);
    await assert.rejects(repository.call('command', { ...command, commandId: 'stale' }), /CONFLICT/);
    await assert.rejects(repository.call('listThreads', { cursor: page.cursor }), /CURSOR_EXPIRED/);
    await assert.rejects(repository.call('listThreads', { limit: 101 }), /INVALID_LIMIT/);
    assert.match(JSON.stringify(await repository.call('queryPlan')), /source_identity/);
    await repository.call('command', { commandId: 'delete', type: 'deleteThread', expectedRevision: 2, payload: { id: thread.id } });
    const backupPath = path.join(directory, 'verified-backup.sqlite');
    await repository.call('backup', { path: backupPath });
    const restored = openStateRepository(backupPath);
    try {
      assert.equal((await restored.call('integrity')).ok, true);
      assert.equal((await restored.call('status')).revision, 3);
      assert.equal(await restored.call('getThread', { id: thread.id }), null);
    } finally { await restored.close(); }
    assert.equal((await repository.call('integrity')).ok, true);
    await repository.close();
    repository = await migrateStateProfile(directory);
    assert.equal(await repository.call('getThread', { id: thread.id }), null);
    assert.equal((await repository.call('status')).revision, 3);
    assert.equal(fixture.state.items.length, 100, 'original fixture/JSON remains unchanged backup-only input');
  } finally { await repository?.close(); removeGeneratedProfile(directory); }
});

it('deletion retains thread-local action evidence even when global audit history is empty', async () => {
  const { directory } = createGeneratedProfile({});
  const repository = openStateRepository(path.join(directory, 'evidence.sqlite'));
  try {
    const event = { kind: 'action', proposalId: 'effect', timestamp: '2026-09-01T12:00:00Z', event: 'succeeded' };
    await repository.call('import', await canonicalizeState({
      items: [{ id: 'target', updateHistory: [event] }], history: [],
    }));
    await repository.call('command', {
      commandId: 'delete', expectedRevision: 1, type: 'deleteThread', payload: { id: 'target' },
    });
    assert.equal(await repository.call('getThread', { id: 'target' }), null);
    const retained = await repository.call('listRetainedEvidence', { id: 'target', limit: 1 });
    assert.equal(retained.rows.length, 1);
    assert.equal(retained.rows[0].proposalId, 'effect');
    assert.equal(retained.rows[0].event, 'succeeded');
    assert.deepEqual((await repository.call('listRetainedEvidence', { id: 'target', after: 0 })).rows, []);
  } finally { await repository.close(); removeGeneratedProfile(directory); }
});

it('same-scan and concurrent scan source dedup is transactional, cross-scanner duplicates remain allowed', async () => {
  const { directory } = createGeneratedProfile({});
  const repository = openStateRepository(path.join(directory, 'dedup.sqlite'));
  try {
    await repository.call('import', await canonicalizeState({
      items: [], scanners: [{ id: 'a', enabled: true }, { id: 'b', enabled: true, crossScannerDedup: false }],
    }));
    const source = { sourceType: 'email', sourceProvider: 'outlook', sourceId: 'same-message' };
    const command = (commandId, scannerId, ids, expectedRevision) => ({
      commandId, expectedRevision, type: 'acceptScannerResults',
      payload: { scannerId, items: ids.map(id => ({ id, title: id, ...source })) },
    });
    const first = await repository.call('command', command('first', 'a', ['a1', 'a2'], 1));
    assert.deepEqual(first.changedIds, ['a1']);
    const second = await repository.call('command', command('second', 'a', ['a3'], 2));
    assert.deepEqual(second.changedIds, []);
    const allowed = await repository.call('command', command('allowed', 'b', ['b1'], 3));
    assert.deepEqual(allowed.changedIds, ['b1']);
    const report = await repository.call('sourceCollisions', { limit: 100 });
    assert.equal(report.rows.length, 2);
    await repository.call('command', { commandId: 'delete-scanner', expectedRevision: 4, type: 'deleteScanner',
      payload: { id: 'a', disposition: 'reassign', targetScannerId: 'b' } });
    assert.equal((await repository.call('getThread', { id: 'a1' })).scannerId, 'b');
    await assert.rejects(repository.call('command', command('late-scan', 'a', ['late'], 5)), /SCANNER_DELETED/);
  } finally { await repository.close(); removeGeneratedProfile(directory); }
});

it('canonical import preserves empty precedence, hot-over-cold IDs, tombstones, deterministic IDs and rejects conflicting duplicates', async () => {
  const empty = await canonicalizeState({ items: [], trackingItems: [{ id: 'legacy' }] }, []);
  assert.deepEqual(empty.threads, []);
  const input = {
    trackingItems: [{ id: 'same', title: 'tracking' }, { id: 'deleted' }],
    radarItems: [{ id: 'same', title: 'radar' }, { title: 'No ID' }], deletedItemIds: ['deleted'],
  };
  const first = await canonicalizeState(input, [{ id: 'same', title: 'cold' }]);
  const second = await canonicalizeState(input, [{ id: 'same', title: 'cold' }]);
  assert.deepEqual(first.threads.map(entry => entry.item.id), second.threads.map(entry => entry.item.id));
  assert.deepEqual(first.originals.assignedIds, second.originals.assignedIds);
  assert.equal(first.threads.find(entry => entry.item.id === 'same').item.title, 'tracking');
  assert.ok(!first.threads.some(entry => entry.item.id === 'deleted'));
  await assert.rejects(canonicalizeState({ items: [{ id: 'one', title: 'first' }, { id: 'one', title: 'second' }] }), /DUPLICATE_ID_CONFLICT/);
  await assert.rejects(canonicalizeState({ items: {} }), /MALFORMED_IMPORT/);
});

it('migration restarts safely after each import boundary and refuses malformed input without modifying originals', async () => {
  for (const boundary of ['canonicalized', 'backup-verified', 'import-committed', 'staging-closed', 'database-renamed', 'marker-written']) {
    const { directory } = createGeneratedProfile({});
    let repository;
    try {
      const original = fs.readFileSync(path.join(directory, 'flightdeck-data.json'));
      await assert.rejects(migrateStateProfile(directory, {
        fault: phase => { if (phase === boundary) throw new Error('injected-interruption'); },
      }), /injected-interruption/);
      repository = await migrateStateProfile(directory);
      assert.equal((await repository.call('status')).counts.threads, 100, boundary);
      assert.deepEqual(fs.readFileSync(path.join(directory, 'flightdeck-data.json')), original);
    } finally { await repository?.close(); removeGeneratedProfile(directory); }
  }
  const { directory } = createGeneratedProfile({});
  try {
    const file = path.join(directory, 'flightdeck-data.json');
    fs.writeFileSync(file, '{broken');
    await assert.rejects(migrateStateProfile(directory), /IMPORT_READ_FAILED/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { removeGeneratedProfile(directory); }
});

it('newer schema, corrupt databases, missing active databases and SQLite busy writes fail closed', async () => {
  const { directory } = createGeneratedProfile({});
  let repository;
  try {
    const file = path.join(directory, 'future.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA user_version=999'); db.close();
    repository = openStateRepository(file);
    await assert.rejects(repository.call('status'));
    await repository.close();
    const corrupt = path.join(directory, 'corrupt.sqlite');
    fs.writeFileSync(corrupt, 'not a database');
    repository = openStateRepository(corrupt);
    await assert.rejects(repository.call('status'));
    await repository.close();
    repository = await migrateStateProfile(directory);
    const locker = new DatabaseSync(path.join(directory, 'state-normal', 'state.sqlite'));
    locker.exec('BEGIN IMMEDIATE');
    try {
      await assert.rejects(repository.call('command', {
        commandId: 'busy', type: 'patchPreference', expectedRevision: 1, payload: { key: 'density', value: 'minimal' },
      }));
    } finally { locker.exec('ROLLBACK'); locker.close(); }
    assert.equal((await repository.call('status')).revision, 1);
  } finally { await repository?.close(); removeGeneratedProfile(directory); }
});
