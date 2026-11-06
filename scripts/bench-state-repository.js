'use strict';
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const fs = require('node:fs');
const { createGeneratedProfile, removeGeneratedProfile } = require('../test/fixtures/state-profile');
const { migrateStateProfile } = require('../src/main/state-migration');
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, medianMs: (sorted[14] + sorted[15]) / 2, p95Ms: sorted[28],
    maxMs: sorted.at(-1), rawMs: values };
}
async function main() {
  const scenarios = [];
  for (const size of process.argv.includes('--xlarge') ? ['large', 'xlarge'] : ['small', 'large']) {
    const { directory, fixture } = createGeneratedProfile({ size });
    let repository;
    try {
      const start = performance.now();
      repository = await migrateStateProfile(directory);
      const importMs = performance.now() - start;
      const status = await repository.call('status');
      const pages = [], edits = [], payloadBytes = [], radarFirstPages = [], radarPages = [],
        radarFacetPages = [], radarPriorityPages = [], radarSeverityPages = [], todayQueries = [];
      let revision = status.revision;
      const first = (await repository.call('listThreads', { residency: 'hot', limit: 100 })).rows[0];
      const coldTodayStart = performance.now();
      await repository.call('today', { now: Date.now() });
      const coldTodayMs = performance.now() - coldTodayStart;
      const projectionBefore = (await repository.call('status')).todayProjection;
      for (let index = 0; index < 30; index++) {
        let started = performance.now();
        const page = await repository.call('listThreads', { residency: fixture.cold.length ? 'cold' : 'hot', limit: 100 });
        pages.push(performance.now() - started);
        payloadBytes.push(Buffer.byteLength(JSON.stringify(page)));
        started = performance.now();
        await repository.call('radarPage', { view: 'archived', limit: 100 });
        radarFirstPages.push(performance.now() - started);
        started = performance.now();
        await repository.call('radarPage', { view: 'archived', limit: 100, offset: 100 });
        radarPages.push(performance.now() - started);
        started = performance.now();
        await repository.call('radarPage', { view: 'archived', quickFilter: 'unread', limit: 100, offset: 100 });
        radarFacetPages.push(performance.now() - started);
        started = performance.now();
        await repository.call('radarPage', { view: 'archived', sort: 'priority', limit: 100, offset: 100 });
        radarPriorityPages.push(performance.now() - started);
        started = performance.now();
        await repository.call('radarPage', { view: 'archived', refineFilters: { severity: ['Observe'] }, limit: 100, offset: 100 });
        radarSeverityPages.push(performance.now() - started);
        started = performance.now();
        const day = new Date();
        const dueAt = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const result = await repository.call('command', {
          commandId: `benchmark-${index}`, expectedRevision: revision, type: 'applyChanges',
          payload: { changes: [{ domain: 'threads', id: first.id,
            patch: { severity: index % 2 ? 'Critical' : 'Observe', dueAt: index % 2 ? dueAt : null } }] },
        });
        edits.push(performance.now() - started);
        revision = result.revision;
        started = performance.now();
        const today = await repository.call('today', { now: Date.now() });
        todayQueries.push(performance.now() - started);
        if (today.dueTodayCount !== index % 2) throw new Error('Production Today did not observe relevant deadline edit');
      }
      const projectionAfter = (await repository.call('status')).todayProjection;
      if (projectionAfter.threadsRebuilt - projectionBefore.threadsRebuilt !== 30
        || projectionAfter.eventsRead - projectionBefore.eventsRead !== 30 * fixture.state.items.find(item => item.id === first.id).updateHistory.length) {
        throw new Error('Single-thread edits rescanned unrelated retained histories');
      }
      const plan = await repository.call('queryPlan');
      await repository.call('integrity');
      scenarios.push({
        size, hotCount: fixture.state.items.length, coldCount: fixture.cold.length,
        importMs, status, firstPage: stats(pages), incrementalEdit: stats(edits),
        radarFirstPage: stats(radarFirstPages), radarSecondPage: stats(radarPages),
        radarUnreadSecondPage: stats(radarFacetPages), globalToday: stats(todayQueries), coldTodayMs,
        radarPrioritySecondPage: stats(radarPriorityPages), radarSeveritySecondPage: stats(radarSeverityPages),
        todayProjectionDelta: { threadsRebuilt: projectionAfter.threadsRebuilt - projectionBefore.threadsRebuilt,
          eventsRead: projectionAfter.eventsRead - projectionBefore.eventsRead },
        maxPageJsonBytes: Math.max(...payloadBytes), queryPlan: plan,
        note: 'Production worker RPC under Node IPC; not Electron UI timing. FULL synchronous WAL. All 30 Today samples immediately follow an active-thread deadline/severity revision, with counts asserted. First uncached Today is reported separately. Original retained fixtures/history are unchanged.',
      });
      console.log(`${size}: 30 bounded-page and incremental-edit samples passed`);
    } finally { await repository?.close(); removeGeneratedProfile(directory); }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'test-results', 'state-reload', 'sqlite-node-candidate.json'),
    JSON.stringify({ runtime: { node: process.version, platform: process.platform, arch: process.arch }, scenarios }, null, 2));
}
main().catch(failure => { console.error(failure.stack); process.exitCode = 1; });
