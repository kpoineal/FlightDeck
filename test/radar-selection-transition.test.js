import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { nextRadarSelectionAfterRemoval, reconcileRadarSelection } from '../src/svelte/lib/radar-selection.js';

test('reconcileRadarSelection clears stale selected thread and resets detail view without altering filters', () => {
  const state = {
    selectedId: 't2',
    mobileStep: 'detail',
    smartView: 'priority',
    scannerId: 'all',
    query: 'alpha',
  };
  const result = reconcileRadarSelection(state, [{ id: 't1' }, { id: 't3' }]);

  assert.equal(result.selectedId, null);
  assert.equal(result.mobileStep, 'list');
  assert.equal(result.smartView, 'priority');
  assert.equal(result.scannerId, 'all');
  assert.equal(result.query, 'alpha');
  assert.equal(state.selectedId, 't2');
  assert.equal(state.mobileStep, 'detail');
});

test('reconcileRadarSelection preserves visible selection and keeps state stable', () => {
  const state = {
    selectedId: 't2',
    mobileStep: 'detail',
    smartView: 'all',
    scannerId: 'scanner-7',
    query: 'beta',
  };
  const result = reconcileRadarSelection(state, [{ id: 't1' }, { id: 't2' }, { id: 't3' }]);

  assert.equal(result.selectedId, 't2');
  assert.equal(result.mobileStep, 'detail');
  assert.equal(result.smartView, 'all');
  assert.equal(result.scannerId, 'scanner-7');
  assert.equal(result.query, 'beta');
});

test('reconcileRadarSelection preserves a live external selection while its target view settles', () => {
  const state = {
    selectedId: 't2',
    mobileStep: 'detail',
    smartView: 'inbox',
    scannerId: 'all',
    query: '',
  };
  const result = reconcileRadarSelection(state, [{ id: 't1' }], { preserveId: 't2' });

  assert.equal(result.selectedId, 't2');
  assert.equal(result.mobileStep, 'detail');
  assert.equal(state.selectedId, 't2');
});

test('nextRadarSelectionAfterRemoval chooses next, then previous, then empty', () => {
  const threads = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];

  assert.equal(nextRadarSelectionAfterRemoval(threads, 't2'), 't3');
  assert.equal(nextRadarSelectionAfterRemoval(threads, 't3'), 't2');
  assert.equal(nextRadarSelectionAfterRemoval([{ id: 't1' }], 't1'), null);
  assert.equal(nextRadarSelectionAfterRemoval(threads, 'missing'), null);
});

test('RadarView source uses helper and has no fallback to first visible thread', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  assert.match(source, /reconcileRadarSelection/);
  assert.doesNotMatch(source, /threads\[0\]/);
});

test('RadarView imports normalizeItem for the mounted Add Item path', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const createTask = source.match(/function createTask\(data\).*?\n  \}/s)?.[0] || '';

  assert.match(source, /import\s*\{[^}]*\bnormalizeItem\b[^}]*\}\s*from '\.\.\/lib\/models\/item\.js'/s);
  assert.match(createTask, /const item = normalizeItem\(\{/);
});

test('Today urgent work uses the canonical blocked lifecycle regardless of severity', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/TodayView.svelte', import.meta.url), 'utf8');
  const urgent = source.match(/let urgent = \$derived\((.*?)\);/s)?.[1] || '';

  assert.match(urgent, /item\.lifecycleStatus === 'blocked'/);
  assert.doesNotMatch(urgent, /item\.isBlocked/);
});

test('Radar Teams review preserves and displays synthesis rationale, risk, and review note', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const assignment = source.match(/teamsDraft = \{\s*proposalId:.*?needsTargetResolution:.*?\n\s*\};/s)?.[0] || '';
  const editor = source.match(/<section class="radar-teams-draft".*?<\/section>/s)?.[0] || '';

  assert.match(assignment, /why:\s*result\.why/);
  assert.match(assignment, /risk:\s*proposal\.risk/);
  assert.match(assignment, /reviewNote:\s*proposal\.reviewNote/);
  assert.match(editor, /teamsDraft\.why/);
  assert.match(editor, /teamsDraft\.risk/);
  assert.match(editor, /teamsDraft\.reviewNote/);
});

test('Radar approved detail surfaces completion confidence', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');

  assert.match(source, /Completion confidence/i);
  assert.match(source, /selected\.completionConfidence/);
});

test('RadarView external navigation focuses and scrolls the matching rendered row', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');

  assert.match(source, /pendingNavigationId/);
  assert.match(source, /resolveRadarItem\(requestedId\)/);
  assert.match(source, /data-thread-id="\$\{CSS\.escape\(highlighted\.id\)\}"/);
  assert.match(source, /row\.scrollIntoView\(\{ behavior: 'smooth', block: 'nearest' \}\)/);
  assert.match(source, /row\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /radar-thread-detail h2.*\.focus\(\)/s);
  assert.match(source, /hydrateRadarColdItems/);
  assert.doesNotMatch(source, /window\.workiq\?\.getColdItems|window\.workiq\.getColdItems/);
});

test('Today, History, and Action Queue retain the shared Radar external navigation request', () => {
  const sources = [
    fs.readFileSync(new URL('../src/svelte/components/TodayView.svelte', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/svelte/components/HistoryView.svelte', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../src/svelte/components/ActionQueue.svelte', import.meta.url), 'utf8'),
  ];

  for (const source of sources) {
    assert.match(source, /navigateToRadarItem/);
  }
});

test('History and Heatmap resolve cold IDs through shared Radar navigation', () => {
  const history = fs.readFileSync(new URL('../src/svelte/components/HistoryView.svelte', import.meta.url), 'utf8');
  const heatmap = fs.readFileSync(new URL('../src/svelte/components/status-bars/HeatmapStrip.svelte', import.meta.url), 'utf8');

  assert.match(history, /void navigateToRadarItem\(itemId\)/);
  assert.doesNotMatch(history, /\$items\.some\(\(item\) => item\.id === itemId\)/);
  assert.match(heatmap, /void navigateToRadarItem\(item\.id\)/);
});

test('RadarView presents Inbox first and by default without legacy active or unread views', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const viewsSource = source.match(/const VIEWS = \[(.*?)\n  \];/s)?.[1] || '';
  const views = [...viewsSource.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)]
    .map(([, id, label]) => ({ id, label }));

  assert.deepEqual(views, [
    { id: 'inbox', label: 'Inbox' },
    { id: 'priority', label: 'Priority' },
    { id: 'monitored', label: 'Monitored' },
    { id: 'snoozed', label: 'Snoozed' },
    { id: 'completed', label: 'Completed' },
    { id: 'archived', label: 'Archive' },
  ]);
  assert.match(source, /let smartView = \$state\('inbox'\)/);
  assert.doesNotMatch(viewsSource, /id: '(?:all|unread)'|label: 'All active'|label: 'Unread'/);
});

test('RadarView marks read only from the native card activation path', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const selectThreadSource = source.match(/function selectThread\(.*?\n  \}/s)?.[0] || '';
  const cardSource = source.match(/<button type="button" class="radar-thread mailbox-thread-row".*?<\/button>/s)?.[0] || '';

  assert.match(selectThreadSource, /\{ markRead = false \}/);
  assert.match(selectThreadSource, /if \(markRead && isMailboxUnread\(item\)\) markItemRead\(item\.id\)/);
  assert.match(cardSource, /on:click=.*selectThread\(item, event\.currentTarget, \{ markRead: true \}\)/);
  assert.doesNotMatch(cardSource, /on:keydown/);
});

test('RadarView tells users to check Teams before retrying uncertain sends', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const guidance = 'Delivery could not be confirmed. Check Teams before trying again.';

  assert.match(source, new RegExp(`SEND_UNCONFIRMED[^}]+${guidance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 's'));
  assert.equal(source.match(new RegExp(guidance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length, 3);
  assert.doesNotMatch(source, /catch \(_\) \{\s*teamsSendState = \{ status: 'error', message: '[^']*retry[^']*' \};/s);
});

test('RadarView exposes a secondary card delete command with explicit local-only confirmation', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const contract = fs.readFileSync(new URL('../src/svelte/lib/item-deletion-ui.js', import.meta.url), 'utf8');
  const disposition = source.match(/<div class="radar-action-cluster radar-action-cluster--manage".*?<\/details>/s)?.[0] || '';
  const confirmation = source.match(/<ConfirmModal open=\{Boolean\(deleteRequest\)\}.*?\/>/s)?.[0] || '';

  assert.match(disposition, /data-testid="radar-delete"/);
  assert.match(disposition, />Delete from FlightDeck…<\/button>/);
  assert.match(disposition, /class="radar-more-menu__item radar-more-menu__item--delete"/);
  assert.match(confirmation, /title=\{ITEM_DELETION_CONFIRMATION\.title\}/);
  assert.match(confirmation, /summary=\{ITEM_DELETION_CONFIRMATION\.summary\}/);
  assert.match(contract, /Delete card from FlightDeck\?/);
  assert.match(contract, /permanently removes the card from FlightDeck/i);
  assert.match(contract, /does not delete the source email, Teams message or chat, meeting, document, or other Microsoft 365 content/i);
  assert.match(confirmation, /oncancel=\{\(\) => \{ deleteRequest = null; \}\}/);
  assert.doesNotMatch(source, /window\.workiq\?\.(?:delete|remove)|window\.workiq\.(?:delete|remove)(?:Email|Message|Chat|Meeting|Document)/);
});

test('Radar and Mailbox share the same permanent card deletion operation and UI contract', () => {
  const radar = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const mailbox = fs.readFileSync(new URL('../src/svelte/components/MailboxView.svelte', import.meta.url), 'utf8');

  for (const source of [radar, mailbox]) {
    assert.match(source, /deleteItem/);
    assert.match(source, /ITEM_DELETION_CONFIRMATION/);
    assert.match(source, /itemDeletionFailureMessage/);
    assert.match(source, /nextItemSelectionAfterRemoval/);
    assert.match(source, /oncancel=\{\(\) => \{ deleteRequest = null; \}\}/);
    assert.doesNotMatch(source, /window\.workiq\?\.(?:delete|remove)|window\.workiq\.(?:delete|remove)(?:Email|Message|Chat|Meeting|Document)/);
  }
  assert.match(mailbox, /data-testid="mailbox-archive"/);
  assert.match(mailbox, /data-testid="mailbox-delete"/);
  assert.match(mailbox, /role="alert" data-testid="mailbox-delete-error"/);
});

test('Topbar and App remove Mailbox as a user-facing destination', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/Topbar.svelte', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/svelte/App.svelte', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /class:active=\{\$mode === 'Mailbox'\}/);
  assert.doesNotMatch(source, /handleModeClick\('Mailbox'\)/);
  assert.doesNotMatch(source, />Mailbox<\/button>/);
  assert.doesNotMatch(app, /MailboxView/);
  assert.doesNotMatch(app, /\$mode === 'Mailbox'/);
});

test('Radar Inbox rows use Mailbox row classes and canonical criticality and work-status pills', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const row = source.match(/<button type="button" class="radar-thread mailbox-thread-row".*?<\/button>/s)?.[0] || '';

  assert.match(row, /mailbox-row-topline/);
  assert.match(row, /mailbox-row-preview/);
  assert.match(row, /mailbox-row-meta/);
  assert.match(row, /mailbox-severity-\{severityLabel\.toLowerCase\(\)\}/);
  assert.match(row, /title=\{`Criticality: \$\{severityLabel\}`\}/);
  assert.match(row, /mailbox-status mailbox-status-\{statusClass\}/);
  assert.match(row, /title=\{`Work status: \$\{statusLabel\}`\}/);
  assert.match(source, /mailboxWorkStatus\(item\)/);
  assert.match(source, /mailboxWorkStatusClass\(item\)/);
});

test('Radar Inbox preserves chronological sorting independently of status and read state', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const threadProjection = source.match(/let threads = \$derived\.by\(\(\) => \{.*?\n  \}\);/s)?.[0] || '';

  assert.match(source, /let sort = \$state\('recent'\)/);
  assert.match(threadProjection, /sort === 'recent'/);
  assert.match(threadProjection, /sort\(compareInboxThreads\)/);
  assert.match(threadProjection, /sort\(compareMailboxThreads\)/);
  assert.doesNotMatch(threadProjection, /smartView === 'inbox'\) return .*sort\(compareInboxThreads\)/);
});

test('Radar Inbox composes independent sort, quick filter, Refine, search, smart view, and scanner state', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const threadProjection = source.match(/let threads = \$derived\.by\(\(\) => \{.*?\n  \}\);/s)?.[0] || '';

  assert.match(source, /from '\.\.\/lib\/inbox-filters\.js'/);
  assert.match(source, /let quickFilter = \$state\(/);
  assert.match(source, /let refineFilters = \$state\(/);
  assert.match(threadProjection, /quickFilter/);
  assert.match(threadProjection, /refineFilters/);
  assert.match(threadProjection, /filterInboxItems|matchesInboxFilters/);
  assert.match(threadProjection, /view\.predicate/);
  assert.match(threadProjection, /scannerId === 'all'/);
  assert.match(threadProjection, /query\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /data-testid="inbox-quick-(?:unread|new|updated|critical|blocked|due-soon)"/);
  assert.match(source, />Refine</);
  assert.match(source, /data-testid="inbox-active-filter"/);
  assert.match(source, /aria-label=\{`Remove .* filter`\}/);
});

test('Radar Inbox restores frequent item and scanner controls with state cues', () => {
  const radar = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');

  for (const label of ['Scanner assignment', 'Due date', 'Owner', 'Done criteria']) {
    assert.match(radar, new RegExp(label, 'i'), `${label} is not editable in the mounted Inbox`);
  }
  assert.match(radar, /\bNEW\b/);
  assert.match(radar, /\bUPDATED\b/);
  assert.match(radar, /snoozeUntil/);
  assert.match(radar, /monitorPaused/);
  assert.match(radar, /lastRunAt/);
  assert.match(radar, /nextRunAt/);
  assert.match(radar, /runScanner/);
  assert.match(radar, /Run (?:scanner|now)/i);
  assert.match(radar, /viewCount\(view\)|scanner.*count/i);
});

test('Radar Inbox supports roving keyboard selection without coupling it to read state', () => {
  const source = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const keyboardHandler = source.match(/function (?:handleThreadKeydown|onThreadKeydown)\(.*?\n  \}/s)?.[0] || '';
  const row = source.match(/<button type="button" class="radar-thread mailbox-thread-row".*?<\/button>/s)?.[0] || '';

  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) assert.match(keyboardHandler, new RegExp(`['"]${key}['"]`));
  assert.match(row, /on:keydown|onkeydown/);
  assert.match(row, /tabindex=/);
  assert.doesNotMatch(keyboardHandler, /markItemRead/);
});

test('Advanced or popout keeps prompt, schedule, signal, and notification controls accessible without prompt regeneration', () => {
  const radar = fs.readFileSync(new URL('../src/svelte/components/RadarView.svelte', import.meta.url), 'utf8');
  const popout = fs.readFileSync(new URL('../src/svelte/components/PopoutView.svelte', import.meta.url), 'utf8');
  const schedule = fs.readFileSync(new URL('../src/svelte/components/ScheduleControls.svelte', import.meta.url), 'utf8');
  const advancedSurfaces = `${radar}\n${popout}`;

  assert.match(advancedSurfaces, /Advanced|Edit monitoring prompt/);
  assert.match(advancedSurfaces, /monitorPrompt/);
  assert.match(advancedSurfaces, /ScheduleControls/);
  assert.match(schedule, /monitorSignals/);
  assert.match(schedule, /notifyEnabled/);
  assert.match(schedule, /weeklyDays/);
  assert.match(schedule, /weeklyTimes/);
  assert.doesNotMatch(advancedSurfaces, /buildDefaultMonitorPrompt/);
});

test('Radar Inbox keeps compact rows bounded and readable', () => {
  const styles = fs.readFileSync(new URL('../src/styles/command-center.css', import.meta.url), 'utf8');
  const mailboxStyles = fs.readFileSync(new URL('../src/styles/mailbox.css', import.meta.url), 'utf8');

  assert.match(styles, /\.radar-thread\.mailbox-thread-row \{[^}]*min-height: 96px/s);
  assert.match(styles, /\.radar-thread\.mailbox-thread-row \.mailbox-row-preview \{[^}]*font-size: \.74rem/s);
  assert.match(mailboxStyles, /\.mailbox-row-preview \{[^}]*-webkit-line-clamp: 2/s);
  assert.match(mailboxStyles, /\.mailbox-row-meta > span \{[^}]*text-overflow: ellipsis/s);
});
