const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const RENDERER_ROOT = path.join(ROOT, 'dist-renderer');
const EDGE_PATHS = [
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
];
const FIXTURE_ITEM_ID = 'track_acme_renewal';
const FIXTURE_ITEM_TITLE = 'Acme Corp — Master Services Agreement Renewal';
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'flightdeck-radar-acceptance');
const SCENARIO_FILTER = String(process.env.FLIGHTDECK_BROWSER_SCENARIO || '').trim();
const results = [];
const screenshotPaths = [];
const totals = {
  unexpectedExternalRequests: 0,
  pageErrors: 0,
  consoleErrors: 0,
  desktopOverflowFailures: 0,
  mobileOverflowFailures: 0,
  desktopOverlapFailures: 0,
  mobileOverlapFailures: 0,
};

function findEdge() {
  const executablePath = EDGE_PATHS.find((candidate) => candidate && fs.existsSync(candidate));
  assert.ok(executablePath, `Microsoft Edge was not found in: ${EDGE_PATHS.join(', ')}`);
  return executablePath;
}

function contentType(filePath) {
  return { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function startRendererServer() {
  assert.ok(fs.existsSync(path.join(RENDERER_ROOT, 'app.html')), 'dist-renderer/app.html is missing; run build:renderer first');
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const relativePath = requestUrl.pathname === '/' ? 'app.html' : requestUrl.pathname.replace(/^\/+/, '');
    const filePath = path.resolve(RENDERER_ROOT, relativePath);
    if (!filePath.startsWith(`${RENDERER_ROOT}${path.sep}`) && filePath !== path.join(RENDERER_ROOT, 'app.html')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
      response.end(content);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function installLocalBridge(context, draftMode, proposalMode, teamsSendMode) {
  await context.addInitScript(({ mode, synthesisMode, sendMode, itemTitle }) => {
    const prefix = '__flightdeck_browser_acceptance__:';
    const read = (key, fallback = null) => {
      const raw = localStorage.getItem(prefix + key);
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    };
    const write = (key, value) => localStorage.setItem(prefix + key, JSON.stringify(value));
    window.__draftCalls = [];
    window.__proposalCalls = [];
    window.__proposalAttempts = 0;
    window.__teamsSendCalls = [];
    window.__openExternalCalls = [];
    window.__failNextStoreSet = false;
    window.__failDeletionForProposalId = null;
    window.__failDeletionForItemId = null;
    window.__resolveDraft = null;
    window.__notificationCallback = null;
    window.__coldHydrationPending = false;
    window.__resolveColdHydration = null;
    window.__coldGetCalls = 0;
    window.workiq = {
      storeGet: async (key) => read(key),
      storeSet: async (key, value) => {
        if (window.__failDeletionForProposalId
          && !value?.actionProposals?.some((proposal) => proposal.id === window.__failDeletionForProposalId)) {
          window.__failDeletionForProposalId = null;
          throw new Error('Simulated local deletion persistence failure');
        }
        if (window.__failDeletionForItemId
          && !value?.items?.some((item) => item.id === window.__failDeletionForItemId)) {
          window.__failDeletionForItemId = null;
          throw new Error('Simulated local card deletion persistence failure');
        }
        if (window.__failNextStoreSet) {
          window.__failNextStoreSet = false;
          throw new Error('Simulated local persistence failure');
        }
        write(key, value);
        return true;
      },
      storeDelete: async (key) => { localStorage.removeItem(prefix + key); return true; },
      readPromptFile: async () => ({ success: false, error: 'Unavailable in browser acceptance mode' }),
      getColdItems: async () => {
        window.__coldGetCalls += 1;
        const cold = read('__coldItems', []);
        if (!window.__coldHydrationPending) return cold;
        return new Promise((resolve) => {
          window.__resolveColdHydration = () => resolve(cold);
        });
      },
      setColdItems: async (items) => { write('__coldItems', items); return true; },
      broadcastStateChanged: () => {},
      onStateChanged: () => () => {},
      onAppResumed: () => () => {},
      onNotificationClicked: (callback) => {
        window.__notificationCallback = callback;
        return () => {
          if (window.__notificationCallback === callback) window.__notificationCallback = null;
        };
      },
      getAppVersion: async () => 'browser-acceptance',
      checkForUpdates: async () => ({ available: false }),
      openExternal: async (url) => {
        window.__openExternalCalls.push(url);
        return { success: true, url };
      },
      proposeThreadActions: async (context) => {
        window.__proposalCalls.push(structuredClone(context));
        window.__proposalAttempts += 1;
        if (synthesisMode === 'retry' && window.__proposalAttempts === 1) {
          return { ok: false, readOnly: true, code: 'TIMEOUT' };
        }

        const base = {
          schemaVersion: 1,
          recommendation: 'Ask Sofia to confirm the deployment window.',
          blocker: 'The deployment window is not confirmed.',
          why: 'A confirmed window is the smallest step that unblocks the renewal.',
          confidence: 'high',
          evidence: [{ kind: 'observed', text: 'Sofia requested a proposed deployment window.' }],
          proposals: [],
          noCommunicationReason: '',
        };
        if (synthesisMode === 'teams') {
          base.proposals = [{
            channel: 'teams',
            intent: 'Confirm an owner',
            target: { displayName: 'James Farquharson', channelId: '', threadId: '' },
            payload: { message: 'Who can confirm the renewal deployment owner?' },
            expectedOutcome: 'An owner is identified.',
            risk: 'Confirm the recipient is the current owner.',
            reviewNote: 'Verify the channel.',
            needsTargetResolution: true,
            missingContext: [],
          }];
        } else if (synthesisMode === 'none') {
          base.recommendation = 'Review Sofia\'s latest note before taking another action.';
          base.noCommunicationReason = 'Another message would add noise until the note is reviewed.';
        } else {
          base.proposals = [{
            channel: 'email',
            intent: 'Confirm the deployment window',
            target: {
              displayName: 'Sofia Martinez',
              address: synthesisMode === 'missing-address' ? '' : 'sofia@example.com',
              channelId: '',
              threadId: '',
            },
            payload: {
              subject: itemTitle,
              body: 'Can you confirm Tuesday at 10:00 for the deployment window?',
            },
            expectedOutcome: 'A confirmed deployment window.',
            risk: 'Verify the recipient and timing.',
            reviewNote: 'Review before creating an Outlook draft.',
            needsTargetResolution: synthesisMode === 'missing-address',
            missingContext: synthesisMode === 'missing-address' ? ['Verified email address for Sofia Martinez'] : [],
          }];
        }
        return { ok: true, readOnly: true, result: base };
      },
      createOutlookDraft: async (payload) => {
        window.__draftCalls.push(structuredClone(payload));
        if (mode === 'pending') return new Promise(() => {});
        if (mode === 'deferred') return new Promise((resolve) => {
          window.__resolveDraft = () => resolve({ ok: true, action: 'outlook-draft-created' });
        });
        if (mode === 'cancel') return { ok: false, code: 'CANCELLED', dispatched: false };
        if (mode === 'error') return { ok: true, draftId: 'non-authoritative-result' };
        return { ok: true, action: 'outlook-draft-created' };
      },
      sendTeamsMessage: async (payload) => {
        window.__teamsSendCalls.push(structuredClone(payload));
        const attempt = window.__teamsSendCalls.length;
        if (sendMode === 'sequence' && attempt === 1) return { ok: false, action: 'teams-message-send', code: 'CANCELLED' };
        if (sendMode === 'sequence' && attempt === 2) return { ok: false, action: 'teams-message-send', code: 'SEND_UNCONFIRMED' };
        if (sendMode === 'sequence' && attempt === 3) return { ok: false, action: 'teams-message-send', code: 'SEND_FAILED' };
        return { ok: true, action: 'teams-message-sent' };
      },
    };
  }, { mode: draftMode, synthesisMode: proposalMode, sendMode: teamsSendMode, itemTitle: FIXTURE_ITEM_TITLE });
}

async function createSession(browser, baseUrl, { draftMode = 'success', proposalMode = 'email', teamsSendMode = 'success', viewport = { width: 1440, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await installLocalBridge(context, draftMode, proposalMode, teamsSendMode);
  const diagnostics = { external: [], pageErrors: [], consoleErrors: [] };
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (/^https?:\/\//i.test(requestUrl) && new URL(requestUrl).origin !== baseUrl) {
      diagnostics.external.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
  return { context, page, diagnostics, baseUrl };
}

async function openApp(session, { reseed = true } = {}) {
  await session.page.goto(`${session.baseUrl}/app.html${reseed ? '?demo=1&reseed=1' : '?demo=1'}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await session.page.getByRole('button', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await session.page.getByRole('button', { name: 'Radar', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await session.page.waitForFunction(() =>
    document.querySelector('.radar-thread')
      && document.querySelectorAll('#radar-scanner option').length > 1);
}

async function openMailbox(session, options) {
  await openApp(session, options);
  await session.page.getByRole('button', { name: 'Mailbox', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Mailbox', exact: true }).waitFor({ state: 'visible' });
  await session.page.locator('.mailbox-thread-row').first().waitFor({ state: 'visible' });
}

async function selectFixtureThread(page, view = 'inbox') {
  await page.getByTestId(`radar-view-${view}`).click();
  const thread = page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  await thread.waitFor({ state: 'visible' });
  await thread.click();
  await page.locator('.radar-thread-detail h2').filter({ hasText: FIXTURE_ITEM_TITLE }).waitFor({ state: 'visible' });
  return thread;
}

async function assertNoArbitrarySelection(page) {
  await page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).waitFor({ state: 'detached' });
  assert.equal(await page.locator('.radar-thread[aria-current="true"]').count(), 0, 'A replacement thread was selected automatically');
  assert.equal(await page.locator('.radar-thread-detail h2').count(), 0, 'Detail remained populated after the selected thread left the view');
}

async function assertHealthy(session, kind = 'desktop') {
  const { dimensions, paneOverlaps } = await session.page.evaluate(() => {
    const visiblePaneRects = [...document.querySelectorAll('.radar-smart-views, .radar-thread-list-pane, .radar-thread-detail')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((element) => ({ name: element.className, rect: element.getBoundingClientRect().toJSON() }));
    const paneOverlaps = [];
    for (let leftIndex = 0; leftIndex < visiblePaneRects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < visiblePaneRects.length; rightIndex += 1) {
        const left = visiblePaneRects[leftIndex];
        const right = visiblePaneRects[rightIndex];
        const overlapWidth = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
        const overlapHeight = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
        if (overlapWidth > 1 && overlapHeight > 1) paneOverlaps.push([left.name, right.name]);
      }
    }
    return {
      dimensions: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      paneOverlaps,
    };
  });
  const overflow = dimensions.scrollWidth > dimensions.clientWidth + 1;
  if (kind === 'mobile' && overflow) totals.mobileOverflowFailures += 1;
  if (kind === 'desktop' && overflow) totals.desktopOverflowFailures += 1;
  if (kind === 'mobile' && paneOverlaps.length) totals.mobileOverlapFailures += 1;
  if (kind === 'desktop' && paneOverlaps.length) totals.desktopOverlapFailures += 1;
  totals.unexpectedExternalRequests += session.diagnostics.external.length;
  totals.pageErrors += session.diagnostics.pageErrors.length;
  totals.consoleErrors += session.diagnostics.consoleErrors.length;
  assert.equal(overflow, false, `${kind} horizontal overflow: ${JSON.stringify(dimensions)}`);
  assert.deepEqual(paneOverlaps, [], `${kind} Radar panes overlap: ${JSON.stringify(paneOverlaps)}`);
  assert.deepEqual(session.diagnostics.external, [], `Unexpected external requests: ${JSON.stringify(session.diagnostics.external)}`);
  assert.deepEqual(session.diagnostics.pageErrors, [], `Page errors: ${JSON.stringify(session.diagnostics.pageErrors)}`);
  assert.deepEqual(session.diagnostics.consoleErrors, [], `Console errors: ${JSON.stringify(session.diagnostics.consoleErrors)}`);
}

async function runScenario(name, browser, baseUrl, callback, options) {
  if (SCENARIO_FILTER && name !== SCENARIO_FILTER) return;
  process.stdout.write(`SCENARIO ${name} START\n`);
  const session = await createSession(browser, baseUrl, options);
  try {
    await callback(session);
    results.push({ name, passed: true });
    process.stdout.write(`SCENARIO ${name} PASS\n`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    process.stdout.write(`SCENARIO ${name} FAIL: ${error.message}\n`);
    throw error;
  } finally {
    await session.context.close();
  }
}

async function themeScenario(session) {
  await openApp(session);
  const values = () => session.page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { marker: document.documentElement.getAttribute('data-theme'), background: style.getPropertyValue('--bg-body').trim(), text: style.getPropertyValue('--text').trim(), accent: style.getPropertyValue('--accent').trim() };
  });
  const before = await values();
  assert.match(before.marker, /^(dark|light)$/);
  assert.ok(before.background && before.text && before.accent, `FlightDeck theme tokens were empty: ${JSON.stringify(before)}`);
  await session.page.getByRole('button', { name: 'Toggle theme' }).click();
  await session.page.waitForFunction((marker) => document.documentElement.getAttribute('data-theme') !== marker, before.marker);
  const after = await values();
  assert.notEqual(after.marker, before.marker);
  assert.notDeepEqual([after.background, after.text, after.accent], [before.background, before.text, before.accent]);
  await session.page.reload({ waitUntil: 'domcontentloaded' });
  await session.page.getByRole('button', { name: 'Toggle theme' }).waitFor({ state: 'visible' });
  assert.equal(await session.page.locator('html').getAttribute('data-theme'), after.marker, 'Theme choice did not persist across reload');
  await assertHealthy(session);
}

async function scannerScenario(session) {
  await openApp(session);
  const uniqueName = `Browser Fixture Scanner ${Date.now()}`;
  await session.page.getByTestId('radar-new-scanner').click();
  const dialog = session.page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'New Scanner', exact: true }).waitFor({ state: 'visible' });
  await dialog.locator('input[placeholder="e.g., Competitor Intel"]').fill(uniqueName);
  await dialog.locator('textarea[placeholder="What should this scanner look for?"]').fill('Watch the local demo fixture for acceptance-test signals only.');
  await dialog.getByRole('button', { name: 'Create Scanner', exact: true }).click();
  await session.page.locator('#radar-scanner option').filter({ hasText: uniqueName }).waitFor({ state: 'attached' });
  assert.equal(await session.page.evaluate(() => typeof window.workiq.ask), 'undefined', 'A live scanner API was exposed to the browser test');
  await session.page.waitForFunction(async (name) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state?.scanners?.some((scanner) => scanner.name === name);
  }, uniqueName);
  await session.page.waitForTimeout(1000);
  const stableState = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  assert.ok(stableState?.scanners?.some((scanner) => scanner.name === uniqueName), 'Scanner did not remain in demo storage after the debounce window');
  await openApp(session, { reseed: false });
  const renderedNames = await session.page.locator('#radar-scanner option').allTextContents();
  const persistedState = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  assert.ok(renderedNames.includes(uniqueName), `Scanner was not rehydrated. rendered=${JSON.stringify(renderedNames)} persisted=${JSON.stringify(persistedState?.scanners?.map((scanner) => scanner.name))}`);
  await assertHealthy(session);
}

async function addItemPersistScenario(session) {
  await openApp(session);
  const itemTitle = 'Browser mounted custom item';
  const monitorContext = 'Track confirmed ownership and the next committed delivery date.';
  const scanner = await session.page.evaluate(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state.scanners[1] || state.scanners[0];
  });

  await session.page.getByTestId('radar-add-item').click();
  const dialog = session.page.getByRole('dialog').filter({ hasText: 'Add Item to' });
  await dialog.getByRole('heading', { name: /Add Item to/ }).waitFor({ state: 'visible' });
  await dialog.getByPlaceholder('e.g., Customer agreement for Project X').fill(itemTitle);
  await dialog.locator('select').nth(0).selectOption(scanner.id);
  await dialog.locator('select').nth(1).selectOption('Critical');
  await dialog.getByPlaceholder('What should WorkIQ look for when refreshing this task?').fill(monitorContext);
  await dialog.getByRole('button', { name: 'Create Task', exact: true }).click();

  await session.page.locator('.radar-thread-detail h2').filter({ hasText: itemTitle }).waitFor({ state: 'visible' });
  assert.equal(await session.page.getByLabel('Criticality').inputValue(), 'Critical');
  assert.equal(await session.page.getByLabel('Work state').inputValue(), 'in-progress');
  assert.equal(await session.page.getByLabel('Scanner assignment').inputValue(), scanner.id);
  await session.page.waitForFunction(({ itemTitle, monitorContext, scannerId }) => {
    const raw = localStorage.getItem('__flightdeck_browser_acceptance__:flightdeck.demo.v2');
    const state = raw ? JSON.parse(raw) : null;
    const item = state?.items?.find((entry) => entry.title === itemTitle);
    return item?.origin === 'custom'
      && item?.sourceType === 'Custom'
      && item?.status === 'Inbound'
      && item?.lifecycleStatus === 'in-progress'
      && item?.scannerId === scannerId
      && item?.severity === 'Critical'
      && item?.monitorPrompt === monitorContext
      && item?.monitorEnabled === true;
  }, { itemTitle, monitorContext, scannerId: scanner.id });

  await openApp(session, { reseed: false });
  const restored = session.page.locator('.radar-thread').filter({ hasText: itemTitle });
  await restored.waitFor({ state: 'visible' });
  await restored.click();
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: itemTitle }).waitFor({ state: 'visible' });
  await session.page.locator('#radar-scanner').selectOption(scanner.id);
  await session.page.locator('.radar-thread').filter({ hasText: itemTitle }).waitFor({ state: 'visible' });
  await assertHealthy(session);
}

async function seedScannerDeletionFixture(session, suffix, { withProposal = false, unhydrated = false } = {}) {
  await openApp(session);
  return session.page.evaluate(async ({ fixtureItemId, suffix, withProposal, unhydrated }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state.items.find((item) => item.id === fixtureItemId);
    const scannerId = `scanner_browser_${suffix}`;
    const scannerName = `Browser ${suffix} scanner`;
    const hotItemId = `browser_${suffix}_hot`;
    const coldItemId = `browser_${suffix}_cold`;
    const proposalId = `browser_${suffix}_proposal`;
    const scanner = {
      ...state.scanners[0],
      id: scannerId,
      name: scannerName,
      prompt: `Local ${suffix} scanner fixture.`,
      itemCount: 2,
    };
    const hotItem = {
      ...source,
      id: hotItemId,
      title: `Browser ${suffix} hot thread`,
      scannerId,
      lifecycleStatus: 'in-progress',
      isNew: false,
      hasNewUpdate: false,
    };
    const coldItem = {
      ...source,
      id: coldItemId,
      title: `Browser ${suffix} cold thread`,
      scannerId,
      lifecycleStatus: 'archived',
      monitorEnabled: false,
      isNew: false,
      hasNewUpdate: false,
    };
    const actionProposals = withProposal
      ? [...(state.actionProposals || []), {
        id: proposalId,
        sourceItemId: hotItemId,
        sourceTitle: hotItem.title,
        channel: 'email',
        state: 'Drafted',
        dispatchStatus: 'not-started',
        createdAt: '2026-09-08T10:00:00Z',
        updatedAt: '2026-09-08T10:00:00Z',
      }]
      : (state.actionProposals || []);
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state,
      scanners: [...state.scanners, scanner],
      items: [...state.items, hotItem],
      actionProposals,
    });
    await window.workiq.setColdItems(unhydrated
      ? [coldItem]
      : [...(await window.workiq.getColdItems()), coldItem]);
    if (unhydrated) window.__coldGetCalls = 0;
    return { scannerId, scannerName, hotItemId, coldItemId, proposalId };
  }, { fixtureItemId: FIXTURE_ITEM_ID, suffix, withProposal, unhydrated });
}

async function openScannerDeletionDialog(session, fixture, { openArchive = true } = {}) {
  await openApp(session, { reseed: false });
  if (openArchive) {
    await session.page.getByTestId('radar-view-archived').click();
    await session.page.locator(`[data-thread-id="${fixture.coldItemId}"]`).waitFor({ state: 'visible' });
  }
  await session.page.locator('#radar-scanner').selectOption(fixture.scannerId);
  await session.page.getByTestId('radar-edit-scanner').click();
  const settings = session.page.getByRole('dialog').filter({ hasText: fixture.scannerName });
  await settings.getByRole('button', { name: 'Delete this scanner', exact: true }).click();
  const deletion = session.page.getByTestId('scanner-deletion-modal');
  await deletion.getByRole('heading', { name: `Delete ${fixture.scannerName}?`, exact: true }).waitFor({ state: 'visible' });
  return deletion;
}

async function scannerDeletionReassignScenario(session) {
  const fixture = await seedScannerDeletionFixture(session, 'reassign');
  const deletion = await openScannerDeletionDialog(session, fixture);
  const reassign = deletion.getByRole('radio', { name: /Keep and reassign/ });
  assert.equal(await reassign.isChecked(), true, 'Scanner deletion did not default to preservation');
  assert.equal(await deletion.getByTestId('scanner-deletion-target').locator('option:checked').textContent(), 'Unassigned Inbox');
  await deletion.getByTestId('scanner-deletion-confirm').click();
  await deletion.waitFor({ state: 'detached' });
  await session.page.waitForFunction(async ({ scannerId, hotItemId }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return !state.scanners.some((scanner) => scanner.id === scannerId)
      && state.items.find((item) => item.id === hotItemId)?.scannerId == null;
  }, fixture);
  const coldItems = await session.page.evaluate(() => window.workiq.getColdItems());
  assert.equal(coldItems.find((item) => item.id === fixture.coldItemId)?.scannerId, null,
    'Reassign did not preserve the archived thread as unassigned');
  await openApp(session, { reseed: false });
  assert.equal(await session.page.locator(`#radar-scanner option[value="${fixture.scannerId}"]`).count(), 0,
    'Deleted scanner returned after reload');
  assert.equal(await session.page.locator(`[data-thread-id="${fixture.hotItemId}"]`).count(), 1,
    'Reassigned hot thread did not survive reload');
  await assertHealthy(session);
}

async function scannerDeletionDeleteAllScenario(session) {
  const fixture = await seedScannerDeletionFixture(session, 'delete_all', { withProposal: true });
  const deletion = await openScannerDeletionDialog(session, fixture);
  await deletion.getByRole('radio', { name: /Delete all/ }).check();
  assert.equal(await deletion.getByTestId('scanner-deletion-confirm').isDisabled(), true,
    'Destructive scanner deletion was enabled before acknowledgement');
  await deletion.getByTestId('scanner-deletion-acknowledgement').check();
  await deletion.getByTestId('scanner-deletion-confirm').click();
  await deletion.waitFor({ state: 'detached' });
  await session.page.waitForFunction(async ({ scannerId, hotItemId, proposalId }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return !state.scanners.some((scanner) => scanner.id === scannerId)
      && !state.items.some((item) => item.id === hotItemId)
      && !state.actionProposals.some((proposal) => proposal.id === proposalId)
      && state.deletedItemIds.includes(hotItemId);
  }, fixture);
  const coldItems = await session.page.evaluate(() => window.workiq.getColdItems());
  assert.equal(coldItems.some((item) => item.id === fixture.coldItemId), false,
    'Delete all retained the archived scanner thread');
  const persisted = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  assert.equal(persisted.deletedItemIds.includes(fixture.coldItemId), true,
    'Delete all did not tombstone the archived scanner thread');
  await openApp(session, { reseed: false });
  assert.equal(await session.page.locator(`[data-thread-id="${fixture.hotItemId}"]`).count(), 0,
    'Permanently deleted scanner thread returned after reload');
  await assertHealthy(session);
}

async function scannerDeletionUnhydratedArchiveScenario(session) {
  const fixture = await seedScannerDeletionFixture(session, 'unhydrated_archive', { unhydrated: true });
  assert.equal(await session.page.evaluate(() => window.__coldGetCalls), 0,
    'The browser fixture hydrated Archive before scanner deletion began');
  const deletion = await openScannerDeletionDialog(session, fixture, { openArchive: false });
  assert.ok(await session.page.evaluate(() => window.__coldGetCalls) > 0,
    'Scanner deletion preview did not load authoritative cold state');
  await deletion.getByRole('radio', { name: /Delete all/ }).check();
  await deletion.getByTestId('scanner-deletion-acknowledgement').check();
  await deletion.getByTestId('scanner-deletion-confirm').click();
  await deletion.waitFor({ state: 'detached' });
  await session.page.waitForFunction(async ({ scannerId, hotItemId, coldItemId }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const cold = await window.workiq.getColdItems();
    return !state.scanners.some((scanner) => scanner.id === scannerId)
      && !state.items.some((item) => item.id === hotItemId)
      && !cold.some((item) => item.id === coldItemId)
      && state.deletedItemIds.includes(coldItemId);
  }, fixture);
  await openApp(session, { reseed: false });
  const persisted = await session.page.evaluate(async ({ scannerId, hotItemId, coldItemId }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const cold = await window.workiq.getColdItems();
    return {
      scannerPresent: state.scanners.some((scanner) => scanner.id === scannerId),
      hotPresent: state.items.some((item) => item.id === hotItemId),
      coldPresent: cold.some((item) => item.id === coldItemId),
      coldTombstoned: state.deletedItemIds.includes(coldItemId),
    };
  }, fixture);
  assert.deepEqual(persisted, {
    scannerPresent: false,
    hotPresent: false,
    coldPresent: false,
    coldTombstoned: true,
  });
  await assertHealthy(session);
}

async function criticalityScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  const criticality = session.page.getByLabel('Criticality');
  await criticality.selectOption('Elevated');
  await session.page.waitForFunction((id) => document.querySelector(`[data-thread-id="${id}"]`)?.textContent.includes('Elevated'), FIXTURE_ITEM_ID);
  await session.page.waitForTimeout(700);
  await openApp(session, { reseed: false });
  await selectFixtureThread(session.page);
  assert.equal(await session.page.getByLabel('Criticality').inputValue(), 'Elevated', 'Criticality did not persist through the store bridge');
  await session.page.getByLabel('Criticality').selectOption('Critical');
  await assertHealthy(session);
}

async function completedRestoreScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByLabel('Work state').selectOption('complete');
  await assertNoArbitrarySelection(session.page);
  await session.page.getByTestId('radar-view-completed').click();
  const completedThread = session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  await completedThread.waitFor({ state: 'visible' });
  await completedThread.click();
  assert.equal(await session.page.getByLabel('Work state').inputValue(), 'complete');
  await session.page.getByLabel('Work state').selectOption('in-progress');
  await assertNoArbitrarySelection(session.page);
  await session.page.getByTestId('radar-view-inbox').click();
  await session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).waitFor({ state: 'visible' });
  assert.equal(await session.page.locator('.radar-thread[aria-current="true"]').count(), 0, 'Active view selected an arbitrary thread after restore');
  await assertHealthy(session);
}

async function draftScenario(session, expectedMode) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const proposalCalls = await session.page.evaluate(() => structuredClone(window.__proposalCalls));
  assert.equal(proposalCalls.length, 1, 'Draft email did not invoke the narrow API exactly once');
  assert.deepEqual(Object.keys(proposalCalls[0]).sort(), ['requestedChannel', 'schemaVersion', 'thread']);
  assert.equal(proposalCalls[0].requestedChannel, 'email');
  assert.equal(Object.hasOwn(proposalCalls[0].thread, 'body'), false);
  assert.equal(Object.hasOwn(proposalCalls[0], 'question'), false);
  assert.equal(JSON.stringify(proposalCalls[0]).includes('http'), false, 'Renderer synthesis context contained an arbitrary URL');
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  const recipient = `${expectedMode}@example.com`;
  const body = `Rendered ${expectedMode} draft body ${Date.now()}`;
  await queue.locator('#action-target').fill(recipient);
  await queue.locator('#action-target').press('Tab');
  await queue.locator('#action-content').fill(body);
  await queue.locator('#action-content').press('Tab');
  for (const label of ['Submit for review', 'Approve content', 'Queue Outlook draft']) await queue.getByRole('button', { name: label, exact: true }).click();
  await queue.getByRole('button', { name: 'Create Outlook draft', exact: true }).click();
  await session.page.waitForFunction(() => window.__draftCalls.length === 1);
  const calls = await session.page.evaluate(() => structuredClone(window.__draftCalls));
  assert.equal(calls.length, 1, `${expectedMode} called createOutlookDraft more than once`);
  assert.deepEqual(calls[0], { to: [recipient], subject: FIXTURE_ITEM_TITLE, body });
  const review = queue.locator('.action-review');
  const state = review.locator('.action-review__title > strong');
  if (expectedMode === 'cancel') {
    await state.filter({ hasText: /^Queued$/ }).waitFor({ state: 'visible' });
    await review.getByText('Outlook draft creation cancelled before dispatch. No external action occurred.', { exact: true }).waitFor({ state: 'visible' });
    await review.getByRole('button', { name: 'Create Outlook draft', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await review.getByText('Outlook draft created', { exact: true }).count(), 0);
  } else if (expectedMode === 'error') {
    await state.filter({ hasText: /^Failed$/ }).waitFor({ state: 'visible' });
    await review.getByText('Outlook draft result could not be confirmed. Check Outlook Drafts before trying again.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await review.getByRole('button', { name: 'Retry Outlook draft', exact: true }).count(), 0,
      'Unconfirmed Outlook result exposed an unsafe immediate retry');
    await review.getByTestId('action-manage').filter({ hasText: 'Archive' }).waitFor({ state: 'visible' });
    assert.equal(await queue.getByTestId('action-segment-open').getAttribute('aria-selected'), 'true',
      'Unconfirmed Outlook result did not remain manageable in Open');
    assert.equal(await review.getByText('Outlook draft created', { exact: true }).count(), 0, 'A non-authoritative success result was accepted');
    await review.getByRole('button', { name: 'Return to source', exact: true }).click();
    await session.page.getByTestId('action-timeline-entry').filter({ hasText: 'Action proposal outcome unconfirmed; check Outlook Drafts before trying again' }).waitFor({ state: 'visible' });
    await session.page.waitForFunction(async () => {
      const persisted = await window.workiq.storeGet('flightdeck.demo.v2');
      return persisted?.actionProposals?.[0]?.executionCode === 'ACTION_UNCONFIRMED';
    });
    const persisted = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
    const savedProposal = persisted.actionProposals[0];
    assert.equal(savedProposal.state, 'Failed');
    assert.equal(savedProposal.executionVerification, 'unverified');
    assert.equal(savedProposal.executionCode, 'ACTION_UNCONFIRMED');
    const threadEvents = persisted.items.find((item) => item.id === FIXTURE_ITEM_ID).updateHistory
      .filter((entry) => entry.event === 'action-unconfirmed');
    const globalEvents = persisted.history.filter((entry) => entry.payload?.event === 'action-unconfirmed');
    assert.equal(threadEvents.length, 1, 'Runtime unknown did not record exactly one thread action-unconfirmed event');
    assert.equal(globalEvents.length, 1, 'Runtime unknown did not record exactly one global action-unconfirmed event');
    const serializedEvents = JSON.stringify({ thread: threadEvents[0], global: globalEvents[0] });
    assert.doesNotMatch(serializedEvents, new RegExp(body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'Unconfirmed audit event persisted the draft body');
    assert.doesNotMatch(serializedEvents, /non-authoritative-result|draftId|rawContent|backendEntityId/,
      'Unconfirmed audit event persisted raw backend result content');
  } else {
    await state.filter({ hasText: /^Succeeded$/ }).waitFor({ state: 'visible' });
    await review.getByText('Outlook draft saved in Outlook Drafts. Nothing was sent.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await review.getByText(/sent successfully|email sent/i).count(), 0, 'Outlook draft completion claimed the email was sent');
    assert.equal(await review.getByRole('button', { name: /Retry/i }).count(), 0, 'Terminal Outlook success exposed retry');
    await review.getByTestId('action-manage').filter({ hasText: 'Archive' }).waitFor({ state: 'visible' });
    await review.getByRole('button', { name: 'Return to source', exact: true }).click();
    await session.page.getByTestId('action-timeline-entry').filter({ hasText: 'Outlook draft saved in Outlook Drafts. Nothing was sent.' }).waitFor({ state: 'visible' });
    await session.page.waitForFunction(async () => {
      const persisted = await window.workiq.storeGet('flightdeck.demo.v2');
      return persisted?.actionProposals?.[0]?.state === 'Succeeded';
    });
    await session.page.waitForTimeout(1000);
    const stableState = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
    assert.equal(stableState?.actionProposals?.[0]?.state, 'Succeeded', 'Trusted Outlook draft success was not persisted');
    await openApp(session, { reseed: false });
    await session.page.getByRole('button', { name: /^Actions/ }).click();
    const restoredQueue = session.page.getByTestId('action-queue');
    await restoredQueue.getByTestId('action-segment-resolved').click();
    const restored = restoredQueue.locator('.action-review');
    await restored.locator('.action-review__title > strong').filter({ hasText: /^Succeeded$/ }).waitFor({ state: 'visible' });
    await restored.getByText('Outlook draft saved in Outlook Drafts. Nothing was sent.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await restored.getByRole('button', { name: /Retry/i }).count(), 0, 'Terminal success remained retryable after reload');
  }
  await assertHealthy(session);
}

async function missingAddressScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  await queue.getByText(/Email address required for Sofia Martinez/).waitFor({ state: 'visible' });
  await queue.locator('#action-target').fill('sofia@example.com');
  await queue.locator('#action-target').press('Tab');
  await queue.getByRole('button', { name: 'Submit for review', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await queue.getByText(/Email address required for Sofia Martinez/).count(), 0);
  await assertHealthy(session);
}

async function actionQueueManagementScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  const sourceBefore = {
    title: await session.page.locator('.radar-thread-detail h2').textContent(),
    sourceType: await session.page.locator('.radar-thread-detail .eyebrow').textContent(),
    lifecycleStatus: await session.page.getByLabel('Work state').inputValue(),
  };
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  await queue.locator('#action-target').fill('sofia@example.com');
  await queue.locator('#action-target').press('Tab');

  const openTab = queue.getByTestId('action-segment-open');
  const resolvedTab = queue.getByTestId('action-segment-resolved');
  const archivedTab = queue.getByTestId('action-segment-archived');
  assert.equal(await openTab.getAttribute('aria-selected'), 'true');
  assert.equal(Number(await openTab.locator('strong').textContent()), await queue.locator('.action-queue__list > button').count(), 'Open count did not match visible proposals');
  assert.equal(Number(await resolvedTab.locator('strong').textContent()), 0, 'Resolved count was not initially empty');
  assert.equal(Number(await archivedTab.locator('strong').textContent()), 0, 'Archived count was not initially empty');

  const manage = queue.getByTestId('action-manage');
  await manage.filter({ hasText: 'Dismiss proposal' }).waitFor({ state: 'visible' });
  await manage.focus();
  await manage.press('Enter');
  const confirm = session.page.getByTestId('confirm-modal');
  await confirm.getByText(/move to Archived and can be restored/).waitFor({ state: 'visible' });
  const confirmCancel = confirm.getByTestId('confirm-cancel');
  const confirmSubmit = confirm.getByTestId('confirm-submit');
  assert.equal(await confirmCancel.evaluate((element) => element === document.activeElement), true, 'Confirmation did not move focus to Cancel');
  await confirmCancel.press('Shift+Tab');
  assert.equal(await confirmSubmit.evaluate((element) => element === document.activeElement), true, 'Shift+Tab escaped the confirmation instead of wrapping to Confirm');
  await confirmSubmit.press('Tab');
  assert.equal(await confirmCancel.evaluate((element) => element === document.activeElement), true, 'Tab escaped the confirmation instead of wrapping to Cancel');
  await confirm.press('Escape');
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await manage.evaluate((element) => element === document.activeElement), true, 'Confirmation close did not restore focus to its initiating control');
  assert.equal(await queue.locator('.action-review__title > strong').textContent(), 'Drafted', 'Confirmation cancel changed proposal state');
  assert.equal(await openTab.getAttribute('aria-selected'), 'true', 'Confirmation cancel changed the active segment');

  await manage.click();
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  await session.page.waitForFunction(() => document.querySelector('[data-testid="action-segment-archived"]')?.getAttribute('aria-selected') === 'true');
  assert.equal(await archivedTab.getAttribute('aria-selected'), 'true', 'Dismiss did not move to Archived');
  await queue.getByTestId('action-manage').filter({ hasText: 'Restore' }).waitFor({ state: 'visible' });
  assert.equal(await queue.locator('.action-review__title > strong').textContent(), 'Drafted', 'Archive changed the proposal lifecycle state');

  await session.page.waitForFunction(async (itemId) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state?.actionProposals?.some((proposal) => proposal.archivedAt)
      && state?.items?.some((item) => item.id === itemId);
  }, FIXTURE_ITEM_ID);
  const archivedBeforeReload = await session.page.evaluate(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state?.actionProposals?.map(({ content, ...proposal }) => proposal) || [];
  });
  await openApp(session, { reseed: false });
  await session.page.getByRole('button', { name: /^Actions/ }).click();
  const restoredQueue = session.page.getByTestId('action-queue');
  const restoredArchivedTab = restoredQueue.getByTestId('action-segment-archived');
  assert.equal(Number(await restoredArchivedTab.locator('strong').textContent()), 1,
    `Archived proposal did not persist across reload: ${JSON.stringify(archivedBeforeReload)}`);
  await restoredArchivedTab.click();
  assert.equal(await restoredArchivedTab.getAttribute('aria-selected'), 'true');
  await restoredQueue.getByTestId('action-manage').filter({ hasText: 'Restore' }).waitFor({ state: 'visible' });
  await restoredQueue.getByTestId('action-manage').press('Enter');
  const restoreConfirm = session.page.locator('.modal.show');
  await restoreConfirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  assert.equal(await restoredQueue.getByTestId('action-segment-open').getAttribute('aria-selected'), 'true', 'Restore did not return the drafted proposal to Open');
  assert.equal(await restoredQueue.locator('.action-review__title > strong').textContent(), 'Drafted');
  const persisted = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  const sourceAfter = persisted.items.find((item) => item.id === FIXTURE_ITEM_ID);
  assert.ok(sourceAfter, 'Archive/restore removed the source thread');
  assert.deepEqual({ title: sourceAfter.title, sourceType: sourceAfter.sourceType, lifecycleStatus: sourceAfter.lifecycleStatus }, sourceBefore,
    'Archive/restore changed the source thread identity or lifecycle');
  await assertHealthy(session);
}

async function actionQueueEligibilityScenario(session) {
  const openDraft = async () => {
    await openApp(session);
    await selectFixtureThread(session.page);
    await session.page.getByTestId('radar-draft-email').click();
    const queue = session.page.getByTestId('action-queue');
    await queue.locator('#action-target').fill('sofia@example.com');
    await queue.locator('#action-target').press('Tab');
    return queue;
  };

  let queue = await openDraft();
  assert.equal(await queue.getByTestId('action-manage').textContent(), 'Dismiss proposal');
  await queue.getByRole('button', { name: 'Submit for review', exact: true }).click();
  assert.equal(await queue.getByTestId('action-manage').textContent(), 'Reject proposal');
  await queue.getByTestId('action-manage').click();
  await session.page.getByTestId('confirm-modal').getByRole('button', { name: 'Confirm', exact: true }).click();
  assert.equal(await queue.locator('.action-review__title > strong').textContent(), 'Rejected');
  assert.equal(await queue.getByTestId('action-manage').textContent(), 'Archive');

  queue = await openDraft();
  await queue.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await queue.getByRole('button', { name: 'Approve content', exact: true }).click();
  assert.equal(await queue.getByTestId('action-manage').textContent(), 'Cancel proposal');
  await queue.getByRole('button', { name: 'Queue Outlook draft', exact: true }).click();
  assert.equal(await queue.getByTestId('action-manage').textContent(), 'Cancel proposal');
  await queue.getByTestId('action-manage').click();
  await session.page.getByTestId('confirm-modal').getByText('No external action has occurred.', { exact: false }).waitFor({ state: 'visible' });
  await session.page.getByTestId('confirm-submit').click();
  assert.equal(await queue.locator('.action-review__title > strong').textContent(), 'Cancelled');
  assert.equal(await queue.getByTestId('action-manage').textContent(), 'Archive');
  await assertHealthy(session);
}

async function actionQueueExecutingLockoutScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  await queue.locator('#action-target').fill('sofia@example.com');
  await queue.locator('#action-target').press('Tab');
  for (const label of ['Submit for review', 'Approve content', 'Queue Outlook draft']) {
    await queue.getByRole('button', { name: label, exact: true }).click();
  }
  assert.equal(await queue.getByTestId('action-manage').textContent(), 'Cancel proposal', 'Queued proposal did not expose cancellation');
  await queue.getByRole('button', { name: 'Create Outlook draft', exact: true }).click();
  await queue.locator('.action-review__title > strong').filter({ hasText: /^Executing$/ }).waitFor({ state: 'visible' });
  assert.equal(await queue.getByTestId('action-manage').count(), 0, 'Executing proposal exposed management');
  assert.equal(await queue.getByRole('button', { name: /Retry|Archive|Cancel proposal/i }).count(), 0, 'Executing proposal exposed cancel, archive, or retry');
  assert.equal(await session.page.evaluate(() => window.__draftCalls.length), 1, 'Executing scenario dispatched more than one mocked request');
  await assertHealthy(session);
}

async function createDuplicateExecutingProposals(session) {
  await openApp(session);
  await session.page.evaluate(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const now = new Date().toISOString();
    const fixture = {
      sourceItemId: 'track_meridian_escalation',
      sourceTitle: 'Meridian Labs — Tier 1 Support Escalation',
      sourceType: 'Email',
      sourceDestination: 'Radar',
      sourceContextId: 'track_meridian_escalation',
      channel: 'email-send',
      target: 'Sofia Martinez',
      content: 'Send interim update to Sofia Martinez',
      state: 'Drafted',
      outcome: null,
      executionVerification: null,
      executionCode: null,
      dispatchStatus: 'not-started',
      archivedAt: null,
      archivedReason: null,
      reason: 'Tier 1 SLA breach risk.',
      evidence: ['Sofia Martinez escalation email'],
      risk: 'Verify target and wording before authorizing.',
      provenance: 'Browser acceptance fixture',
      createdAt: now,
      updatedAt: now,
      localOnly: true,
    };
    state.actionProposals = [
      { ...fixture, id: 'proposal_delete_duplicate_1' },
      { ...fixture, id: 'proposal_delete_duplicate_2' },
    ];
    await window.workiq.storeSet('flightdeck.demo.v2', state);
  });
  await openApp(session, { reseed: false });
  await session.page.getByRole('button', { name: /^Actions/ }).click();
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  await queue.getByTestId('action-duplicate-count').getByText('2 duplicates', { exact: true }).waitFor({ state: 'visible' });

  const executeSelected = async () => {
    for (const label of ['Submit for review', 'Approve content']) {
      await queue.getByRole('button', { name: label, exact: true }).click();
    }
    await queue.getByRole('button', { name: /^Queue / }).click();
    await queue.getByRole('button', { name: 'Authorize send to target', exact: true }).click();
    await queue.locator('.action-review__title > strong').filter({ hasText: /^Executing$/ }).waitFor({ state: 'visible' });
  };

  await executeSelected();
  await queue.locator('.action-queue__list > button:not(.active)').first().click();
  await executeSelected();
  assert.equal(await queue.locator('.action-queue__list > button').filter({ hasText: /Executing/ }).count(), 2,
    'The deletion fixture did not contain two Executing proposals');
  assert.equal(await queue.getByTestId('action-delete').count(), 1, 'Executing proposal did not expose individual permanent deletion');
  assert.equal(await queue.getByTestId('action-delete-duplicates').textContent(), 'Delete 2 duplicates…');
  return queue;
}

async function actionQueueDeleteOneDuplicateScenario(session) {
  const queue = await createDuplicateExecutingProposals(session);
  const deleteOne = queue.getByTestId('action-delete');
  await deleteOne.focus();
  await deleteOne.click();
  const confirm = session.page.getByTestId('confirm-modal');
  await confirm.getByText('FlightDeck cannot verify whether Outlook or Teams acted.', { exact: false }).waitFor({ state: 'visible' });
  await confirm.getByText('An active external request cannot be cancelled.', { exact: false }).waitFor({ state: 'visible' });
  const acknowledgement = confirm.getByTestId('confirm-acknowledgement');
  const submit = confirm.getByTestId('confirm-submit');
  assert.equal(await submit.isDisabled(), true, 'Elevated deletion was enabled before acknowledgement');
  assert.equal(await confirm.getByTestId('confirm-cancel').evaluate((element) => element === document.activeElement), true,
    'Deletion confirmation did not focus Cancel');
  await confirm.getByTestId('confirm-cancel').click();
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await deleteOne.evaluate((element) => element === document.activeElement), true,
    'Cancelling deletion did not restore focus to the exact command');
  assert.equal(await queue.locator('.action-queue__list > button').count(), 2, 'Cancelling deletion removed a proposal');

  await deleteOne.click();
  await acknowledgement.check();
  assert.equal(await submit.isEnabled(), true, 'Acknowledgement did not enable permanent deletion');
  await submit.click();
  await queue.locator('.action-queue__list > button').filter({ hasText: /Executing/ }).waitFor({ state: 'visible' });
  assert.equal(await queue.locator('.action-queue__list > button').count(), 1, 'Individual deletion did not retain the duplicate');
  assert.equal(await queue.getByTestId('action-duplicate-count').count(), 0, 'Duplicate badge remained after deleting one of two');
  await queue.getByRole('status').getByText('Proposal permanently deleted. Source thread retained.', { exact: true }).waitFor({ state: 'visible' });

  await session.page.waitForFunction(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state?.actionProposals?.length === 1;
  });
  await openApp(session, { reseed: false });
  await session.page.getByRole('button', { name: /^Actions/ }).click();
  const restoredQueue = session.page.getByTestId('action-queue');
  await restoredQueue.getByText(/execution was interrupted before dispatch/i).waitFor({ state: 'visible' });
  assert.equal(await restoredQueue.getByTestId('action-delete').count(), 1, 'Recovered stale execution lost deletion controls');
  assert.equal(await restoredQueue.getByRole('button', { name: /Retry Email send/i }).count(), 1,
    'Recovered stale execution was stuck without retry controls');
  const persisted = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  assert.ok(persisted.items.some((item) => item.id === 'track_meridian_escalation'), 'Individual deletion removed the source thread');
  await assertHealthy(session);
}

async function actionQueueDeleteDuplicateGroupScenario(session) {
  const queue = await createDuplicateExecutingProposals(session);
  await queue.getByTestId('action-delete-duplicates').click();
  const confirm = session.page.getByTestId('confirm-modal');
  await confirm.getByRole('heading', { name: 'Delete 2 duplicates permanently?', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await confirm.getByTestId('confirm-submit').isDisabled(), true);
  await confirm.getByTestId('confirm-acknowledgement').check();
  await confirm.getByTestId('confirm-submit').click();
  await queue.getByTestId('action-segment-empty').getByText('No open proposals.', { exact: true }).waitFor({ state: 'visible' });
  await queue.getByRole('status').getByText('2 duplicate proposals permanently deleted. Source thread retained.', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(Number(await queue.getByTestId('action-segment-open').locator('strong').textContent()), 0);

  await session.page.waitForFunction(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state?.items?.find((item) => item.id === 'track_meridian_escalation');
    return state?.actionProposals?.length === 0
      && source?.updateHistory?.filter((entry) => entry.event === 'proposal-deleted').length === 2;
  });
  const persisted = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  const source = persisted.items.find((item) => item.id === 'track_meridian_escalation');
  assert.ok(source, 'Duplicate-group deletion removed the source thread');
  assert.equal(source.updateHistory.filter((entry) => entry.event === 'execution-started').length, 2,
    'Duplicate-group deletion removed uncertain execution evidence');
  assert.equal(source.updateHistory.filter((entry) => entry.event === 'proposal-deleted').length, 2,
    'Duplicate-group deletion did not retain two thread tombstones');
  assert.equal(persisted.history.filter((entry) => entry.payload?.event === 'proposal-deleted').length, 2,
    'Duplicate-group deletion did not retain two global tombstones');
  await openApp(session, { reseed: false });
  await session.page.getByRole('button', { name: /^Actions/ }).click();
  assert.equal(Number(await session.page.getByTestId('action-segment-open').locator('strong').textContent()), 0,
    'Duplicate-group deletion did not survive reload');
  await assertHealthy(session);
}

async function actionQueueDeleteNoEffectRollbackScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  const proposalId = await queue.locator('.action-queue__list > button.active').getAttribute('data-proposal-id');
  await queue.getByTestId('action-delete').click();
  const confirm = session.page.getByTestId('confirm-modal');
  await confirm.getByText('No external action occurred. This removes the proposal from FlightDeck and cannot be undone.', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await confirm.getByTestId('confirm-acknowledgement').count(), 0, 'No-effect deletion required elevated acknowledgement');
  await session.page.evaluate((id) => { window.__failDeletionForProposalId = id; }, proposalId);
  await confirm.getByTestId('confirm-submit').click();
  await queue.getByRole('alert').getByText('Could not delete the proposal. Nothing was removed.', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await queue.locator(`[data-proposal-id="${proposalId}"]`).count(), 1, 'Failed deletion did not roll back the proposal row');

  await queue.getByTestId('action-delete').click();
  await session.page.getByTestId('confirm-submit').click();
  await queue.locator(`[data-proposal-id="${proposalId}"]`).waitFor({ state: 'detached' });
  assert.equal(await queue.locator('.action-queue__list > button.active').count(), 1,
    'Successful deletion did not select the nearest remaining row');
  await session.page.waitForFunction(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return !state?.actionProposals?.some((proposal) => proposal.id === id);
  }, proposalId);
  const persisted = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  const source = persisted.items.find((item) => item.id === FIXTURE_ITEM_ID);
  assert.ok(source, 'No-effect deletion removed the source thread');
  assert.equal(source.updateHistory.some((entry) => entry.proposalId === proposalId), false,
    'No-effect deletion retained administrative thread events');
  assert.equal(persisted.history.some((entry) => entry.payload?.proposalId === proposalId && entry.payload?.event === 'proposal-created'), false,
    'No-effect deletion retained administrative global events');
  assert.ok(persisted.history.some((entry) => entry.payload?.proposalId === proposalId
    && entry.payload?.event === 'proposal-deleted' && entry.payload?.effect === 'no-effect'),
    'No-effect deletion did not retain its sanitized global tombstone');
  await assertHealthy(session);
}

async function actionQueueDeleteConfirmedScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  await queue.locator('#action-target').fill('sofia@example.com');
  await queue.locator('#action-target').press('Tab');
  for (const label of ['Submit for review', 'Approve content', 'Queue Outlook draft', 'Create Outlook draft']) {
    await queue.getByRole('button', { name: label, exact: true }).click();
  }
  await queue.locator('.action-review__title > strong').filter({ hasText: /^Succeeded$/ }).waitFor({ state: 'visible' });
  const proposalId = await queue.locator('.action-queue__list > button.active').getAttribute('data-proposal-id');
  await queue.getByTestId('action-delete').click();
  const confirm = session.page.getByTestId('confirm-modal');
  await confirm.getByText('An external draft or message exists.', { exact: false }).waitFor({ state: 'visible' });
  await confirm.getByText('will not delete it externally', { exact: false }).waitFor({ state: 'visible' });
  await confirm.getByTestId('confirm-acknowledgement').check();
  await confirm.getByTestId('confirm-submit').click();
  await session.page.waitForFunction(async ({ proposalId: id, itemId }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state?.items?.find((item) => item.id === itemId);
    return !state?.actionProposals?.some((proposal) => proposal.id === id)
      && source?.updateHistory?.some((entry) => entry.proposalId === id && entry.event === 'succeeded')
      && source?.updateHistory?.some((entry) => entry.proposalId === id && entry.event === 'proposal-deleted' && entry.effect === 'confirmed');
  }, { proposalId, itemId: FIXTURE_ITEM_ID });
  const persisted = await session.page.evaluate(() => window.workiq.storeGet('flightdeck.demo.v2'));
  assert.ok(persisted.items.some((item) => item.id === FIXTURE_ITEM_ID), 'Confirmed deletion removed the source thread');
  await assertHealthy(session);
}

async function actionQueueDeleteLateResultScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  await queue.locator('#action-target').fill('sofia@example.com');
  await queue.locator('#action-target').press('Tab');
  for (const label of ['Submit for review', 'Approve content', 'Queue Outlook draft', 'Create Outlook draft']) {
    await queue.getByRole('button', { name: label, exact: true }).click();
  }
  await queue.locator('.action-review__title > strong').filter({ hasText: /^Executing$/ }).waitFor({ state: 'visible' });
  const proposalId = await queue.locator('.action-queue__list > button.active').getAttribute('data-proposal-id');
  await queue.getByTestId('action-delete').click();
  await session.page.getByTestId('confirm-acknowledgement').check();
  await session.page.getByTestId('confirm-submit').click();
  await queue.locator(`[data-proposal-id="${proposalId}"]`).waitFor({ state: 'detached' });
  await session.page.evaluate(() => window.__resolveDraft());
  await session.page.waitForFunction(async ({ proposalId: id, itemId }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state?.items?.find((item) => item.id === itemId);
    return !state?.actionProposals?.some((proposal) => proposal.id === id)
      && source?.updateHistory?.some((entry) => entry.proposalId === id && entry.event === 'succeeded');
  }, { proposalId, itemId: FIXTURE_ITEM_ID });
  assert.equal(await queue.locator(`[data-proposal-id="${proposalId}"]`).count(), 0, 'Late result recreated the deleted proposal row');
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await session.page.getByTestId('action-timeline-entry').filter({ hasText: 'Outlook draft saved in Outlook Drafts. Nothing was sent.' }).waitFor({ state: 'visible' });
  await session.page.getByTestId('action-timeline-entry').filter({ hasText: 'Action proposal permanently deleted' }).waitFor({ state: 'visible' });
  await assertHealthy(session);
}

async function actionQueueDeleteResponsiveScenario(session, viewportWidth, captureScreenshot = false) {
  const queue = await createDuplicateExecutingProposals(session);
  const expectedLifecycleLabels = ['Drafted', 'Awaiting review', 'Approved', 'Queued', 'Executing', 'Succeeded/Failed'];
  const measureQueue = () => queue.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const body = element.querySelector('.action-review__body');
    const footer = element.querySelector('.action-review__buttons');
    return {
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rect: rect.toJSON(),
      body: {
        rect: body.getBoundingClientRect().toJSON(),
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        scrollTop: body.scrollTop,
      },
      footer: footer.getBoundingClientRect().toJSON(),
      footerButtons: [...footer.querySelectorAll('button')].map((button) => button.getBoundingClientRect().toJSON()),
      deleteButtons: [...element.querySelectorAll('[data-testid^="action-delete"]')].map((button) => button.getBoundingClientRect().toJSON()),
      lifecycle: (() => {
      const container = element.querySelector('.action-lifecycle');
      const labels = [...container.querySelectorAll('li')].map((label) => ({
        accessibleName: label.getAttribute('aria-label'),
        ariaCurrent: label.getAttribute('aria-current'),
        rect: label.getBoundingClientRect().toJSON(),
        clipped: label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1,
      }));
      return {
        rect: container.getBoundingClientRect().toJSON(),
        clientWidth: container.clientWidth,
        scrollWidth: container.scrollWidth,
        rows: [...new Set(labels.map((label) => Math.round(label.rect.top)))].length,
        labels,
      };
      })(),
    };
  });
  const geometry = await measureQueue();
  assert.equal(geometry.scrollWidth > geometry.documentWidth + 1, false, `Deletion controls overflowed at ${viewportWidth}px`);
  assert.equal(geometry.deleteButtons.length, 2, `Deletion choices were not both visible at ${viewportWidth}px`);
  assert.equal(geometry.deleteButtons.every((rect) => rect.height >= 44 && rect.left >= 0 && rect.right <= viewportWidth + 1
    && rect.top >= 0 && rect.bottom <= geometry.viewportHeight + 1), true,
    `Deletion choices were clipped or undersized at ${viewportWidth}px: ${JSON.stringify(geometry.deleteButtons)}`);
  assert.deepEqual(geometry.lifecycle.labels.map((label) => label.accessibleName), expectedLifecycleLabels,
    `Lifecycle accessible names were incomplete at ${viewportWidth}px`);
  assert.equal(geometry.lifecycle.scrollWidth > geometry.lifecycle.clientWidth + 1, false,
    `Lifecycle required horizontal scrolling at ${viewportWidth}px: ${JSON.stringify(geometry.lifecycle)}`);
  assert.equal(geometry.lifecycle.labels.every((label) => label.rect.left >= geometry.lifecycle.rect.left - 1
    && label.rect.right <= geometry.lifecycle.rect.right + 1 && !label.clipped), true,
  `Lifecycle labels were clipped or outside their container at ${viewportWidth}px: ${JSON.stringify(geometry.lifecycle)}`);
  assert.deepEqual(geometry.lifecycle.labels.filter((label) => label.ariaCurrent === 'step').map((label) => label.accessibleName), ['Executing'],
    `Lifecycle current state was not exposed at ${viewportWidth}px`);

  if (viewportWidth <= 960) {
    assert.ok(geometry.rect.top >= 0 && geometry.rect.bottom <= geometry.viewportHeight + 1,
      `Action Queue exceeded the initial viewport at ${viewportWidth}px: ${JSON.stringify(geometry.rect)}`);
    assert.ok(geometry.footer.top >= geometry.body.rect.bottom - 1 && geometry.footer.bottom <= geometry.rect.bottom + 1,
      `Action footer overlaid content or escaped the queue at ${viewportWidth}px: ${JSON.stringify({ body: geometry.body.rect, footer: geometry.footer, queue: geometry.rect })}`);
    assert.equal(geometry.footerButtons.every((rect) => rect.top >= geometry.footer.top - 1
      && rect.bottom <= geometry.footer.bottom + 1 && rect.bottom <= geometry.viewportHeight + 1), true,
    `Action footer buttons escaped the initial viewport at ${viewportWidth}px: ${JSON.stringify(geometry.footerButtons)}`);
    assert.ok(geometry.lifecycle.rect.top >= geometry.body.rect.top - 1
      && geometry.lifecycle.rect.bottom <= geometry.body.rect.bottom + 1,
    `Lifecycle was not initially visible at ${viewportWidth}px: ${JSON.stringify({ body: geometry.body.rect, lifecycle: geometry.lifecycle.rect })}`);
    assert.equal(geometry.lifecycle.rows, 2, `Lifecycle was not a 2x3 grid at ${viewportWidth}px: ${JSON.stringify(geometry.lifecycle)}`);
    assert.ok(geometry.body.scrollHeight > geometry.body.clientHeight,
      `Long proposal detail did not retain internal scrolling at ${viewportWidth}px: ${JSON.stringify(geometry.body)}`);
  }

  if (captureScreenshot) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, `action-queue-delete-controls-${viewportWidth}.png`);
    await session.page.screenshot({ path: screenshotPath, fullPage: false });
    screenshotPaths.push(screenshotPath);
    process.stdout.write(`SCREENSHOT view=action-queue-delete-controls viewport=${viewportWidth} path=${screenshotPath} bytes=${fs.statSync(screenshotPath).size}\n`);
  }

  if (viewportWidth <= 960) {
    await queue.locator('.action-review__body').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const scrolledGeometry = await measureQueue();
    assert.ok(scrolledGeometry.body.scrollTop > 0, `Proposal detail did not scroll internally at ${viewportWidth}px`);
    assert.ok(Math.abs(scrolledGeometry.footer.top - geometry.footer.top) <= 1
      && Math.abs(scrolledGeometry.footer.bottom - geometry.footer.bottom) <= 1,
    `Action footer moved during internal scrolling at ${viewportWidth}px: ${JSON.stringify({ initial: geometry.footer, scrolled: scrolledGeometry.footer })}`);
    assert.ok(scrolledGeometry.footer.top >= scrolledGeometry.body.rect.bottom - 1
      && scrolledGeometry.footer.bottom <= scrolledGeometry.viewportHeight + 1,
    `Action footer overlaid scrolled content at ${viewportWidth}px: ${JSON.stringify(scrolledGeometry)}`);
    await queue.locator('.action-lifecycle').evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const lifecycleGeometry = (await measureQueue()).lifecycle;
    assert.equal(lifecycleGeometry.scrollWidth > lifecycleGeometry.clientWidth + 1, false,
      `Lifecycle required horizontal scrolling after internal scroll at ${viewportWidth}px: ${JSON.stringify(lifecycleGeometry)}`);
    assert.equal(lifecycleGeometry.labels.every((label) => label.rect.left >= lifecycleGeometry.rect.left - 1
      && label.rect.right <= lifecycleGeometry.rect.right + 1 && !label.clipped), true,
    `Lifecycle labels were clipped after internal scroll at ${viewportWidth}px: ${JSON.stringify(lifecycleGeometry)}`);
  }

  const deleteOne = queue.getByTestId('action-delete');
  await deleteOne.click();
  const confirm = session.page.getByTestId('confirm-modal');
  const cancel = confirm.getByTestId('confirm-cancel');
  const acknowledgement = confirm.getByTestId('confirm-acknowledgement');
  const submit = confirm.getByTestId('confirm-submit');
  assert.equal(await cancel.evaluate((element) => element === document.activeElement), true, `Cancel lacked initial focus at ${viewportWidth}px`);
  assert.equal(await submit.isDisabled(), true, `Elevated acknowledgement gate was bypassed at ${viewportWidth}px`);
  await cancel.press('Shift+Tab');
  assert.equal(await acknowledgement.evaluate((element) => element === document.activeElement), true,
    `Reverse focus did not wrap to acknowledgement at ${viewportWidth}px`);
  await acknowledgement.check();
  assert.equal(await submit.isEnabled(), true);
  const modalGeometry = await confirm.locator('.modal-card').evaluate((element) => ({
    rect: element.getBoundingClientRect().toJSON(),
    documentWidth: document.documentElement.clientWidth,
    viewportHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    buttons: [...element.querySelectorAll('button')].map((button) => button.getBoundingClientRect().toJSON()),
  }));
  assert.equal(modalGeometry.scrollWidth > modalGeometry.documentWidth + 1, false, `Deletion modal overflowed at ${viewportWidth}px`);
  assert.ok(modalGeometry.rect.left >= 0 && modalGeometry.rect.right <= viewportWidth + 1
    && modalGeometry.rect.top >= 0 && modalGeometry.rect.bottom <= modalGeometry.viewportHeight + 1,
  `Deletion modal was clipped at ${viewportWidth}px: ${JSON.stringify(modalGeometry.rect)}`);
  assert.equal(modalGeometry.buttons.every((rect) => rect.left >= modalGeometry.rect.left - 1
    && rect.right <= modalGeometry.rect.right + 1 && rect.bottom <= modalGeometry.viewportHeight + 1), true,
  `Deletion modal buttons were clipped at ${viewportWidth}px: ${JSON.stringify(modalGeometry.buttons)}`);
  await confirm.press('Escape');
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await deleteOne.evaluate((element) => element === document.activeElement), true,
    `Deletion modal did not restore focus at ${viewportWidth}px`);
  await assertHealthy(session, viewportWidth > 960 ? 'desktop' : 'mobile');
}

async function actionQueueReliabilityScenario(session, viewportWidth) {
  await openApp(session);
  await selectFixtureThread(session.page);
  const radarTrigger = session.page.getByTestId('radar-draft-email');
  await radarTrigger.focus();
  await radarTrigger.click();
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });

  const measureSurfaces = () => session.page.evaluate(() => {
    const parseColor = (value) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) || [];
      if (value.startsWith('color(srgb ')) {
        return { red: (channels[0] || 0) * 255, green: (channels[1] || 0) * 255, blue: (channels[2] || 0) * 255, alpha: channels.length > 3 ? channels[3] : 1 };
      }
      return { red: channels[0] || 0, green: channels[1] || 0, blue: channels[2] || 0, alpha: channels.length > 3 ? channels[3] : 1 };
    };
    const luminance = ({ red, green, blue }) => [red, green, blue]
      .map((channel) => channel / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const selectors = ['.action-queue', '.action-queue__header', '.action-queue__segments', '.action-queue__layout', '.action-review'];
    const surfaces = Object.fromEntries(selectors.map((selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, { background: style.backgroundColor, opacity: Number(style.opacity), color: style.color }];
    }));
    const title = getComputedStyle(document.querySelector('.action-queue__header h2'));
    const panel = parseColor(surfaces['.action-queue'].background);
    const backdrop = getComputedStyle(document.querySelector('.action-queue-backdrop')).backgroundColor;
    return {
      surfaces,
      contrast: contrast(parseColor(title.color), panel),
      titleColor: title.color,
      panelColor: surfaces['.action-queue'].background,
      backdrop,
      backdropAlpha: parseColor(backdrop).alpha,
    };
  });

  for (const theme of ['dark', 'light']) {
    await session.page.locator('html').evaluate((element, nextTheme) => element.setAttribute('data-theme', nextTheme), theme);
    const measurements = await measureSurfaces();
    for (const [selector, surface] of Object.entries(measurements.surfaces)) {
      const alpha = surface.background.match(/[\d.]+/g)?.map(Number)?.[3] ?? 1;
      assert.equal(alpha, 1, `${selector} used a translucent background in ${theme} theme: ${surface.background}`);
      assert.equal(surface.opacity, 1, `${selector} reduced opacity in ${theme} theme`);
      assert.notEqual(surface.background, 'rgba(0, 0, 0, 0)', `${selector} used a transparent background in ${theme} theme`);
    }
    assert.ok(measurements.contrast >= 4.5, `Action Queue title contrast was ${measurements.contrast.toFixed(2)}:1 in ${theme} theme: ${measurements.titleColor} on ${measurements.panelColor}`);
    assert.ok(measurements.backdropAlpha > 0 && measurements.backdropAlpha < 1, `Backdrop separation was flattened in ${theme} theme: ${measurements.backdrop}`);
  }
  await session.page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));

  if (viewportWidth <= 960) {
    const reviewBody = queue.locator('.action-review__body');
    const beforeScroll = await reviewBody.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    assert.ok(beforeScroll.scrollHeight > beforeScroll.clientHeight, `Action Queue did not provide internal scrolling at ${viewportWidth}px: ${JSON.stringify(beforeScroll)}`);
    await reviewBody.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const reachability = await queue.evaluate((element) => {
      const queueRect = element.getBoundingClientRect();
      const reviewBody = element.querySelector('.action-review__body');
      const actionBar = element.querySelector('.action-review__buttons');
      const bodyRect = reviewBody.getBoundingClientRect();
      const actionRect = actionBar.getBoundingClientRect();
      const contentBottom = Math.max(...[...reviewBody.children].map((child) => child.getBoundingClientRect().bottom));
      return {
        actionTop: actionRect.top,
        actionBottom: actionRect.bottom,
        bodyBottom: bodyRect.bottom,
        contentBottom,
        queueTop: queueRect.top,
        queueBottom: queueRect.bottom,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        queueOverflow: element.scrollWidth - element.clientWidth,
      };
    });
    assert.ok(reachability.actionTop >= reachability.queueTop && reachability.actionBottom <= reachability.queueBottom + 1,
      `Action bar was not reachable at ${viewportWidth}px: ${JSON.stringify(reachability)}`);
    assert.ok(reachability.bodyBottom <= reachability.actionTop + 1 && reachability.contentBottom <= reachability.bodyBottom + 1,
      `Action bar covered final review content at ${viewportWidth}px: ${JSON.stringify(reachability)}`);
    assert.ok(reachability.documentOverflow <= 1 && reachability.queueOverflow <= 1,
      `Action Queue overflowed horizontally at ${viewportWidth}px: ${JSON.stringify(reachability)}`);
  }

  const manage = queue.getByTestId('action-manage');
  await manage.click();
  const confirm = session.page.getByTestId('confirm-modal');
  const cancel = confirm.getByTestId('confirm-cancel');
  const submit = confirm.getByTestId('confirm-submit');
  assert.equal(await cancel.evaluate((element) => element === document.activeElement), true, 'Confirm modal initial focus was not deterministic');
  await cancel.press('Shift+Tab');
  assert.equal(await submit.evaluate((element) => element === document.activeElement), true, 'Shift+Tab escaped Confirm modal');
  await submit.press('Tab');
  assert.equal(await cancel.evaluate((element) => element === document.activeElement), true, 'Tab escaped Confirm modal');
  await confirm.press('Escape');
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await manage.evaluate((element) => element === document.activeElement), true, 'Confirm Escape did not restore its exact initiator');

  await queue.press('Escape');
  await queue.waitFor({ state: 'detached' });
  assert.equal(await radarTrigger.evaluate((element) => element === document.activeElement), true, 'Queue Escape did not restore the async Radar trigger');

  const topbarTrigger = session.page.getByRole('button', { name: /^Actions/ });
  await topbarTrigger.click();
  await queue.waitFor({ state: 'visible' });
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await queue.waitFor({ state: 'detached' });
  assert.equal(await topbarTrigger.evaluate((element) => element === document.activeElement), true, 'Queue close button did not restore its exact trigger');

  if (viewportWidth > 960) {
    await topbarTrigger.click();
    await queue.waitFor({ state: 'visible' });
    await session.page.locator('.action-queue-backdrop').click({ position: { x: 8, y: 8 } });
    await queue.waitFor({ state: 'detached' });
    assert.equal(await topbarTrigger.evaluate((element) => element === document.activeElement), true, 'Queue backdrop close did not restore its exact trigger');
  }
  await assertHealthy(session, viewportWidth > 960 ? 'desktop' : 'mobile');
}

async function actionQueueSourceFocusScenario(session) {
  await openApp(session);

  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  const todayTrigger = session.page.locator('.today-view').getByRole('button', { name: 'Propose update', exact: true });
  await todayTrigger.focus();
  await todayTrigger.click();
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await queue.waitFor({ state: 'detached' });
  assert.equal(await todayTrigger.evaluate((element) => element === document.activeElement), true,
    'Action Queue did not restore focus to the Today opener');

  await session.page.getByRole('button', { name: 'Briefings', exact: true }).click();
  const meeting = session.page.locator('.meeting-card').first();
  await meeting.locator('.meeting-card__header').click();
  const briefingTrigger = meeting.getByRole('button', { name: 'Review follow-up', exact: true });
  await briefingTrigger.focus();
  await briefingTrigger.click();
  await queue.waitFor({ state: 'visible' });
  await queue.press('Escape');
  await queue.waitFor({ state: 'detached' });
  assert.equal(await briefingTrigger.evaluate((element) => element === document.activeElement), true,
    'Action Queue did not restore focus to the Briefings opener');
  await assertHealthy(session);
}

async function actionQueueScreenshotScenario(session, viewportLabel) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const queuePath = path.join(SCREENSHOT_DIR, `action-queue-${viewportLabel}.png`);
  await session.page.screenshot({ path: queuePath, fullPage: false });
  screenshotPaths.push(queuePath);
  const queueViewport = session.page.viewportSize();
  process.stdout.write(`SCREENSHOT view=action-queue viewport=${queueViewport.width}x${queueViewport.height} path=${queuePath} bytes=${fs.statSync(queuePath).size}\n`);

  await queue.getByRole('button', { name: 'Return to source', exact: true }).click();
  const actionEntry = session.page.getByTestId('action-timeline-entry').first();
  await actionEntry.waitFor({ state: 'visible' });
  await actionEntry.getByText('Action', { exact: true }).waitFor({ state: 'visible' });
  await actionEntry.getByText('Action proposal created', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await actionEntry.evaluate((element) => /proposal[_:]|SECRET|message body/i.test(element.textContent)), false, 'Timeline exposed an identifier or message content');
  const timelinePath = path.join(SCREENSHOT_DIR, `thread-action-timeline-${viewportLabel}.png`);
  await session.page.screenshot({ path: timelinePath, fullPage: false });
  screenshotPaths.push(timelinePath);
  process.stdout.write(`SCREENSHOT view=thread-timeline viewport=${queueViewport.width}x${queueViewport.height} path=${timelinePath} bytes=${fs.statSync(timelinePath).size}\n`);
  await assertHealthy(session, queueViewport.width > 960 ? 'desktop' : 'mobile');
}

async function teamsReviewScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-teams').click();
  const draft = session.page.getByTestId('teams-draft-editor');
  await draft.waitFor({ state: 'visible' });
  const proposalCalls = await session.page.evaluate(() => structuredClone(window.__proposalCalls));
  assert.equal(proposalCalls.length, 1, 'Draft Teams message did not invoke the narrow API exactly once');
  assert.equal(proposalCalls[0].requestedChannel, 'teams');
  await draft.getByText('A confirmed window is the smallest step that unblocks the renewal.', { exact: true }).waitFor({ state: 'visible' });
  await draft.getByText('Confirm the recipient is the current owner.', { exact: true }).waitFor({ state: 'visible' });
  await draft.getByText('Verify the channel.', { exact: true }).waitFor({ state: 'visible' });
  const recipient = draft.locator('input[type="text"]');
  assert.equal(await recipient.inputValue(), 'James Farquharson');
  await recipient.fill('Alex Johnson');
  assert.equal(await recipient.inputValue(), 'Alex Johnson', 'Teams recipient was not editable');
  await recipient.fill('James Farquharson');
  const message = draft.locator('textarea');
  assert.equal(await message.inputValue(), 'Who can confirm the renewal deployment owner?');
  await message.fill('Can you confirm who owns renewal deployment validation?');
  assert.equal(await message.inputValue(), 'Can you confirm who owns renewal deployment validation?');
  await draft.getByText('Review the recipient and message before sending. FlightDeck will ask for confirmation.', { exact: true }).waitFor({ state: 'visible' });
  const send = draft.getByRole('button', { name: 'Send message', exact: true });
  assert.equal(await send.count(), 1, 'Teams draft did not expose the governed send command');
  assert.equal(await send.isEnabled(), true, 'A named Teams target remained blocked by the stale resolution flag');
  assert.equal(await draft.getByText('Choose the Teams chat or channel before posting.', { exact: true }).count(), 0, 'A named Teams target still showed the resolution warning');
  assert.equal(await session.page.evaluate(() => window.__teamsSendCalls.length), 0, 'Teams synthesis sent before explicit review');
  assert.equal(await draft.getByRole('button', { name: 'Copy message', exact: true }).count(), 1, 'Teams draft was not copyable');
  assert.equal(await session.page.getByTestId('action-queue').count(), 0, 'Teams review opened the local action queue');
  await assertHealthy(session);
}

async function teamsSendScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-teams').click();
  const draft = session.page.getByTestId('teams-draft-editor');
  const message = draft.locator('textarea');
  const send = draft.getByTestId('teams-draft-send');
  const editedMessage = 'James, can you confirm who owns renewal deployment validation?';
  await message.fill(editedMessage);

  await send.click();
  await draft.getByTestId('teams-send-status').filter({ hasText: 'Send cancelled. No request was dispatched.' }).waitFor({ state: 'visible' });
  assert.equal(await message.inputValue(), editedMessage, 'Cancellation discarded the edited Teams draft');

  await send.click();
  await draft.getByTestId('teams-send-status').filter({ hasText: 'Delivery could not be confirmed. Check Teams before trying again.' }).waitFor({ state: 'visible' });
  assert.equal(await message.inputValue(), editedMessage, 'Unconfirmed send discarded the edited Teams draft');

  await send.click();
  await draft.getByTestId('teams-send-status').filter({ hasText: 'Teams reported that the message was not sent' }).waitFor({ state: 'visible' });
  assert.equal(await message.inputValue(), editedMessage, 'Failure discarded the edited Teams draft');

  await send.click();
  await draft.getByTestId('teams-send-status').filter({ hasText: 'Message sent. Teams returned a matching send receipt.' }).waitFor({ state: 'visible' });
  assert.equal(await send.isDisabled(), true, 'Authoritative success did not disable duplicate sending');
  const calls = await session.page.evaluate(() => structuredClone(window.__teamsSendCalls));
  assert.equal(calls.length, 4, 'Teams send did not preserve explicit retry attempts');
  assert.deepEqual(calls[3], { targetDisplayName: 'James Farquharson', message: editedMessage });
  const timeline = session.page.getByTestId('action-timeline-entry');
  await timeline.filter({ hasText: 'Teams send cancelled before dispatch. No request was dispatched.' }).waitFor({ state: 'visible' });
  await timeline.filter({ hasText: 'Teams send could not be confirmed. Check Teams before trying again.' }).waitFor({ state: 'visible' });
  await timeline.filter({ hasText: 'Teams message sent with a matching receipt.' }).waitFor({ state: 'visible' });
  const beforeReload = await timeline.count();
  await openApp(session, { reseed: false });
  await selectFixtureThread(session.page);
  assert.equal(await session.page.getByTestId('action-timeline-entry').count(), beforeReload, 'Reload duplicated Teams action callbacks');
  await assertHealthy(session);
}

async function historySourceNavigationScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('action-queue').getByRole('button', { name: 'Return to source', exact: true }).click();
  await session.page.getByRole('button', { name: 'History', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Source timeline & audit', exact: true }).waitFor({ state: 'visible' });
  await session.page.getByLabel('Context').selectOption(FIXTURE_ITEM_ID);
  const contextual = session.page.getByRole('table', { name: 'Contextual timeline' });
  assert.equal(await contextual.getByText('Action proposal created', { exact: true }).count(), 1, 'Contextual History duplicated the thread/global action event');
  const source = session.page.getByTestId('history-source-link').filter({ hasText: FIXTURE_ITEM_TITLE }).first();
  await source.focus();
  await source.press('Enter');
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: FIXTURE_ITEM_TITLE }).waitFor({ state: 'visible' });
  await assertHealthy(session);
}

async function assertExternalRadarSelection(page, { id, title }, { mobile = false } = {}) {
  const escapedId = String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const row = page.locator(`[data-thread-id="${escapedId}"]`);
  await row.waitFor({ state: mobile ? 'attached' : 'visible' });
  assert.equal(await row.getAttribute('aria-current'), 'true', 'External navigation did not select the matching Radar row');
  assert.equal(await row.evaluate((element) => element.classList.contains('selected')), true, 'External navigation did not highlight the matching Radar row');
  const detailHeading = page.locator('.radar-thread-detail h2');
  await page.waitForFunction((expectedTitle) => document.querySelector('.radar-thread-detail h2')?.textContent?.trim() === expectedTitle, title);
  assert.equal((await detailHeading.textContent()).trim(), title, 'External navigation did not show the matching Radar detail');
  if (mobile) {
    assert.equal(await detailHeading.evaluate((element) => element === document.activeElement), true, 'Mobile external navigation did not focus the detail heading');
    assert.equal(await page.getByTestId('radar-detail-back').isVisible(), true, 'Mobile external navigation did not expose Back');
  } else {
    assert.equal(await row.evaluate((element) => element === document.activeElement), true, 'Desktop external navigation did not focus the matching Radar row');
    const visibility = await row.evaluate((element) => {
      const list = element.closest('.radar-thread-list');
      const rowRect = element.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      return rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom;
    });
    assert.equal(visibility, true, 'Desktop external navigation did not scroll the matching row into the list viewport');
  }
}

async function externalRadarNavigationScenario(session) {
  await openApp(session);

  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  await session.page.evaluate((id) => window.__notificationCallback?.({ taskId: id }), FIXTURE_ITEM_ID);
  await assertExternalRadarSelection(session.page, { id: FIXTURE_ITEM_ID, title: FIXTURE_ITEM_TITLE });

  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  const todayTitle = (await session.page.locator('.next-move h2').textContent()).trim();
  await session.page.locator('.next-move').getByRole('button', { name: 'Open thread', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: todayTitle }).waitFor({ state: 'visible' });
  const todayTarget = await session.page.evaluate(async (title) => (await window.workiq.storeGet('flightdeck.demo.v2'))?.items?.find((item) => item.title === title), todayTitle);
  await assertExternalRadarSelection(session.page, todayTarget);

  await openApp(session, { reseed: false });
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('action-queue').getByRole('button', { name: 'Return to source', exact: true }).click();
  await assertExternalRadarSelection(session.page, { id: FIXTURE_ITEM_ID, title: FIXTURE_ITEM_TITLE });

  await session.page.getByRole('button', { name: 'History', exact: true }).click();
  await session.page.getByLabel('Context').selectOption(FIXTURE_ITEM_ID);
  const historySource = session.page.getByTestId('history-source-link').filter({ hasText: FIXTURE_ITEM_TITLE }).first();
  await historySource.press('Enter');
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await assertExternalRadarSelection(session.page, { id: FIXTURE_ITEM_ID, title: FIXTURE_ITEM_TITLE });
  await assertHealthy(session);
}

async function scannerNotificationNewestFirstScenario(session) {
  await openApp(session);
  const discovered = await session.page.evaluate(async (fixtureItemId) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state.items.find((item) => item.id === fixtureItemId);
    const item = {
      ...source,
      id: 'scanner-toast-newest',
      title: 'Newest scanner notification',
      discoveredAt: '2099-09-03T12:00:00Z',
      trackedAt: null,
      lastRunAt: null,
      lastChangedAt: null,
      updateHistory: [],
      isNew: true,
      hasNewUpdate: false,
    };
    await window.workiq.storeSet('flightdeck.demo.v2', { ...state, items: [...state.items, item] });
    return { id: item.id, title: item.title };
  }, FIXTURE_ITEM_ID);

  await openApp(session, { reseed: false });
  await session.page.evaluate((id) => window.__notificationCallback?.({ taskId: id }), discovered.id);
  await assertExternalRadarSelection(session.page, discovered);
  assert.equal(await session.page.locator('.radar-thread').first().getAttribute('data-thread-id'), discovered.id,
    'New scanner notification did not move to the top of Inbox');
  await assertHealthy(session);
}

async function searchRadarNavigationScenario(session) {
  await openApp(session);
  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  const search = session.page.getByPlaceholder('Search items…');
  await search.fill(FIXTURE_ITEM_TITLE);
  const result = session.page.locator('.search-result-item').filter({ hasText: FIXTURE_ITEM_TITLE }).first();
  await result.waitFor({ state: 'visible' });
  await result.click();
  await assertExternalRadarSelection(session.page, { id: FIXTURE_ITEM_ID, title: FIXTURE_ITEM_TITLE });
  await assertHealthy(session);
}

async function externalRadarNavigationMobileScenario(session) {
  await openApp(session);
  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  const todayTitle = (await session.page.locator('.next-move h2').textContent()).trim();
  await session.page.locator('.next-move').getByRole('button', { name: 'Open thread', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: todayTitle }).waitFor({ state: 'visible' });
  const todayTarget = await session.page.evaluate(async (title) => (await window.workiq.storeGet('flightdeck.demo.v2'))?.items?.find((item) => item.title === title), todayTitle);
  await assertExternalRadarSelection(session.page, todayTarget, { mobile: true });
  await session.page.getByTestId('radar-detail-back').click();
  await session.page.locator('.radar-thread-list-pane.mobile-active').waitFor({ state: 'visible' });
  await session.page.waitForFunction((title) => [...document.querySelectorAll('.radar-thread')]
    .some((element) => element.textContent.includes(title) && element.getAttribute('aria-current') === 'true'), todayTitle);
  await assertHealthy(session, 'mobile');
}

async function coldExternalRadarNavigationScenario(session) {
  await openApp(session);
  const setup = await session.page.evaluate(async (fixtureItemId) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state.items.find((item) => item.id === fixtureItemId);
    const cold = { ...source, lifecycleStatus: 'archived', monitorEnabled: false };
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state,
      items: state.items.filter((item) => item.id !== source.id),
    });
    await window.workiq.setColdItems([cold]);
    return { id: cold.id, title: cold.title };
  }, FIXTURE_ITEM_ID);

  await openApp(session, { reseed: false });
  await session.page.evaluate(() => { window.__coldHydrationPending = true; });
  await session.page.evaluate((id) => window.__notificationCallback?.({ taskId: id }), setup.id);
  await session.page.waitForTimeout(100);
  assert.equal(await session.page.locator(`[data-thread-id="${setup.id}"]`).count(), 0,
    'Cold notification rendered before delayed hydration resolved');

  await session.page.evaluate(() => {
    window.__coldHydrationPending = false;
    window.__resolveColdHydration?.();
  });
  await assertExternalRadarSelection(session.page, setup);
  await assertHealthy(session);
}

async function coldHistoryNavigationScenario(session) {
  await openApp(session);
  const setup = await session.page.evaluate(async (fixtureItemId) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state.items.find((item) => item.id === fixtureItemId);
    const cold = { ...source, lifecycleStatus: 'archived', monitorEnabled: false };
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state,
      items: state.items.filter((item) => item.id !== source.id),
      history: [{
        id: 'cold-history-event',
        at: new Date().toISOString(),
        kind: 'action',
        summary: 'Cold source event',
        payload: { itemId: cold.id, object: cold.title, event: 'succeeded' },
      }, ...(state.history || [])],
    });
    await window.workiq.setColdItems([cold]);
    return { id: cold.id, title: cold.title };
  }, FIXTURE_ITEM_ID);

  await openApp(session, { reseed: false });
  await session.page.getByRole('button', { name: 'History', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Source timeline & audit', exact: true }).waitFor({ state: 'visible' });
  const source = session.page.getByTestId('history-source-link').filter({ hasText: setup.title }).first();
  await source.waitFor({ state: 'visible' });
  await source.press('Enter');
  await assertExternalRadarSelection(session.page, setup);
  await assertHealthy(session);
}

async function coldExternalNavigationFailureScenario(session) {
  await openApp(session);
  const setup = await session.page.evaluate(async (fixtureItemId) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state.items.find((item) => item.id === fixtureItemId);
    const deletedId = 'deleted-cold-notification';
    const deleted = { ...source, id: deletedId, lifecycleStatus: 'archived', monitorEnabled: false };
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state,
      items: state.items.filter((item) => item.id !== fixtureItemId),
      deletedItemIds: [...new Set([...(state.deletedItemIds || []), deletedId])],
    });
    await window.workiq.setColdItems([deleted]);
    return { deletedId, unavailableId: 'unavailable-cold-notification' };
  }, FIXTURE_ITEM_ID);

  await openApp(session, { reseed: false });
  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  await session.page.evaluate((id) => window.__notificationCallback?.({ taskId: id }), setup.deletedId);
  await session.page.waitForTimeout(100);
  assert.equal(await session.page.getByRole('heading', { name: 'Your next move', exact: true }).isVisible(), true,
    'Deleted cold notification changed the active destination');
  assert.equal(await session.page.locator('.radar-thread-detail h2').count(), 0,
    'Deleted cold notification populated a detail pane');

  await session.page.evaluate((id) => window.__notificationCallback?.({ taskId: id }), setup.unavailableId);
  await session.page.waitForTimeout(100);
  assert.equal(await session.page.getByRole('heading', { name: 'Your next move', exact: true }).isVisible(), true,
    'Unavailable cold notification changed the active destination');
  await assertHealthy(session);
}

async function noCommunicationScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('proposal-no-communication').filter({ hasText: /add noise/ }).waitFor({ state: 'visible' });
  assert.equal(await session.page.getByTestId('action-queue').count(), 0);
  assert.equal(await session.page.getByTestId('teams-draft-editor').count(), 0);
  await assertHealthy(session);
}

async function synthesisDedupeScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  await session.page.waitForTimeout(700);
  const firstCount = await session.page.evaluate(async () => (await window.workiq.storeGet('flightdeck.demo.v2'))?.actionProposals?.length || 0);
  await queue.getByRole('button', { name: 'Return to source', exact: true }).click();
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.waitForFunction(() => window.__proposalCalls.length === 2);
  await session.page.getByTestId('action-queue').waitFor({ state: 'visible' });
  await session.page.waitForTimeout(700);
  const secondCount = await session.page.evaluate(async () => (await window.workiq.storeGet('flightdeck.demo.v2'))?.actionProposals?.length || 0);
  assert.equal(secondCount, firstCount, 'Repeated synthesis duplicated the local action queue');
  await assertHealthy(session);
}

async function synthesisRetryScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('proposal-error').filter({ hasText: /timed out/i }).waitFor({ state: 'visible' });
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('action-queue').waitFor({ state: 'visible' });
  assert.equal(await session.page.evaluate(() => window.__proposalCalls.length), 2);
  await assertHealthy(session);
}

async function selectionRegressionScenario(session) {
  for (const testId of ['radar-snooze', 'radar-complete', 'radar-archive']) {
    await openApp(session);
    await selectFixtureThread(session.page);
    if (testId === 'radar-archive') await session.page.getByTestId('radar-more').click();
    await session.page.getByTestId(testId).click();
    await assertNoArbitrarySelection(session.page);
  }
  await assertHealthy(session);
}

async function inboxReadActivationScenario(session) {
  for (const { activation, view } of [
    { activation: 'click', view: 'inbox' },
    { activation: 'Enter', view: 'priority' },
    { activation: 'Space', view: 'monitored' },
  ]) {
    await openApp(session);
    const viewButtons = session.page.locator('.radar-smart-views section').first().locator('[data-testid^="radar-view-"]');
    assert.deepEqual(await viewButtons.evaluateAll((buttons) => buttons.map((button) => button.dataset.testid)), [
      'radar-view-inbox',
      'radar-view-priority',
      'radar-view-monitored',
      'radar-view-snoozed',
      'radar-view-completed',
      'radar-view-archived',
    ]);
    assert.equal(await session.page.getByTestId('radar-view-inbox').getAttribute('aria-pressed'), 'true', 'Inbox was not the default Radar view');
    assert.equal(await session.page.getByTestId('radar-view-unread').count(), 0, 'Unread smart view is still present');
    assert.equal(await session.page.getByTestId('radar-view-all').count(), 0, 'Legacy All active smart view is still present');

    const activeViewButton = session.page.getByTestId(`radar-view-${view}`);
    if (view !== 'inbox') await activeViewButton.click();
    const viewCountBefore = await activeViewButton.locator('strong').textContent();
    const thread = session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
    await thread.waitFor({ state: 'visible' });
    assert.equal(await thread.evaluate((element) => element.classList.contains('unread')), true, `${view} ${activation} fixture was not unread before activation`);

    if (activation === 'click') await thread.click();
    else {
      await thread.focus();
      await thread.press(activation);
    }

    await session.page.waitForFunction((id) => !document.querySelector(`[data-thread-id="${id}"]`)?.classList.contains('unread'), FIXTURE_ITEM_ID);
    await session.page.locator('.radar-thread-detail h2').filter({ hasText: FIXTURE_ITEM_TITLE }).waitFor({ state: 'visible' });
    assert.equal(await thread.isVisible(), true, `${view} ${activation} removed the thread after marking read`);
    assert.equal(await thread.getAttribute('aria-current'), 'true', `${view} ${activation} did not preserve selection`);
    assert.equal(await activeViewButton.locator('strong').textContent(), viewCountBefore, `${view} ${activation} changed the view count after marking read`);
    if (view === 'inbox') {
      await session.page.waitForFunction((id) => {
        const raw = localStorage.getItem('__flightdeck_browser_acceptance__:flightdeck.demo.v2');
        const persisted = raw ? JSON.parse(raw) : null;
        const item = persisted?.items?.find((entry) => entry.id === id);
        return item && item.isNew !== true && item.hasNewUpdate !== true
          && !item.updateHistory?.some((entry) => entry.seen === false);
      }, FIXTURE_ITEM_ID);
      await openApp(session, { reseed: false });
      const persistedThread = session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
      await persistedThread.waitFor({ state: 'visible' });
      assert.equal(await persistedThread.evaluate((element) => element.classList.contains('unread')), false, 'Inbox read state did not persist after reload');
    }
  }
  await assertHealthy(session);
}

async function blockedPriorityScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.locator('.radar-thread-detail label').filter({ hasText: 'Criticality' }).locator('select').selectOption('Elevated');
  await session.page.locator('.radar-thread-detail label').filter({ hasText: 'Work state' }).locator('select').selectOption('blocked');
  await session.page.getByTestId('radar-view-priority').click();
  await session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).waitFor({ state: 'visible' });
  await assertHealthy(session);
}

async function recentFilterEditScenario(session) {
  await openApp(session);
  const fixture = await session.page.evaluate(async (fixtureItemId) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const source = state.items.find((item) => item.id === fixtureItemId);
    const newer = {
      ...source,
      id: 'browser_recent_updated',
      title: 'Browser Recent updated thread',
      scannerId: state.scanners[0].id,
      lastChangedAt: '2099-09-08T11:00:00Z',
      isNew: false,
      hasNewUpdate: true,
      owner: 'Initial owner',
      dueAt: null,
      doneCriteria: 'Initial done criteria',
      monitorPrompt: 'Stored browser prompt must remain unchanged.',
    };
    const older = {
      ...source,
      id: 'browser_recent_older',
      title: 'Browser Recent older thread',
      scannerId: state.scanners[0].id,
      lastChangedAt: '2099-09-08T10:00:00Z',
      isNew: false,
      hasNewUpdate: false,
    };
    await window.workiq.storeSet('flightdeck.demo.v2', { ...state, items: [...state.items, older, newer] });
    return {
      newerId: newer.id,
      olderId: older.id,
      targetScannerId: state.scanners[1].id,
      monitorPrompt: newer.monitorPrompt,
    };
  }, FIXTURE_ITEM_ID);

  await openApp(session, { reseed: false });
  assert.equal(await session.page.locator('#radar-sort').inputValue(), 'recent', 'Recent was not the default sort');
  assert.equal(await session.page.locator('.radar-thread').first().getAttribute('data-thread-id'), fixture.newerId,
    'Recent did not put the newest deterministic fixture first');
  await session.page.getByTestId('inbox-quick-updated').click();
  await session.page.locator(`[data-thread-id="${fixture.newerId}"]`).waitFor({ state: 'visible' });
  assert.equal(await session.page.locator(`[data-thread-id="${fixture.olderId}"]`).count(), 0,
    'UPDATED quick filter retained a non-updated thread');
  await session.page.locator(`[data-thread-id="${fixture.newerId}"]`).click();
  await session.page.getByLabel('Scanner assignment').selectOption(fixture.targetScannerId);
  await session.page.getByLabel('Owner').fill('Browser owner');
  await session.page.getByLabel('Owner').press('Tab');
  await session.page.getByLabel('Due date').fill('2099-09-15T14:30');
  await session.page.getByLabel('Due date').press('Tab');
  await session.page.getByLabel('Done criteria').fill('Browser workflow is persisted.');
  await session.page.getByLabel('Done criteria').press('Tab');
  await session.page.getByTestId('inbox-active-filter').filter({ hasText: /UPDATED/i }).click();
  await session.page.locator(`[data-thread-id="${fixture.olderId}"]`).waitFor({ state: 'visible' });
  await session.page.waitForFunction(({ newerId, targetScannerId, monitorPrompt }) => {
    const raw = localStorage.getItem('__flightdeck_browser_acceptance__:flightdeck.demo.v2');
    const state = raw ? JSON.parse(raw) : null;
    const item = state?.items?.find((entry) => entry.id === newerId);
    return item?.scannerId === targetScannerId
      && item?.owner === 'Browser owner'
      && item?.doneCriteria === 'Browser workflow is persisted.'
      && item?.monitorPrompt === monitorPrompt;
  }, fixture);
  await openApp(session, { reseed: false });
  const persisted = await session.page.evaluate(async (id) => (await window.workiq.storeGet('flightdeck.demo.v2')).items.find((item) => item.id === id), fixture.newerId);
  assert.equal(persisted.owner, 'Browser owner');
  assert.equal(persisted.doneCriteria, 'Browser workflow is persisted.');
  assert.equal(persisted.monitorPrompt, fixture.monitorPrompt, 'Routine edits silently rewrote the stored monitoring prompt');
  await assertHealthy(session);
}

async function mobileScenario(session) {
  await openApp(session);
  await session.page.getByRole('button', { name: 'Threads', exact: true }).click();
  const thread = session.page.locator('.radar-thread').first();
  await thread.waitFor({ state: 'visible' });
  const threadId = await thread.getAttribute('data-thread-id');
  await thread.focus();
  await thread.press('Enter');
  const detail = session.page.locator('.radar-thread-detail.mobile-active');
  await detail.locator('h2').waitFor({ state: 'visible' });
  assert.equal(await detail.locator('h2').evaluate((element) => element === document.activeElement), true, 'Mobile detail heading did not receive focus');
  await session.page.getByTestId('radar-detail-back').click();
  await session.page.locator('.radar-thread-list-pane.mobile-active').waitFor({ state: 'visible' });
  await session.page.waitForFunction((id) => document.activeElement?.getAttribute('data-thread-id') === id, threadId);
  await assertHealthy(session, 'mobile');
}

async function actionHierarchyScenario(session, viewportWidth, captureScreenshot = false) {
  await openApp(session);
  const threadsStep = session.page.getByRole('button', { name: 'Threads', exact: true });
  if (await threadsStep.isVisible()) await threadsStep.click();
  const thread = session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  await thread.waitFor({ state: 'visible' });
  await thread.click();
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: FIXTURE_ITEM_TITLE }).waitFor({ state: 'visible' });

  const toolbar = session.page.locator('.radar-action-toolbar');
  const compose = session.page.getByRole('group', { name: 'Compose a response', exact: true });
  const disposition = session.page.getByRole('group', { name: 'Update thread status', exact: true });
  const email = session.page.getByTestId('radar-draft-email');
  const teams = session.page.getByTestId('radar-draft-teams');
  const complete = session.page.getByTestId('radar-complete');
  const snooze = session.page.getByTestId('radar-snooze');
  const more = session.page.getByTestId('radar-more');
  const archive = session.page.getByTestId('radar-archive');
  const deleteCard = session.page.getByTestId('radar-delete');

  assert.equal(await compose.locator('button').count(), 2, 'Compose actions were not grouped together');
  assert.equal(await disposition.locator('button').count(), 4, 'Disposition actions were not grouped together');
  assert.equal(await compose.getAttribute('aria-busy'), 'false', 'Idle compose group was marked busy');
  assert.deepEqual(await compose.locator('button').allTextContents(), ['Email', 'Teams']);
  assert.deepEqual(await disposition.locator(':scope > button').allTextContents(), ['Complete', 'Snooze']);
  assert.equal(await more.textContent(), 'More');
  assert.equal(await archive.isVisible(), false, 'Archive was visible before opening More actions');
  assert.equal(await deleteCard.isVisible(), false, 'Delete was visible before opening More actions');
  await more.click();
  assert.equal(await archive.isVisible(), true, 'Archive was not disclosed by More actions');
  assert.equal(await deleteCard.isVisible(), true, 'Delete was not disclosed by More actions');
  assert.deepEqual(await session.page.getByRole('menu', { name: 'More item actions' }).locator('button').allTextContents(), ['Archive', 'Delete from FlightDeck…']);
  await more.click();

  const semanticStyles = await session.page.evaluate(() => {
    const describe = (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      const style = getComputedStyle(element);
      return {
        classes: [...element.classList].sort(),
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        color: style.color,
        boxShadow: style.boxShadow,
        fontWeight: style.fontWeight,
      };
    };
    const resolveColorToken = (token) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      email: describe('radar-draft-email'),
      teams: describe('radar-draft-teams'),
      complete: describe('radar-complete'),
      snooze: describe('radar-snooze'),
      archive: describe('radar-archive'),
      deleteCard: describe('radar-delete'),
      tokens: {
        success: resolveColorToken('--color-success'),
      },
    };
  });
  assert.ok(semanticStyles.email.classes.includes('radar-action-button--compose'));
  assert.ok(semanticStyles.teams.classes.includes('radar-action-button--compose'));
  assert.equal(semanticStyles.email.classes.includes('primary'), false, 'Email retained hard-coded primary styling');
  assert.equal(semanticStyles.teams.classes.includes('primary'), false, 'Teams unexpectedly received primary styling');
  assert.deepEqual(
    Object.fromEntries(Object.entries(semanticStyles.email).filter(([key]) => key !== 'classes')),
    Object.fromEntries(Object.entries(semanticStyles.teams).filter(([key]) => key !== 'classes')),
    'Compose actions were not visually neutral and equal without a structured recommendation'
  );
  assert.ok(semanticStyles.complete.classes.includes('radar-action-button--complete'));
  assert.ok(semanticStyles.snooze.classes.includes('radar-action-button--snooze'));
  assert.ok(semanticStyles.archive.classes.includes('radar-more-menu__item'));
  assert.ok(semanticStyles.deleteCard.classes.includes('radar-more-menu__item--delete'));
  assert.equal(semanticStyles.snooze.backgroundColor, semanticStyles.email.backgroundColor, 'Snooze was not neutral');
  assert.equal(semanticStyles.complete.color, semanticStyles.tokens.success, 'Complete did not use the success token');
  assert.notEqual(semanticStyles.complete.backgroundColor, semanticStyles.snooze.backgroundColor, 'Complete and Snooze lacked a non-color semantic distinction');
  assert.equal(semanticStyles.archive.classes.some((className) => className === 'warn' || className === 'primary'), false, 'Archive received high-emphasis styling');

  await email.focus();
  await session.page.keyboard.press('Shift+Tab');
  await session.page.keyboard.press('Tab');
  assert.equal(await email.evaluate((element) => element === document.activeElement), true, 'Keyboard focus did not return to Draft email');
  assert.equal(await email.evaluate((element) => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2), true, 'Draft email lacked visible keyboard focus');
  await session.page.keyboard.press('Tab');
  assert.equal(await teams.evaluate((element) => element === document.activeElement), true, 'Tab did not advance to Draft Teams message');
  assert.equal(await teams.evaluate((element) => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2), true, 'Draft Teams message lacked visible keyboard focus');

  const geometry = await toolbar.evaluate((element) => {
    const rectangle = (target) => target.getBoundingClientRect().toJSON();
    const buttons = [...element.querySelectorAll('button, summary')].filter((button) => {
      const menu = button.closest('details');
      return button.getClientRects().length && (!menu || button.tagName === 'SUMMARY' || menu.open);
    });
    return {
      toolbar: rectangle(element),
      workPanel: rectangle(element.closest('.radar-work-panel')),
      compose: rectangle(element.querySelector('.radar-action-group--compose')),
      disposition: rectangle(element.querySelector('.radar-action-group--disposition')),
      buttons: buttons.map((button) => ({
        testId: button.dataset.testid,
        rect: rectangle(button),
        clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1,
      })),
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  if (captureScreenshot) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, `radar-action-command-bar-${viewportWidth}.png`);
    await session.page.screenshot({ path: screenshotPath, fullPage: true });
    screenshotPaths.push(screenshotPath);
    process.stdout.write(`SCREENSHOT width=${viewportWidth} path=${screenshotPath} bytes=${fs.statSync(screenshotPath).size}\n`);
  }
  assert.equal(geometry.scrollWidth > geometry.documentWidth + 1, false, `Action hierarchy overflowed at ${viewportWidth}px`);
  assert.equal(geometry.buttons.some((button) => button.clipped), false, `Action label clipped at ${viewportWidth}px: ${JSON.stringify(geometry.buttons)}`);
  assert.equal(geometry.buttons.length, 5, `Expected four commands and one More disclosure at ${viewportWidth}px`);
  assert.ok(geometry.toolbar.x >= geometry.workPanel.x - 1
    && geometry.toolbar.x + geometry.toolbar.width <= geometry.workPanel.x + geometry.workPanel.width + 1,
  `Action toolbar escaped the Work plan pane at ${viewportWidth}px`);
  if (viewportWidth > 960) {
    assert.equal(geometry.buttons.every((button) => button.rect.height >= 36), true, `Desktop command was under 36px at ${viewportWidth}px`);
  } else {
    assert.equal(geometry.buttons.every((button) => button.rect.height >= 44), true,
      `Touch target was under 44px at ${viewportWidth}px: ${JSON.stringify(geometry.buttons)}`);
  }

  const widthsBefore = await Promise.all([email.evaluate((element) => element.getBoundingClientRect().width), teams.evaluate((element) => element.getBoundingClientRect().width)]);
  await session.page.evaluate(() => {
    window.workiq.proposeThreadActions = () => new Promise(() => {});
  });
  await email.click();
  await session.page.waitForFunction(() => document.querySelector('[role="group"][aria-label="Compose a response"]')?.getAttribute('aria-busy') === 'true');
  assert.equal(await email.isDisabled(), true, 'Active compose action remained enabled while synthesis was pending');
  assert.equal(await teams.isDisabled(), true, 'Alternate compose action remained enabled while synthesis was pending');
  assert.equal(await email.evaluate((element) => element.classList.contains('is-loading')), true, 'Pending compose action lacked loading state');
  const widthsAfter = await Promise.all([email.evaluate((element) => element.getBoundingClientRect().width), teams.evaluate((element) => element.getBoundingClientRect().width)]);
  assert.equal(widthsAfter.every((width, index) => Math.abs(width - widthsBefore[index]) <= 1), true, `Compose labels shifted widths while loading at ${viewportWidth}px`);
  await assertHealthy(session, viewportWidth > 960 ? 'desktop' : 'mobile');
}

async function cardDeletionScenario(session, viewportWidth) {
  await openApp(session);
  const threadsStep = session.page.getByRole('button', { name: 'Threads', exact: true });
  if (await threadsStep.isVisible()) await threadsStep.click();
  const before = await session.page.locator('.radar-thread').evaluateAll((rows) => rows.map((row) => ({
    id: row.dataset.threadId,
    title: row.querySelector('strong')?.textContent?.trim() || '',
  })));
  const removedIndex = before.findIndex((entry) => entry.id === FIXTURE_ITEM_ID);
  assert.ok(removedIndex >= 0, 'Deletion fixture was not visible in Radar Inbox');
  const replacement = before[removedIndex + 1] || before[removedIndex - 1] || null;
  await session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).click();
  await session.page.getByTestId('radar-more').click();
  const deleteCard = session.page.getByTestId('radar-delete');

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `radar-card-deletion-${viewportWidth}.png`);
  await session.page.screenshot({ path: screenshotPath, fullPage: false });
  screenshotPaths.push(screenshotPath);
  process.stdout.write(`SCREENSHOT width=${viewportWidth} path=${screenshotPath} bytes=${fs.statSync(screenshotPath).size}\n`);

  await deleteCard.click();
  const confirm = session.page.getByTestId('confirm-modal');
  await confirm.getByRole('heading', { name: 'Delete card from FlightDeck?', exact: true }).waitFor({ state: 'visible' });
  await confirm.getByText('This permanently removes the card from FlightDeck.', { exact: false }).waitFor({ state: 'visible' });
  await confirm.getByText('It does not delete the source email, Teams message or chat, meeting, document, or other Microsoft 365 content.', { exact: false }).waitFor({ state: 'visible' });
  await confirm.getByTestId('confirm-cancel').click();
  await session.page.waitForFunction(() => document.activeElement?.dataset?.testid === 'radar-more');
  assert.equal(await session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).count(), 1, 'Cancel removed the card');
  assert.ok((await session.page.evaluate(async () => window.workiq.storeGet('flightdeck.demo.v2'))).items.some((item) => item.id === FIXTURE_ITEM_ID), 'Cancel changed persisted state');

  await session.page.getByTestId('radar-more').click();
  await deleteCard.click();
  await session.page.evaluate((itemId) => { window.__failDeletionForItemId = itemId; }, FIXTURE_ITEM_ID);
  await confirm.getByRole('button', { name: 'Delete card', exact: true }).click();
  await session.page.getByTestId('radar-delete-error').getByText('Could not delete the card. Nothing was removed.', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).count(), 1, 'Persistence failure did not restore the card');
  assert.equal(await session.page.locator('.radar-thread-detail h2').evaluate((element) => element === document.activeElement), true, 'Radar failure did not restore detail focus');

  await session.page.getByTestId('radar-more').click();
  await session.page.getByTestId('radar-delete').click();
  await confirm.getByRole('button', { name: 'Delete card', exact: true }).click();
  await session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).waitFor({ state: 'detached' });
  if (replacement) {
    assert.equal(await session.page.locator(`[data-thread-id="${replacement.id}"]`).getAttribute('aria-current'), 'true', 'Deletion did not select the next or previous visible card');
    await session.page.locator('.radar-thread-detail h2').filter({ hasText: replacement.title }).waitFor({ state: 'visible' });
    if (viewportWidth <= 960) {
      assert.equal(await session.page.getByTestId('radar-detail-back').isVisible(), true, 'Mobile deletion left detail without a Back control');
    }
  } else {
    assert.equal(await session.page.locator('.radar-thread[aria-current="true"]').count(), 0, 'Single-card deletion retained a selection');
    if (viewportWidth <= 960) assert.equal(await session.page.locator('.radar-thread-list-pane.mobile-active').isVisible(), true);
  }

  await session.page.waitForFunction(async (itemId) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return !state?.items?.some((item) => item.id === itemId) && state?.deletedItemIds?.includes(itemId);
  }, FIXTURE_ITEM_ID);
  assert.deepEqual(await session.page.evaluate(() => ({
    draft: window.__draftCalls.length,
    proposal: window.__proposalCalls.length,
    teams: window.__teamsSendCalls.length,
  })), { draft: 0, proposal: 0, teams: 0 }, 'Card deletion invoked an external action path');

  await openApp(session, { reseed: false });
  assert.equal(await session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).count(), 0, 'Deleted card returned after reload');
  await assertHealthy(session, viewportWidth > 960 ? 'desktop' : 'mobile');
}

async function radarInboxRowPresentationScenario(session, viewportWidth) {
  await openApp(session);
  assert.equal(await session.page.getByRole('button', { name: 'Mailbox', exact: true }).count(), 0, 'Mailbox remains a visible navigation destination');
  if (viewportWidth <= 960) {
    await session.page.getByRole('button', { name: 'Threads', exact: true }).click();
  }

  const rows = session.page.locator('.radar-thread.mailbox-thread-row');
  await rows.first().waitFor({ state: 'visible' });
  const rowData = await rows.evaluateAll((entries) => entries.map((row) => ({
    height: row.getBoundingClientRect().height,
    criticality: row.querySelector('.mailbox-severity')?.textContent?.trim() || '',
    workStatus: row.querySelector('.mailbox-status')?.textContent?.trim() || '',
    preview: row.querySelector('.mailbox-row-preview')?.textContent?.trim() || '',
  })));
  assert.ok(rowData.length > 0, 'Radar Inbox did not render any rows');
  assert.equal(rowData.every((row) => row.criticality && row.workStatus), true, 'Every Radar Inbox row must show criticality and work status');
  assert.equal(rowData.every((row) => row.height >= 96 && row.height <= 140), true, `Radar Inbox rows were not bounded at ${viewportWidth}px`);
  assert.equal(rowData.every((row) => row.preview.length > 0), true, 'Radar Inbox row previews were not readable');
  const dimensions = await session.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
  assert.equal(dimensions.scrollWidth <= dimensions.viewportWidth + 1, true, `Radar Inbox overflowed at ${viewportWidth}px`);

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `radar-inbox-rows-${viewportWidth}.png`);
  await session.page.screenshot({ path: screenshotPath, fullPage: false });
  screenshotPaths.push(screenshotPath);
  process.stdout.write(`SCREENSHOT width=${viewportWidth} path=${screenshotPath} bytes=${fs.statSync(screenshotPath).size}\n`);
  await assertHealthy(session, viewportWidth > 960 ? 'desktop' : 'mobile');
}

async function radarIndependentScrollScenario(session, mobile = false) {
  await openApp(session);
  if (mobile) {
    const flow = await session.page.evaluate(() => ({
      bodyOverflow: getComputedStyle(document.body).overflow,
      documentOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    }));
    assert.notEqual(flow.bodyOverflow, 'hidden', 'Mobile Radar inherited desktop viewport containment');
    assert.equal(flow.documentOverflow, true, 'Mobile Radar no longer uses document flow');
    await assertHealthy(session, 'mobile');
    return;
  }

  await selectFixtureThread(session.page);

  const list = session.page.locator('.radar-thread-list');
  const detail = session.page.locator('.radar-thread-detail');
  const before = await session.page.evaluate(() => {
    const inbox = document.querySelector('.radar-thread-list');
    const threadDetail = document.querySelector('.radar-thread-detail');
    const workspace = document.querySelector('.radar-workspace');
    return {
      document: {
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollTop: document.documentElement.scrollTop,
      },
      workspaceBottom: workspace.getBoundingClientRect().bottom,
      list: { clientHeight: inbox.clientHeight, scrollHeight: inbox.scrollHeight, scrollTop: inbox.scrollTop },
      detail: { clientHeight: threadDetail.clientHeight, scrollHeight: threadDetail.scrollHeight, scrollTop: threadDetail.scrollTop },
    };
  });
  assert.ok(before.document.scrollHeight <= before.document.clientHeight + 1, `Desktop Radar expanded the document: ${JSON.stringify(before.document)}`);
  assert.ok(before.workspaceBottom <= before.document.clientHeight + 1, `Radar workspace extended below the viewport: ${before.workspaceBottom}`);
  assert.ok(before.list.scrollHeight > before.list.clientHeight, `Inbox did not provide internal scrolling: ${JSON.stringify(before.list)}`);
  assert.ok(before.detail.scrollHeight > before.detail.clientHeight, `Detail did not provide internal scrolling: ${JSON.stringify(before.detail)}`);

  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const afterList = await session.page.evaluate(() => ({
    document: document.documentElement.scrollTop,
    list: document.querySelector('.radar-thread-list').scrollTop,
    detail: document.querySelector('.radar-thread-detail').scrollTop,
  }));
  assert.ok(afterList.list > 0, 'Inbox did not scroll internally');
  assert.equal(afterList.document, before.document.scrollTop, 'Inbox scrolling moved the document');
  assert.equal(afterList.detail, before.detail.scrollTop, 'Inbox scrolling moved the detail pane');

  await detail.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const afterDetail = await session.page.evaluate(() => ({
    document: document.documentElement.scrollTop,
    list: document.querySelector('.radar-thread-list').scrollTop,
    detail: document.querySelector('.radar-thread-detail').scrollTop,
  }));
  assert.ok(afterDetail.detail > 0, 'Detail did not scroll internally');
  assert.equal(afterDetail.document, before.document.scrollTop, 'Detail scrolling moved the document');
  assert.equal(afterDetail.list, afterList.list, 'Detail scrolling moved the Inbox');
  await assertHealthy(session, 'desktop');
}

async function radarRichContextScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);

  const reason = session.page.getByTestId('radar-context-reason');
  const done = session.page.getByTestId('radar-context-done');
  const people = session.page.getByTestId('radar-context-people');
  const sources = session.page.getByTestId('radar-context-sources');
  assert.equal(await session.page.getByTestId('radar-context-summary').count(), 0, 'Context repeated the Activity summary');
  await reason.getByText('Contract deadline in 8 days', { exact: false }).waitFor({ state: 'visible' });
  await done.getByText('Completion criteria have not been defined yet.', { exact: true }).waitFor({ state: 'visible' });

  const doneCriteria = 'Legal approves the indemnity language and both parties sign the renewal agreement.';
  const recommendedMoves = [
    'Schedule a call with Priya Sharma to negotiate the renewal rate.',
    'Ask James Okonkwo to resolve the indemnity clause.',
  ];
  await session.page.evaluate(async ({ itemId, criteria, moves }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state,
      items: state.items.map((item) => item.id === itemId
        ? { ...item, doneCriteria: criteria, suggestedNextSteps: moves }
        : item),
    });
  }, { itemId: FIXTURE_ITEM_ID, criteria: doneCriteria, moves: recommendedMoves });
  await openApp(session, { reseed: false });
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-context-done').getByText(doneCriteria, { exact: true }).waitFor({ state: 'visible' });

  const recommendations = session.page.getByTestId('scanner-recommendations');
  await session.page.getByRole('heading', { name: 'Work plan', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await session.page.getByRole('heading', { name: 'Context', exact: true }).count(), 0,
    'The combined Work plan pane retained the old Context heading');
  assert.deepEqual(await recommendations.locator('li').allTextContents(), recommendedMoves,
    'Radar Work plan did not preserve both scanner recommendations');
  assert.equal(await recommendations.locator('xpath=ancestor::*[contains(@class, "radar-detail-columns")]').count(), 1,
    'Scanner recommendations were not moved into the Work plan column');
  assert.equal(await session.page.locator('.radar-work-panel .radar-action-toolbar').count(), 1,
    'Respond and Manage controls were not moved into the Work plan pane');
  const columnTops = await session.page.evaluate(() => ({
    activity: document.querySelector('.radar-activity-panel')?.getBoundingClientRect().top,
    context: document.querySelector('[data-testid="scanner-recommendations"]')?.getBoundingClientRect().top,
  }));
  assert.ok(columnTops.activity <= columnTops.context, `Activity did not begin at the top of the detail columns: ${JSON.stringify(columnTops)}`);
  const activityEvents = session.page.locator('.radar-activity-panel .at-event');
  assert.ok(await activityEvents.count() >= 3, 'Activity omitted the selected thread history');
  await activityEvents.first().waitFor({ state: 'visible' });

  for (const person of ['Priya Sharma', 'James Okonkwo', 'Lucia Ferreira']) {
    assert.equal(await people.getByText(person, { exact: true }).count(), 1, `Radar context omitted ${person}`);
  }

  const sourceLinks = sources.locator('a');
  assert.equal(await sourceLinks.count(), 4, 'Radar context did not render every validated source link');
  assert.deepEqual(await sources.locator('.radar-source-type').allTextContents(), ['Email', 'Document', 'Teams', 'Meeting']);
  const meeting = sourceLinks.filter({ hasText: 'Procurement meeting — Apr 14 recording' });
  const expectedUrl = 'https://demo.flightdeck.app/meeting/acme-procurement-apr14';
  assert.equal(await meeting.getAttribute('href'), expectedUrl, 'Radar source link did not preserve its exact URL');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, 'radar-rich-context-1440.png');
  await session.page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
  screenshotPaths.push(screenshotPath);
  process.stdout.write(`SCREENSHOT view=radar-rich-context viewport=1440x1000 path=${screenshotPath} bytes=${fs.statSync(screenshotPath).size}\n`);
  await meeting.click();
  assert.deepEqual(await session.page.evaluate(() => window.__openExternalCalls), [expectedUrl], 'Radar source link bypassed the external-open bridge');
  await assertHealthy(session, 'desktop');
}

(async () => {
  let rendererServer;
  let browser;
  try {
    const executablePath = findEdge();
    rendererServer = await startRendererServer();
    browser = await chromium.launch({ executablePath, headless: true });
    process.stdout.write(`EDGE_EXECUTABLE=${executablePath}\nLOCAL_RENDERER=${rendererServer.baseUrl}\n`);
    await runScenario('theme-continuity-and-switching', browser, rendererServer.baseUrl, themeScenario);
    await runScenario('scanner-create-and-persist', browser, rendererServer.baseUrl, scannerScenario);
    await runScenario('add-item-submit-persist-reload', browser, rendererServer.baseUrl, addItemPersistScenario);
    await runScenario('scanner-delete-keep-and-reassign', browser, rendererServer.baseUrl, scannerDeletionReassignScenario);
    await runScenario('scanner-delete-all', browser, rendererServer.baseUrl, scannerDeletionDeleteAllScenario);
    await runScenario('scanner-delete-unhydrated-archive', browser, rendererServer.baseUrl, scannerDeletionUnhydratedArchiveScenario);
    await runScenario('criticality-edit-and-persist', browser, rendererServer.baseUrl, criticalityScenario);
    await runScenario('completed-view-and-active-restore', browser, rendererServer.baseUrl, completedRestoreScenario);
    await runScenario('action-draft-cancel', browser, rendererServer.baseUrl, (session) => draftScenario(session, 'cancel'), { draftMode: 'cancel' });
    await runScenario('action-draft-error-fail-closed', browser, rendererServer.baseUrl, (session) => draftScenario(session, 'error'), { draftMode: 'error' });
    await runScenario('action-draft-success-and-persistence', browser, rendererServer.baseUrl, (session) => draftScenario(session, 'success'), { draftMode: 'success' });
    await runScenario('action-queue-management-and-persistence', browser, rendererServer.baseUrl, actionQueueManagementScenario);
    await runScenario('action-queue-state-eligibility', browser, rendererServer.baseUrl, actionQueueEligibilityScenario);
    await runScenario('action-queue-executing-lockout', browser, rendererServer.baseUrl, actionQueueExecutingLockoutScenario, { draftMode: 'pending' });
    await runScenario('action-queue-delete-one-duplicate', browser, rendererServer.baseUrl, actionQueueDeleteOneDuplicateScenario);
    await runScenario('action-queue-delete-duplicate-group', browser, rendererServer.baseUrl, actionQueueDeleteDuplicateGroupScenario);
    await runScenario('action-queue-delete-no-effect-rollback', browser, rendererServer.baseUrl, actionQueueDeleteNoEffectRollbackScenario);
    await runScenario('action-queue-delete-confirmed-evidence', browser, rendererServer.baseUrl, actionQueueDeleteConfirmedScenario, { draftMode: 'success' });
    await runScenario('action-queue-delete-late-result', browser, rendererServer.baseUrl, actionQueueDeleteLateResultScenario, { draftMode: 'deferred' });
    for (const width of [1440, 760, 360]) {
      await runScenario(`action-queue-delete-responsive-${width}`, browser, rendererServer.baseUrl,
        (session) => actionQueueDeleteResponsiveScenario(session, width, true),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    for (const width of [1440, 760, 360]) {
      await runScenario(`action-queue-reliability-${width}`, browser, rendererServer.baseUrl,
        (session) => actionQueueReliabilityScenario(session, width),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    await runScenario('action-queue-source-focus-restoration', browser, rendererServer.baseUrl, actionQueueSourceFocusScenario);
    await runScenario('proposal-missing-address-edit-state', browser, rendererServer.baseUrl, missingAddressScenario, { proposalMode: 'missing-address' });
    await runScenario('proposal-teams-review-only', browser, rendererServer.baseUrl, teamsReviewScenario, { proposalMode: 'teams' });
    await runScenario('teams-send-cancel-error-success', browser, rendererServer.baseUrl, teamsSendScenario, { proposalMode: 'teams', teamsSendMode: 'sequence' });
    await runScenario('history-source-navigation-and-dedupe', browser, rendererServer.baseUrl, historySourceNavigationScenario);
    await runScenario('external-radar-navigation-sources', browser, rendererServer.baseUrl, externalRadarNavigationScenario);
    await runScenario('scanner-notification-newest-first', browser, rendererServer.baseUrl, scannerNotificationNewestFirstScenario);
    await runScenario('external-radar-navigation-search', browser, rendererServer.baseUrl, searchRadarNavigationScenario);
    await runScenario('external-radar-navigation-mobile', browser, rendererServer.baseUrl, externalRadarNavigationMobileScenario, { viewport: { width: 760, height: 900 } });
    await runScenario('external-radar-navigation-mobile-360', browser, rendererServer.baseUrl, externalRadarNavigationMobileScenario, { viewport: { width: 360, height: 900 } });
    await runScenario('external-radar-navigation-cold-notification', browser, rendererServer.baseUrl, coldExternalRadarNavigationScenario);
    await runScenario('external-radar-navigation-cold-history', browser, rendererServer.baseUrl, coldHistoryNavigationScenario);
    await runScenario('external-radar-navigation-cold-failure-safe', browser, rendererServer.baseUrl, coldExternalNavigationFailureScenario);
    await runScenario('proposal-no-communication', browser, rendererServer.baseUrl, noCommunicationScenario, { proposalMode: 'none' });
    await runScenario('proposal-dedupe', browser, rendererServer.baseUrl, synthesisDedupeScenario);
    await runScenario('proposal-retry', browser, rendererServer.baseUrl, synthesisRetryScenario, { proposalMode: 'retry' });
    await runScenario('snooze-complete-archive-no-reselection', browser, rendererServer.baseUrl, selectionRegressionScenario);
    await runScenario('inbox-explicit-activation-marks-read', browser, rendererServer.baseUrl, inboxReadActivationScenario);
    await runScenario('blocked-elevated-item-remains-priority', browser, rendererServer.baseUrl, blockedPriorityScenario);
    await runScenario('inbox-recent-filter-edit-workflow', browser, rendererServer.baseUrl, recentFilterEditScenario);
    await runScenario('mobile-list-detail-back-focus', browser, rendererServer.baseUrl, mobileScenario, { viewport: { width: 760, height: 900 } });
    await runScenario('action-queue-and-timeline-desktop-capture', browser, rendererServer.baseUrl,
      (session) => actionQueueScreenshotScenario(session, 'desktop'),
      { viewport: { width: 1440, height: 1000 } });
    await runScenario('action-queue-and-timeline-mobile-capture', browser, rendererServer.baseUrl,
      (session) => actionQueueScreenshotScenario(session, 'mobile'),
      { viewport: { width: 760, height: 900 } });
    for (const width of [1440, 760, 480, 360]) {
      await runScenario(`recommended-action-hierarchy-${width}`, browser, rendererServer.baseUrl,
        (session) => actionHierarchyScenario(session, width, width === 1440 || width === 360),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    for (const width of [1440, 760, 360]) {
      await runScenario(`card-deletion-local-${width}`, browser, rendererServer.baseUrl,
        (session) => cardDeletionScenario(session, width),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    for (const width of [1440, 760, 360]) {
      await runScenario(`radar-inbox-row-presentation-${width}`, browser, rendererServer.baseUrl,
        (session) => radarInboxRowPresentationScenario(session, width),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    await runScenario('radar-independent-scroll-desktop', browser, rendererServer.baseUrl,
      (session) => radarIndependentScrollScenario(session),
      { viewport: { width: 1440, height: 600 } });
    await runScenario('radar-document-flow-mobile', browser, rendererServer.baseUrl,
      (session) => radarIndependentScrollScenario(session, true),
      { viewport: { width: 360, height: 700 } });
    await runScenario('radar-rich-context-and-source-links', browser, rendererServer.baseUrl,
      radarRichContextScenario,
      { viewport: { width: 1440, height: 1000 } });
    process.stdout.write(`SCENARIO_TOTAL=${results.length} PASS=${results.filter((result) => result.passed).length} FAIL=${results.filter((result) => !result.passed).length}\n`);
    process.stdout.write(`METRICS unexpectedExternalRequests=${totals.unexpectedExternalRequests} pageErrors=${totals.pageErrors} consoleErrors=${totals.consoleErrors} desktopOverflowFailures=${totals.desktopOverflowFailures} mobileOverflowFailures=${totals.mobileOverflowFailures} desktopOverlapFailures=${totals.desktopOverlapFailures} mobileOverlapFailures=${totals.mobileOverlapFailures}\n`);
    process.stdout.write(`SCREENSHOT_TOTAL=${screenshotPaths.length}\n`);
    process.stdout.write('ALL_RADAR_BROWSER_SCENARIOS_PASS\n');
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.stdout.write(`SCENARIO_TOTAL=${results.length} PASS=${results.filter((result) => result.passed).length} FAIL=${results.filter((result) => !result.passed).length}\n`);
    process.stdout.write(`METRICS unexpectedExternalRequests=${totals.unexpectedExternalRequests} pageErrors=${totals.pageErrors} consoleErrors=${totals.consoleErrors} desktopOverflowFailures=${totals.desktopOverflowFailures} mobileOverflowFailures=${totals.mobileOverflowFailures} desktopOverlapFailures=${totals.desktopOverlapFailures} mobileOverlapFailures=${totals.mobileOverlapFailures}\n`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (rendererServer) await rendererServer.close();
  }
})();
