const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
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
const SCREENSHOT_DIR = path.join(ROOT, 'test-results', 'radar-acceptance');
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

async function installLocalBridge(context, draftMode, proposalMode, teamsSendMode, queueStatus, briefingMode) {
  await context.addInitScript(({ mode, synthesisMode, sendMode, itemTitle, initialQueueStatus, briefingMode }) => {
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
      acceptEula: async () => ({ success: true }),
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
        if (synthesisMode === 'teams' || synthesisMode === 'teams-missing-recipient') {
          base.proposals = [{
            channel: 'teams',
            intent: 'Confirm an owner',
            target: {
              displayName: synthesisMode === 'teams-missing-recipient' ? '' : 'James Farquharson',
              address: synthesisMode === 'teams-missing-recipient' ? '' : 'james@example.com',
              channelId: '', threadId: '',
            },
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
          const missingRecipient = synthesisMode === 'missing-recipient';
          const missingAddress = missingRecipient || synthesisMode === 'missing-address';
          base.proposals = [{
            channel: 'email',
            intent: 'Confirm the deployment window',
            target: {
              displayName: missingRecipient ? '' : 'Sofia Martinez',
              address: missingAddress ? '' : 'sofia@example.com',
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
            needsTargetResolution: missingAddress,
            missingContext: missingAddress ? ['Verified recipient email address'] : [],
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
    if (briefingMode) {
      window.__briefingCalls = [];
      window.__briefingFail = briefingMode === 'fail';
      window.workiq.readPromptFile = async (name) => ({ success: true, content: name });
      window.workiq.ask = async (prompt) => {
        const label = prompt.startsWith('List all my meetings') ? 'calendar'
          : prompt.startsWith('day-briefing.md') ? 'day' : 'meeting';
        window.__briefingCalls.push(label);
        const today = new Date();
        const at = (offset, hour) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, hour).toISOString();
        if (label === 'day' && window.__briefingFail) {
          return { success: false, error: 'Simulated day briefing failure' };
        }
        const payload = label === 'calendar' ? { meetings: [
          { id: 'briefing-earlier', title: 'Earlier customer sync', startAt: at(0, 9), endAt: at(0, 10) },
          { id: 'briefing-ongoing', title: 'Ongoing customer review', startAt: at(0, 12), endAt: at(0, 14) },
          { id: 'briefing-later', title: 'Upcoming planning', startAt: at(0, 15), endAt: at(0, 16) },
          { id: 'briefing-tomorrow', title: 'Tomorrow meeting', startAt: at(1, 9) },
        ] } : { headline: label === 'day' ? 'Your automatically generated day' : 'Earlier meeting briefing' };
        return { success: true, answer: JSON.stringify(payload) };
      };
    }
    if (initialQueueStatus) {
      let snapshot = structuredClone(initialQueueStatus);
      const listeners = new Set();
      window.__queueStatusReads = 0;
      window.__queueStatusListenerCount = () => listeners.size;
      window.__emitQueueStatus = (next) => {
        snapshot = structuredClone(next);
        for (const listener of listeners) listener(structuredClone(snapshot));
      };
      window.workiq.getWorkiqQueueStatus = async () => {
        window.__queueStatusReads++;
        return structuredClone(snapshot);
      };
      window.workiq.onWorkiqQueueStatus = (callback) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      };
    }
  }, { mode: draftMode, synthesisMode: proposalMode, sendMode: teamsSendMode, itemTitle: FIXTURE_ITEM_TITLE, initialQueueStatus: queueStatus, briefingMode });
}

async function createSession(browser, baseUrl, { draftMode = 'success', proposalMode = 'email', teamsSendMode = 'success', queueStatus = null, briefingMode = null, viewport = { width: 1440, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await installLocalBridge(context, draftMode, proposalMode, teamsSendMode, queueStatus, briefingMode);
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

async function selectRadarView(page, view) {
  const button = page.getByTestId(`radar-view-${view}`);
  if (!await button.isVisible()) {
    const threadsStep = page.getByRole('button', { name: 'Threads', exact: true });
    if (await threadsStep.isVisible()) await threadsStep.click();
    if (!await button.isVisible()) await page.getByTestId('radar-more-views').click();
  }
  await button.click();
}

async function selectFixtureThread(page, view = 'inbox') {
  await selectRadarView(page, view);
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
    const visiblePaneRects = [...document.querySelectorAll('.radar-thread-list-pane, .radar-thread-detail')]
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
  if (SCENARIO_FILTER && !SCENARIO_FILTER.split(',').map((entry) => entry.trim()).includes(name)) return;
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

async function workiqQueueStatusScenario(session) {
  await openApp(session);
  const { page } = session;
  const pill = page.locator('.topbar .status-pill');
  assert.equal(await pill.textContent(), '4 running / 12 queued');
  assert.equal(await page.evaluate(() => window.__queueStatusReads), 1);
  assert.equal(await page.evaluate(() => window.__queueStatusListenerCount()), 1);
  await assertHealthy(session, 'desktop');

  await page.evaluate(() => window.__emitQueueStatus({
    active: 2, pending: 7, limit: 5, backgroundLimit: 4, cooldownUntil: 0,
  }));
  assert.equal(await pill.textContent(), '2 running / 7 queued');

  await page.clock.install({ time: new Date('2026-10-28T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T12:00:01Z'));
  await page.evaluate(() => window.__emitQueueStatus({
    active: 4, pending: 12, limit: 5, backgroundLimit: 4, cooldownUntil: Date.now() + 3000,
  }));
  assert.equal(await pill.textContent(), '4 running / 12 queued · retry in 3s');
  await assertHealthy(session, 'desktop');
  await page.setViewportSize({ width: 360, height: 900 });
  await assertHealthy(session, 'mobile');
  const bounds = await pill.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, `Queue status escaped mobile viewport: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, `Queue status text overflowed: ${JSON.stringify(bounds)}`);

  await page.clock.runFor(1000);
  assert.equal(await pill.textContent(), '4 running / 12 queued · retry in 2s');
  await page.clock.runFor(2000);
  assert.equal(await pill.textContent(), '4 running / 12 queued');
  await page.evaluate(() => window.__emitQueueStatus({
    active: 0, pending: 0, limit: 5, backgroundLimit: 4, cooldownUntil: 0,
  }));
  assert.match(await pill.textContent(), /^(Connected|Ready)$/);
  assert.equal(await pill.evaluate((element) => element.classList.contains('loading')), false);
  const idleLabel = await pill.textContent();
  await page.clock.runFor(3000);
  assert.equal(await pill.textContent(), idleLabel, 'A stale cooldown timer restored busy status');
  await assertHealthy(session, 'mobile');
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
    await selectRadarView(session.page, 'archived');
    await session.page.locator(`[data-thread-id="${fixture.coldItemId}"]`).waitFor({ state: 'visible' });
  }
  await session.page.locator('#radar-scanner').selectOption(fixture.scannerId);
  await session.page.getByTestId('radar-scanner-tools').click();
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

async function openThreadContext(page, id = FIXTURE_ITEM_ID, action = null) {
  const row = page.locator(`[data-thread-id="${id}"]`);
  await row.click({ button: 'right' });
  const menu = page.getByTestId('thread-context-menu');
  await expect(menu).toBeVisible();
  if (action) await menu.getByRole('menuitem', { name: action, exact: true }).click();
  return menu;
}

async function contextMenuAppearanceScenario(session) {
  const { page } = session;
  await openApp(session);
  const backgrounds = [];
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((element, nextTheme) => element.setAttribute('data-theme', nextTheme), theme);
    const menu = await openThreadContext(page);
    const dimensions = await menu.boundingBox();
    assert.ok(dimensions.width <= 232, `Context menu was too wide in ${theme}: ${dimensions.width}px`);
    assert.ok(dimensions.height <= 300, `Context menu was too tall in ${theme}: ${dimensions.height}px`);
    const targets = await menu.getByRole('menuitem').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    assert.ok(targets.every((height) => height >= 28), `Context menu targets were too small in ${theme}: ${targets}`);
    await menu.getByRole('menuitem', { name: 'Change work status', exact: true }).hover();
    const submenu = menu.getByRole('menu', { name: `Change work status: ${FIXTURE_ITEM_TITLE}`, exact: true });
    await expect(submenu).toBeVisible();
    for (const panel of [menu, submenu]) {
      const surface = await panel.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, opacity: Number(style.opacity), width: element.getBoundingClientRect().width };
      });
      const alpha = surface.background.match(/[\d.]+/g)?.map(Number)?.[3] ?? 1;
      assert.equal(alpha, 1, `Context menu was translucent in ${theme}: ${surface.background}`);
      assert.equal(surface.opacity, 1, `Context menu reduced opacity in ${theme}`);
      assert.ok(surface.width <= 232, `Context submenu was too wide in ${theme}: ${surface.width}px`);
      backgrounds.push(surface.background);
    }
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, `context-menu-${theme}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    screenshotPaths.push(screenshotPath);
    process.stdout.write(`SCREENSHOT view=context-menu theme=${theme} width=${dimensions.width} height=${dimensions.height} path=${screenshotPath}\n`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  assert.equal(backgrounds[0], backgrounds[1], 'Dark context menu and submenu backgrounds differ');
  assert.equal(backgrounds[2], backgrounds[3], 'Light context menu and submenu backgrounds differ');
  assert.notEqual(backgrounds[0], backgrounds[2], 'Context menu did not adapt to the selected theme');
  await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));
  await assertHealthy(session);
}

async function contextMenuInteractionScenario(session) {
  const { page } = session;
  await openApp(session);
  const other = page.locator('.radar-thread').filter({ hasNotText: FIXTURE_ITEM_TITLE }).first();
  await other.click();
  const selectedId = await other.getAttribute('data-thread-id');
  const row = page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  const before = await row.getAttribute('class');
  let menu = await openThreadContext(page);
  await expect(menu).toContainText(FIXTURE_ITEM_TITLE);
  assert.equal(await row.getAttribute('class'), before);
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveAttribute('data-thread-id', selectedId);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();
  await row.press('Shift+F10');
  menu = page.getByTestId('thread-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Open thread', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Delete from FlightDeck…', exact: true })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Open thread', exact: true }).dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await expect(menu.getByRole('menuitem', { name: 'Delete from FlightDeck…', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(menu.getByRole('menu', { name: `Change work status: ${FIXTURE_ITEM_TITLE}`, exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(menu.getByRole('menuitem', { name: 'Change work status', exact: true })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Change work status', exact: true }).hover();
  let submenu = menu.getByRole('menu', { name: `Change work status: ${FIXTURE_ITEM_TITLE}`, exact: true });
  await expect(submenu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Change work status', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await submenu.getByRole('menuitem', { name: 'Waiting', exact: true }).hover();
  await expect(submenu).toBeVisible();
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveAttribute('data-thread-id', selectedId);
  assert.equal(await row.getAttribute('class'), before);
  await menu.getByRole('menuitem', { name: 'Change criticality', exact: true }).hover();
  submenu = menu.getByRole('menu', { name: `Change criticality: ${FIXTURE_ITEM_TITLE}`, exact: true });
  await expect(submenu).toBeVisible();
  await expect(menu.getByRole('menu', { name: `Change work status: ${FIXTURE_ITEM_TITLE}`, exact: true })).toHaveCount(0);
  await submenu.getByRole('menuitem', { name: 'Elevated', exact: true }).hover();
  await expect(submenu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Open thread', exact: true }).hover();
  await expect(submenu).toHaveCount(0);
  await page.keyboard.press('Escape');
  await row.press('ContextMenu');
  await expect(menu).toBeVisible();
  await page.getByLabel('Search Radar').click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByLabel('Search Radar')).toBeFocused();
  await openThreadContext(page);
  await other.click({ button: 'right' });
  await expect(menu).toContainText(await other.locator('strong').textContent());
  await page.getByTestId('radar-view-priority').click();
  await expect(menu).toHaveCount(0);
  await page.getByTestId('radar-view-inbox').click();
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const threads = page.getByRole('button', { name: 'Threads', exact: true });
    if (await threads.isVisible()) await threads.click();
    await row.evaluate((node, { x, y }) => node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
    })), { x: width - 1, y: 899 });
    await expect(menu).toBeVisible();
    await expect.poll(async () => {
      const box = await menu.boundingBox();
      return box.x >= 8 && box.y >= 8
        && Math.abs(box.x + box.width - (width - 8)) <= 1
        && Math.abs(box.y + box.height - 892) <= 1;
    }).toBe(true);
    const status = menu.getByRole('menuitem', { name: 'Change work status', exact: true });
    await status.hover();
    if (width > 960) {
      submenu = menu.getByRole('menu', { name: `Change work status: ${FIXTURE_ITEM_TITLE}`, exact: true });
      await expect(submenu).toBeVisible();
      await expect.poll(async () => {
        const box = await submenu.boundingBox();
        const parentBox = await menu.boundingBox();
        return {
          horizontalOverflow: Math.max(8 - box.x, box.x + box.width - width + 8, 0),
          verticalOverflow: Math.max(8 - box.y, box.y + box.height - 892, 0),
          opensToLeft: box.x < parentBox.x,
        };
      }).toEqual({ horizontalOverflow: 0, verticalOverflow: 0, opensToLeft: true });
      await submenu.getByRole('menuitem', { name: 'Waiting', exact: true }).hover();
      await expect(submenu).toBeVisible();
    } else {
      await expect(status).toHaveAttribute('aria-expanded', 'false');
      await status.click();
      await expect(menu).toHaveAttribute('aria-label', `Change work status: ${FIXTURE_ITEM_TITLE}`);
      await expect(menu.getByRole('menuitem', { name: 'Waiting', exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await row.press('Shift+F10');
    await page.locator('.radar-thread-detail').dispatchEvent('scroll');
    await expect(menu).toHaveCount(0);
    await row.press('Shift+F10');
    await page.setViewportSize({ width: width - 1, height: 900 });
    await expect(menu).toHaveCount(0);
  }
  await assertHealthy(session, 'mobile');
}

async function contextMenuPersistenceScenario(session) {
  const { page } = session;
  await openApp(session);
  const other = page.locator('.radar-thread').filter({ hasNotText: FIXTURE_ITEM_TITLE }).first();
  await other.click();
  const otherId = await other.getAttribute('data-thread-id');
  const row = page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  let menu = await openThreadContext(page);
  if (await menu.getByRole('menuitem', { name: 'Mark read', exact: true }).count()) {
    await menu.getByRole('menuitem', { name: 'Mark read', exact: true }).click();
    await expect(row).not.toHaveClass(/unread/);
    menu = await openThreadContext(page);
  }
  await menu.getByRole('menuitem', { name: 'Mark unread', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveClass(/unread/);
  await expect(other).toHaveAttribute('aria-current', 'true');
  menu = await openThreadContext(page, FIXTURE_ITEM_ID, 'Change work status');
  await menu.getByRole('menuitem', { name: 'Waiting', exact: true }).click();
  menu = await openThreadContext(page, FIXTURE_ITEM_ID, 'Change criticality');
  await menu.getByRole('menuitem', { name: 'Elevated', exact: true }).click();
  await expect(row).toContainText('Elevated');
  await page.waitForFunction(async ({ id, otherId }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const item = state.items.find((item) => item.id === id);
    return item.lifecycleStatus === 'waiting' && item.severity === 'Elevated'
      && item.hasNewUpdate && state.items.some((item) => item.id === otherId);
  }, { id: FIXTURE_ITEM_ID, otherId });
  await openApp(session, { reseed: false });
  await expect(row).toHaveClass(/unread/);
  await expect(row).toContainText('Waiting');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Snooze for 24 hours');
  await expect(row).toHaveCount(0);
  await selectRadarView(page, 'snoozed');
  await expect(row).toBeVisible();
  await openApp(session, { reseed: false });
  await selectRadarView(page, 'snoozed');
  await expect(row).toBeVisible();
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Unsnooze');
  await expect(row).toHaveCount(0);
  await page.getByTestId('radar-view-inbox').click();
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Archive');
  await expect(row).toHaveCount(0);
  await openApp(session, { reseed: false });
  await selectRadarView(page, 'archived');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Restore to In Progress');
  await expect(row).toHaveCount(0);
  await page.getByTestId('radar-view-inbox').click();
  await expect(row).toContainText('In Progress');
  await openApp(session, { reseed: false });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/unread/);
  for (const view of ['priority', 'monitored', 'completed']) {
    // Seed only local bridge fixtures so every shared list projection is exercised.
    await page.evaluate(async ({ id, view }) => {
      const state = await window.workiq.storeGet('flightdeck.demo.v2');
      const item = state.items.find((item) => item.id === id);
      item.lifecycleStatus = view === 'completed' ? 'complete' : 'in-progress';
      item.monitorEnabled = true;
      item.severity = 'Critical';
      await window.workiq.storeSet('flightdeck.demo.v2', state);
    }, { id: FIXTURE_ITEM_ID, view });
    await openApp(session, { reseed: false });
    await selectRadarView(page, view);
    menu = await openThreadContext(page);
    await expect(menu).toContainText(FIXTURE_ITEM_TITLE);
    if (view === 'completed') await expect(menu.getByRole('menuitem', { name: 'Draft email', exact: false })).toBeDisabled();
    await page.keyboard.press('Escape');
  }
  await assertHealthy(session);
}

async function contextMenuDeleteScenario(session) {
  const { page } = session;
  await openApp(session);
  const other = page.locator('.radar-thread').filter({ hasNotText: FIXTURE_ITEM_TITLE }).first();
  await other.click();
  const otherId = await other.getAttribute('data-thread-id');
  const row = page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  const confirm = page.getByTestId('confirm-modal');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Delete from FlightDeck…');
  await expect(confirm).toContainText(FIXTURE_ITEM_TITLE);
  await confirm.getByTestId('confirm-cancel').click();
  await expect(row).toBeFocused();
  await expect(other).toHaveAttribute('aria-current', 'true');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Delete from FlightDeck…');
  await page.evaluate((id) => { window.__failDeletionForItemId = id; }, FIXTURE_ITEM_ID);
  await confirm.getByTestId('confirm-submit').click();
  await expect(page.getByTestId('radar-delete-error')).toContainText('Nothing was removed.');
  await expect(row).toBeVisible();
  await expect(other).toHaveAttribute('aria-current', 'true');
  await expect(row).toBeFocused();
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Delete from FlightDeck…');
  await confirm.getByTestId('confirm-submit').click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveAttribute('data-thread-id', otherId);
  await openApp(session, { reseed: false });
  await expect(row).toHaveCount(0);
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveCount(0);
  await openThreadContext(page, otherId, 'Delete from FlightDeck…');
  await confirm.getByTestId('confirm-cancel').click();
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveCount(0);
  await openThreadContext(page, otherId, 'Delete from FlightDeck…');
  await confirm.getByTestId('confirm-submit').click();
  await expect(page.locator(`[data-thread-id="${otherId}"]`)).toHaveCount(0);
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0]);
  await assertHealthy(session);
}

async function contextMenuDraftScenario(session) {
  const { page } = session;
  const moves = await prepareWorkPlanFixture(session);
  await page.getByTestId('radar-next-move-1').check();
  const other = page.locator('.radar-thread').filter({ hasNotText: FIXTURE_ITEM_TITLE }).first();
  const otherId = await other.getAttribute('data-thread-id');
  await other.click();
  await page.evaluate(() => {
    window.__pendingProposals = {};
    window.workiq.proposeThreadActions = (context) => {
      window.__proposalCalls.push(structuredClone(context));
      return new Promise((resolve) => { window.__pendingProposals[context.thread.id] = { resolve, context }; });
    };
  });
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Draft email');
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveAttribute('data-thread-id', FIXTURE_ITEM_ID);
  await expect(page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`)).toContainText('Drafting email');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'View email');
  assert.equal(await page.evaluate(() => window.__proposalCalls.length), 1);
  await openThreadContext(page, otherId, 'Draft Teams message');
  await expect(other).toContainText('Drafting Teams message');
  assert.equal(await page.evaluate(() => window.__proposalCalls.length), 2);
  await page.evaluate(() => {
    for (const [id, { resolve, context }] of Object.entries(window.__pendingProposals)) {
      resolve({ ok: true, result: {
        schemaVersion: 1, recommendation: 'Confirm the window', confidence: 'high',
        evidence: [{ kind: 'observed', text: 'Owner requested confirmation' }],
        proposals: [{ channel: context.requestedChannel,
          target: { displayName: 'Alex', address: 'alex@example.com' },
          payload: context.requestedChannel === 'email'
            ? { subject: 'Window', body: `Please confirm ${id}` } : { message: `Please confirm ${id}` },
        }],
      } });
    }
  });
  const teams = page.getByTestId('teams-draft-editor');
  await expect(teams).toBeVisible();
  await teams.locator('textarea').fill('Keep my edited Teams message');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'View email');
  await expect(page.getByTestId('email-draft-message')).toHaveValue(`Please confirm ${FIXTURE_ITEM_ID}`);
  await page.getByTestId('email-draft-message').fill('Keep my edited email');
  await openThreadContext(page, otherId, 'View Teams message');
  await expect(teams.locator('textarea')).toHaveValue('Keep my edited Teams message');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'View email');
  await expect(page.getByTestId('email-draft-message')).toHaveValue('Keep my edited email');
  await openThreadContext(page, otherId);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('email-draft-message')).toHaveValue('Keep my edited email');
  await expect(page.locator('.radar-thread[aria-current="true"]')).toHaveAttribute('data-thread-id', FIXTURE_ITEM_ID);
  const calls = await page.evaluate(() => window.__proposalCalls);
  assert.equal(calls.length, 2, 'Viewing existing drafts regenerated them');
  assert.equal(calls[0].thread.id, FIXTURE_ITEM_ID);
  assert.equal(calls[1].thread.id, otherId);
  assert.equal(calls[0].requestedNextStep, moves[1], 'Menu draft omitted the selected work-plan move');
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0]);
  await assertHealthy(session);
}

async function contextMenuColdScenario(session) {
  const { page } = session;
  await openApp(session);
  await page.evaluate(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const item = state.items.find((item) => item.id === id);
    await window.workiq.setColdItems([{ ...item, lifecycleStatus: 'archived', status: 'Archived',
      isNew: false, hasNewUpdate: false, archived: true, completed: true,
      updateHistory: item.updateHistory.map((entry) => ({ ...entry, seen: true })) }]);
    await window.workiq.storeSet('flightdeck.demo.v2', { ...state, items: state.items.filter((item) => item.id !== id) });
  }, FIXTURE_ITEM_ID);
  await openApp(session, { reseed: false });
  await selectRadarView(page, 'archived');
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Mark unread');
  const row = page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  await expect(row).toHaveClass(/unread/);
  await openThreadContext(page, FIXTURE_ITEM_ID, 'Restore to In Progress');
  await page.getByTestId('radar-view-inbox').click();
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/unread/);
  await openApp(session, { reseed: false });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/unread/);
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
  await selectRadarView(session.page, 'completed');
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
  await session.page.getByTestId('email-draft-editor').waitFor({ state: 'visible' });
  assert.equal(await session.page.getByTestId('action-queue').count(), 0, 'Email drafting opened a different review flow');
  await session.page.getByTestId('email-open-actions').click();
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

async function missingAddressScenario(session, missingRecipient = false) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  const editor = session.page.getByTestId('email-draft-editor');
  await editor.getByRole('alert').waitFor({ state: 'visible' });
  assert.equal(await editor.getByTestId('email-draft-create').isDisabled(), true);
  assert.equal(await session.page.getByTestId('action-queue').count(), 0);
  if (missingRecipient) {
    assert.equal(await editor.getByTestId('email-draft-recipient').inputValue(), '');
    const body = await editor.getByTestId('email-draft-message').inputValue();
    await session.page.waitForFunction(async (id) => {
      const state = await window.workiq.storeGet('flightdeck.demo.v2');
      return state?.actionProposals?.some((proposal) => proposal.sourceItemId === id && proposal.target === '');
    }, FIXTURE_ITEM_ID);
    await openApp(session, { reseed: false });
    await selectFixtureThread(session.page);
    await session.page.getByTestId('radar-review-email').click();
    await editor.waitFor({ state: 'visible' });
    assert.equal(await editor.getByTestId('email-draft-recipient').inputValue(), '');
    assert.equal(await editor.getByTestId('email-draft-message').inputValue(), body, 'Unresolved recipient discarded the saved draft');
  }
  await editor.getByTestId('email-draft-recipient').fill('sofia@example.com');
  assert.equal(await editor.getByTestId('email-draft-create').isEnabled(), true);
  assert.equal(await editor.getByRole('alert').count(), 0);
  assert.equal(await session.page.evaluate(() => window.__draftCalls.length), 0);
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
  await session.page.getByTestId('email-open-actions').click();
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
    await session.page.getByTestId('email-open-actions').click();
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
  await session.page.getByTestId('email-open-actions').click();
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
  await session.page.getByTestId('email-open-actions').click();
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
  await session.page.getByTestId('email-open-actions').click();
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
  await session.page.getByTestId('email-open-actions').click();
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
  await queue.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true })
      .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map((animation) => animation.finished));
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
  await session.page.getByTestId('radar-draft-email').click();
  const radarTrigger = session.page.getByTestId('email-open-actions');
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
  await session.page.waitForFunction(() => document.activeElement === document.querySelector('[data-testid="email-open-actions"]'));
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

async function automaticBriefingsScenario(session, failure = false) {
  const { page } = session;
  await page.clock.setFixedTime(new Date(2026, 10, 11, 13));
  await openApp(session);
  await page.evaluate(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    await window.workiq.storeSet('flightdeck.persisted.v2', {
      ...state, connected: true, connectionIntent: true, meetings: [], meetingsLastFetched: 0,
      briefingsByMeetingId: {}, briefingSeenAt: {},
      scanners: state.scanners.map(scanner => ({ ...scanner, enabled: false })),
      items: state.items.map(item => ({ ...item, monitorEnabled: false })),
    });
  });
  await page.goto(`${session.baseUrl}/app.html`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.__briefingCalls)).toEqual(['calendar', 'day']);
  await page.getByRole('button', { name: 'Briefings', exact: true }).click();
  const day = page.locator('.day-briefing-card');
  if (failure) {
    await expect(page.getByRole('alert')).toContainText('Simulated day briefing failure');
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Briefings', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__briefingCalls), ['calendar', 'day']);
    await page.evaluate(() => { window.__briefingFail = false; });
    await day.getByRole('button', { name: 'Generate My Day', exact: true }).click();
    await expect(day).toContainText('Your automatically generated day');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await assertHealthy(session, page.viewportSize().width > 960 ? 'desktop' : 'mobile');
    return;
  }
  await expect(day).toContainText('Your automatically generated day');
  const earlier = page.locator('[data-briefing-meeting-id="briefing-earlier"]');
  const ongoing = page.locator('[data-briefing-meeting-id="briefing-ongoing"]');
  const earlierLane = page.locator('.briefing-lane').filter({ hasText: 'Earlier today' });
  await expect(earlierLane).toContainText('Earlier customer sync');
  await expect(earlierLane).toContainText('Ongoing customer review');
  await expect(ongoing).toBeVisible();
  await expect(page.locator('[data-briefing-meeting-id="briefing-later"]')).toBeVisible();
  await expect(page.locator('[data-briefing-meeting-id="briefing-tomorrow"]')).toHaveCount(0);
  await earlier.locator('.meeting-card__header').click();
  await earlier.getByRole('button', { name: 'Generate Briefing', exact: true }).click();
  await expect(earlier).toContainText('Earlier meeting briefing');
  assert.deepEqual(await page.evaluate(() => window.__briefingCalls), ['calendar', 'day', 'meeting']);
  await page.getByRole('button', { name: 'Refresh Meetings', exact: false }).click();
  await expect.poll(() => page.evaluate(() => window.__briefingCalls)).toEqual(['calendar', 'day', 'meeting', 'calendar']);
  await expect(earlier).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Briefings', exact: true }).click();
  await expect(day).toContainText('Your automatically generated day');
  await expect.poll(() => page.evaluate(async () =>
    (await window.workiq.storeGet('flightdeck.persisted.v2'))?.briefingsByMeetingId?.__day_briefing__?.headline
  )).toBe('Your automatically generated day');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Briefings', exact: true }).click();
  await expect(day).toContainText('Your automatically generated day');
  await expect(earlier).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.__briefingCalls), [], 'Restart regenerated a saved day or meeting briefing');
  await assertHealthy(session, page.viewportSize().width > 960 ? 'desktop' : 'mobile');
}

async function seedTodayDashboard(session) {
  await session.page.evaluate(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const base = state.items.find(item => item.id === 'track_acme_renewal');
    const day = new Date();
    const at = (offset, hour) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, hour).toISOString();
    const task = (id, fields = {}) => ({
      ...base, id, title: id, severity: 'Observe', lifecycleStatus: 'in-progress',
      archived: false, dueAt: null, snoozeUntil: null, completedAt: null,
      monitorEnabled: false, nextRunAt: null, lastChangedAt: at(0, 9), updateHistory: [],
      suggestedNextSteps: ['Already completed move', 'Confirm the delivery date with the owner'],
      completedNextSteps: ['Already completed move'], scannerId: 'today-customer',
      ...fields, status: fields.lifecycleStatus || 'in-progress',
    });
    const confirmed = (proposalId, channel, code) => ({
      kind: 'action', event: 'succeeded', proposalId, channel, code,
      verification: 'runtime-backend-confirmed', timestamp: at(0, 9),
      summary: channel === 'teams' ? 'Teams message sent' : 'Outlook draft created', seen: true,
    });
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state, actionProposals: [], deletedItemIds: [],
      scanners: [
        ...state.scanners,
        { ...state.scanners[0], id: 'today-customer', name: 'Customer work' },
        { ...state.scanners[0], id: 'today-internal', name: 'Internal work' },
      ],
      meetings: [
        { ...state.meetings[0], id: 'today-meeting', title: 'Customer planning \u2014 sync', startAt: at(0, 15), endAt: at(0, 16) },
        { ...state.meetings[0], id: 'tomorrow-meeting', title: 'Tomorrow planning', startAt: at(1, 15), endAt: at(1, 16) },
      ],
      items: [
        task('today-overdue', { title: 'Overdue customer decision requiring a clear next move', dueAt: at(-1, 12), lifecycleStatus: 'blocked' }),
        task('today-due', { title: 'Due today \u2014 confirm delivery and ownership', dueAt: at(0, 17) }),
        ...Array.from({ length: 5 }, (_, index) => task(`today-extra-${index}`, {
          dueAt: at(0, 18),
          ...(index === 0 ? {
            title: 'Review the customer migration plan and confirm the remaining delivery dependencies. '.repeat(4),
            suggestedNextSteps: ['Already completed move', 'Confirm the delivery dependencies with the customer and record the next milestone. '.repeat(12)],
          } : {}),
        })),
        task('today-waiting', { title: 'Waiting for the customer response', lifecycleStatus: 'waiting', scannerId: 'today-internal',
          updateHistory: [confirmed('today-sent', 'teams', 'SEND_CONFIRMED')] }),
        task('today-future', { title: 'Tomorrow, not today', dueAt: at(1, 12), scannerId: 'today-internal',
          updateHistory: [confirmed('today-draft', 'outlook-draft', 'DRAFT_SAVED')] }),
        task('today-snoozed', { title: 'Snoozed work stays out of Today', dueAt: at(-1, 12), snoozeUntil: at(1, 12) }),
        task('today-completed', { title: 'Completed delivery check', lifecycleStatus: 'complete',
          completedAt: at(-5, 9), updateHistory: [{ kind: 'lifecycle', summary: 'Status changed to complete', timestamp: at(0, 9), seen: true }] }),
        task('today-reopened', { title: 'Reopened thread is not completed', completedAt: at(0, 9) }),
      ],
    });
  });
  await session.page.goto(`${session.baseUrl}/app.html?demo=1`, { waitUntil: 'domcontentloaded' });
  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(session.page.getByTestId('today-completed-count')).toHaveText('1');
}

async function todayDashboardScenario(session, width) {
  await openApp(session);
  await session.page.clock.install({ time: new Date(2026, 10, 2, 12) });
  await seedTodayDashboard(session);
  const { page } = session;
  await expect(page.getByTestId('today-active-count')).toHaveText('10');
  await expect(page.getByTestId('today-overdue-count')).toHaveText('1');
  await expect(page.getByTestId('today-due-count')).toHaveText('6');
  await expect(page.getByTestId('today-blocked-count')).toHaveText('2');
  await expect(page.locator('.next-move h2')).toHaveText('Due today confirm delivery and ownership');
  await expect(page.locator('.next-move')).toContainText('Confirm the delivery date with the owner');
  await expect(page.locator('.next-move')).not.toContainText('Already completed move');
  await expect(page.getByTestId('today-attention').locator('article')).toHaveCount(3);
  const selection = page.getByTestId('today-chart-selection');
  const blockedSegment = page.getByRole('button', { name: 'Blocked: 1 threads', exact: true });
  await blockedSegment.focus();
  await blockedSegment.press('Enter');
  await expect(selection.locator('[data-item-id]')).toHaveCount(1);
  await expect(selection.locator('[data-item-id="today-overdue"]')).toBeVisible();
  await selection.getByRole('button', { name: 'Clear selection', exact: true }).click();
  assert.equal(await blockedSegment.evaluate(element => element === document.activeElement), true, 'Clearing chart selection did not restore segment focus');
  await page.getByTestId('today-deadline-today').click();
  await expect(selection.locator('[data-item-id]')).toHaveCount(6);
  await expect(selection.locator('[data-item-id="today-overdue"]')).toHaveCount(0);
  await expect(page.getByTestId('today-deadline-today')).toHaveAttribute('aria-pressed', 'true');
  const selectedCard = selection.locator('[data-item-id="today-due"]');
  await expect(selectedCard.locator('.today-thread-card__next')).toContainText('Confirm the delivery date with the owner');
  assert.deepEqual(await selectedCard.locator('dt').allTextContents(), ['Owner', 'Deadline', 'Scanner', 'Last activity']);
  await expect(selectedCard.locator('.today-thread-card__summary')).toBeHidden();
  await expect(selectedCard.locator('.today-thread-card__details--secondary')).toBeHidden();
  const compactHeight = await selectedCard.evaluate(card => card.getBoundingClientRect().height);
  const compactHeights = await selection.locator('.today-thread-card').evaluateAll(cards =>
    cards.map(card => card.getBoundingClientRect().height));
  assert.ok(Math.max(...compactHeights) <= (width > 960 ? 260 : 330),
    `Compact thread cards exceeded the height budget at ${width}px: ${compactHeights.join(', ')}`);
  const neighbor = selection.locator('[data-item-id="today-extra-0"]');
  const neighborHeight = await neighbor.evaluate(card => card.getBoundingClientRect().height);
  const toggle = selectedCard.getByRole('button', { name: 'Show details', exact: true });
  await toggle.focus();
  await toggle.press('Enter');
  await expect(selectedCard.getByRole('button', { name: 'Hide details', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(selectedCard.locator('.today-thread-card__summary')).toBeVisible();
  await expect(selectedCard.locator('.today-thread-card__details--secondary')).toContainText('Customer work');
  const expandedHeight = await selectedCard.evaluate(card => card.getBoundingClientRect().height);
  assert.ok(expandedHeight >= compactHeight * 1.35, `Details did not meaningfully reduce default card size: ${compactHeight}px / ${expandedHeight}px`);
  assert.ok(Math.abs(await neighbor.evaluate(card => card.getBoundingClientRect().height) - neighborHeight) <= 1,
    'Expanding one card stretched the neighboring card');
  await selectedCard.getByRole('button', { name: 'Hide details', exact: true }).click();
  await expect(selectedCard.locator('.today-thread-card__summary')).toBeHidden();
  assert.ok(Math.abs(await selectedCard.evaluate(card => card.getBoundingClientRect().height) - compactHeight) <= 1,
    'Collapsing details did not restore compact height');
  const nextMoveSize = await neighbor.locator('.today-thread-card__next p').evaluate(element => ({
    height: element.clientHeight, fullHeight: element.scrollHeight, lineHeight: parseFloat(getComputedStyle(element).lineHeight),
  }));
  assert.ok(nextMoveSize.height <= nextMoveSize.lineHeight * 2 + 1 && nextMoveSize.fullHeight > nextMoveSize.height,
    'Long next moves were not compacted to two lines');
  await neighbor.getByRole('button', { name: 'Show details', exact: true }).click();
  assert.equal(await neighbor.locator('.today-thread-card__next p').evaluate(element => element.scrollHeight <= element.clientHeight + 1), true,
    'Expanded details still clip the full next move');
  await neighbor.getByRole('button', { name: 'Hide details', exact: true }).click();
  const uniqueDetails = await page.locator('.today-thread-card button[aria-controls]').evaluateAll(buttons => {
    const ids = buttons.map(button => button.getAttribute('aria-controls'));
    return new Set(ids).size === ids.length && ids.every(id => document.getElementById(id));
  });
  assert.equal(uniqueDetails, true, 'Duplicate thread cards share a details control ID');
  process.stdout.write(`COMPACT_CARD width=${width} compact=${compactHeight}px expanded=${expandedHeight}px\n`);
  await expect(selectedCard.locator('.today-thread-card__badges')).toContainText('In Progress');
  await expect(selectedCard.locator('h2')).toHaveText('Due today confirm delivery and ownership');
  const cardStyles = await page.locator('.next-move, [data-testid="today-chart-selection"] [data-item-id="today-due"]').evaluateAll(cards =>
    cards.map(card => {
      const style = getComputedStyle(card);
      return { border: style.borderTopWidth, radius: style.borderRadius, background: style.backgroundColor, padding: style.padding };
    }));
  assert.equal(cardStyles.length, 2);
  assert.deepEqual(cardStyles[0], cardStyles[1], 'Selected threads and attention threads have different base card styling');
  assert.ok(parseFloat(cardStyles[0].border) >= 1 && parseFloat(cardStyles[0].radius) >= 6, 'Thread cards lack distinct boundaries');
  const clippedCard = await selection.locator('.today-thread-card').evaluateAll(cards =>
    cards.some(card => card.scrollWidth > card.clientWidth + 1));
  assert.equal(clippedCard, false, 'A selected thread card has horizontal overflow');
  await selectedCard.getByRole('button', { name: 'Open thread', exact: true }).click();
  await expect(page.locator('.radar-thread-detail h2')).toContainText('Due today \u2014 confirm delivery and ownership');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByTestId('today-scanner-chart').getByRole('button', { name: /Internal work/ }).click();
  await expect(selection.locator('[data-item-id]')).toHaveCount(2);
  await expect(selection.locator('[data-item-id="today-future"]')).toBeVisible();
  await page.getByTestId('today-activity-2026-11-02').click();
  await expect(selection.locator('[data-item-id="today-completed"]')).toBeVisible();
  await expect(selection.locator('[data-item-id="today-completed"] .today-thread-card__next')).toHaveCount(0);
  await selection.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(selection).toHaveCount(0);
  const progress = page.getByTestId('today-progress');
  await expect(progress.locator('.today-progress-row')).toHaveCount(3);
  await expect(progress).toContainText('Teams message sent');
  await expect(progress).toContainText('Outlook draft created');
  await expect(progress).not.toContainText('Reopened thread is not completed');
  await expect(page.getByRole('button', { name: 'Review drafts (0)', exact: true })).toBeDisabled();
  const hasEmDash = await page.getByTestId('today-dashboard').locator('h1, h2, header p, .today-meeting-row strong, .today-progress-row strong').evaluateAll(elements =>
    elements.some(element => element.textContent.includes('\u2014')));
  assert.equal(hasEmDash, false, 'Today titles or section subtitles still contain em dashes');
  const dimensions = await page.getByTestId('today-dashboard').evaluate(element => ({
    scroll: element.scrollWidth, client: element.clientWidth,
  }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, 'Today dashboard has horizontal overflow');
  const invalidGeometry = await page.getByTestId('today-dashboard').locator('svg').evaluateAll(charts =>
    charts.some(chart => [...chart.querySelectorAll('rect, circle')].some(element =>
      ['width', 'height', 'stroke-dasharray', 'stroke-dashoffset'].some(name => /NaN|Infinity/.test(element.getAttribute(name) || '')))));
  assert.equal(invalidGeometry, false, 'A chart rendered invalid geometry');
  await page.evaluate(() => window.scrollTo(0, 0));
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `today-dashboard-${width}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  screenshotPaths.push(screenshotPath);
  process.stdout.write(`SCREENSHOT view=today width=${width} path=${screenshotPath}\n`);
  await assertHealthy(session, width <= 960 ? 'mobile' : 'desktop');

  await page.getByTestId('today-status-waiting').click();
  await selection.locator('[data-item-id="today-waiting"]').getByRole('button', { name: 'Open thread', exact: true }).click();
  await page.locator('.radar-thread-detail h2').filter({ hasText: 'Waiting for the customer response' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await progress.getByRole('button').filter({ hasText: 'Completed delivery check' }).click();
  await page.locator('.radar-thread-detail h2').filter({ hasText: 'Completed delivery check' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByTestId('today-schedule').getByRole('button', { name: /Customer planning sync/ }).click();
  const meetingHeader = page.locator('[data-briefing-meeting-id="today-meeting"] .meeting-card__header');
  await expect(meetingHeader).toHaveAttribute('aria-expanded', 'true');
  assert.equal(await meetingHeader.evaluate(element => element === document.activeElement), true, 'Today calendar did not focus the selected meeting');
  await assertHealthy(session, width <= 960 ? 'mobile' : 'desktop');
}

async function todayRolloverScenario(session) {
  await openApp(session);
  await session.page.clock.install({ time: new Date(2026, 10, 2, 23, 59, 30) });
  await seedTodayDashboard(session);
  await session.page.clock.fastForward(61_000);
  await expect(session.page.getByTestId('today-completed-count')).toHaveText('0');
  await expect(session.page.getByTestId('today-due-count')).toHaveText('1');
  await expect(session.page.getByTestId('today-progress').locator('.today-progress-row')).toHaveCount(0);
  await assertHealthy(session);
}

async function todayEmptyScenario(session) {
  await openApp(session);
  await session.page.evaluate(async () => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state, actionProposals: [], meetings: [],
      items: state.items.map(item => ({
        ...item, lifecycleStatus: 'complete', completedAt: '2020-01-01T12:00:00Z',
        updateHistory: [], monitorEnabled: false, nextRunAt: null,
      })),
    });
  });
  await session.page.goto(`${session.baseUrl}/app.html?demo=1`, { waitUntil: 'domcontentloaded' });
  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(session.page.getByTestId('today-clear')).toBeVisible();
  await expect(session.page.getByTestId('today-active-count')).toHaveText('0');
  await expect(session.page.getByTestId('today-status-blocked')).toBeDisabled();
  await expect(session.page.getByTestId('today-deadline-overdue')).toBeDisabled();
  await expect(session.page.getByTestId('today-scanner-chart')).toContainText('No active work to group yet');
  await expect(session.page.getByTestId('today-schedule')).toContainText('No meetings saved for today');
  await expect(session.page.getByTestId('today-progress')).toContainText('No completions recorded today yet');
  await expect(session.page.getByRole('button', { name: 'Review drafts (0)', exact: true })).toBeDisabled();
  await assertHealthy(session);
}

async function actionQueueSourceFocusScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('email-open-actions').click();
  await session.page.getByTestId('action-queue').getByRole('button', { name: 'Close actions' }).click();
  await session.page.getByTestId('action-queue').waitFor({ state: 'detached' });

  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  const todayTrigger = session.page.locator('.today-view').getByRole('button', { name: /^Review drafts \(\d+\)$/ });
  await expect(todayTrigger).toBeEnabled();
  await todayTrigger.focus();
  await todayTrigger.click();
  const queue = session.page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await queue.waitFor({ state: 'detached' });
  await expect.poll(() => todayTrigger.evaluate(element => element === document.activeElement),
    { message: 'Action Queue did not restore focus to the Today opener' }).toBe(true);

  await session.page.getByRole('button', { name: 'Briefings', exact: true }).click();
  const meeting = session.page.locator('.meeting-card').first();
  await meeting.locator('.meeting-card__header').click();
  const briefingTrigger = meeting.getByRole('button', { name: 'Review follow-up', exact: true });
  await briefingTrigger.focus();
  await briefingTrigger.click();
  await queue.waitFor({ state: 'visible' });
  await queue.press('Escape');
  await queue.waitFor({ state: 'detached' });
  await expect.poll(() => briefingTrigger.evaluate(element => element === document.activeElement),
    { message: 'Action Queue did not restore focus to the Briefings opener' }).toBe(true);
  await assertHealthy(session);
}

async function actionQueueScreenshotScenario(session, viewportLabel) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('email-open-actions').click();
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

async function assertDraftContextStyles(editor) {
  const context = editor.locator('.radar-draft-context');
  await context.waitFor({ state: 'visible' });
  const metrics = await context.evaluate((element) => {
    const heading = getComputedStyle(element.querySelector('dt'));
    const text = getComputedStyle(element.querySelector('dd'));
    const layout = getComputedStyle(element);
    const message = element.closest('[data-testid]').querySelector('textarea');
    return {
      display: layout.display, columns: layout.gridTemplateColumns.split(' ').length,
      gap: parseFloat(layout.rowGap), headingSize: parseFloat(heading.fontSize),
      headingWeight: Number(heading.fontWeight), headingTransform: heading.textTransform,
      textSize: parseFloat(text.fontSize), messageSize: parseFloat(getComputedStyle(message).fontSize),
      whiteSpace: text.whiteSpace, wrapping: text.overflowWrap, overflow: text.textOverflow,
      lineHeight: parseFloat(text.lineHeight), leftMargin: parseFloat(text.marginLeft),
      separation: element.getBoundingClientRect().top - message.getBoundingClientRect().bottom,
      overflows: [...element.querySelectorAll('dd')].some((entry) => entry.scrollWidth > entry.clientWidth + 1),
    };
  });
  assert.equal(metrics.display, 'grid', 'Draft explanation lost its context styling');
  assert.equal(metrics.columns, 1, 'Long draft explanations must not be squeezed into metadata columns');
  assert.ok(metrics.gap >= 12 && metrics.separation >= 12, 'Draft explanations lack spacing');
  assert.ok(metrics.headingSize < metrics.textSize && metrics.headingWeight >= 600);
  assert.equal(metrics.headingTransform, 'uppercase');
  assert.equal(metrics.textSize, metrics.messageSize, 'Explanation text does not match the editor typography');
  assert.equal(metrics.whiteSpace, 'pre-wrap');
  assert.equal(metrics.wrapping, 'anywhere');
  assert.notEqual(metrics.overflow, 'ellipsis', 'Draft explanations must not be truncated');
  assert.ok(metrics.lineHeight >= metrics.textSize * 1.4);
  assert.equal(metrics.leftMargin, 0);
  assert.equal(metrics.overflows, false, 'Draft explanation overflows its container');
}

async function inlineEmailScenario(session, outcome = 'success') {
  const { page } = session;
  await openApp(session);
  await selectFixtureThread(page);
  await page.getByTestId('radar-draft-email').click();
  const editor = page.getByTestId('email-draft-editor');
  await editor.waitFor({ state: 'visible' });
  await assertDraftContextStyles(editor);
  assert.equal(await page.getByTestId('action-queue').count(), 0, 'Email generation opened Actions instead of the inline composer');
  assert.equal(await page.evaluate(() => window.__draftCalls.length), 0);
  const recipient = editor.getByTestId('email-draft-recipient');
  const subject = editor.getByTestId('email-draft-subject');
  const message = editor.getByTestId('email-draft-message');
  const create = editor.getByTestId('email-draft-create');
  await recipient.fill('invalid');
  assert.equal(await create.isDisabled(), true);
  await recipient.fill('sofia@example.com');
  await subject.fill('');
  assert.equal(await create.isDisabled(), true);
  await subject.fill('Edited deployment window');
  await message.fill('Please confirm the deployment window. ');
  assert.equal(await message.inputValue(), 'Please confirm the deployment window. ', 'Typing lost whitespace in the email body');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await editor.count(), 0);
  await page.getByTestId('radar-review-email').click();
  assert.equal(await message.inputValue(), 'Please confirm the deployment window. ');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Radar', exact: true }).click();
  await selectFixtureThread(page);
  assert.equal(await message.inputValue(), 'Please confirm the deployment window. ');
  await expect.poll(() => page.evaluate(async (id) => (await window.workiq.storeGet('flightdeck.demo.v2'))?.actionProposals
    ?.some((proposal) => proposal.sourceItemId === id && proposal.sourceTitle === 'Edited deployment window'), FIXTURE_ITEM_ID)).toBe(true);
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  await page.getByTestId('radar-review-email').click();
  assert.equal(await recipient.inputValue(), 'sofia@example.com');
  assert.equal(await subject.inputValue(), 'Edited deployment window');
  assert.equal((await message.inputValue()).trim(), 'Please confirm the deployment window.');
  await page.evaluate(() => {
    window.workiq.createOutlookDraft = (payload) => new Promise((resolve) => {
      window.__draftCalls.push(structuredClone(payload));
      window.__resolveInlineDraft = resolve;
    });
  });
  await create.click();
  const actionStatus = page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).getByTestId('thread-action-status');
  await actionStatus.filter({ hasText: 'Creating Outlook draft...' }).waitFor({ state: 'attached' });
  assert.equal(await create.isDisabled(), true);
  assert.equal(await recipient.isDisabled(), true);
  assert.equal(await message.isDisabled(), true);
  assert.equal(await page.getByTestId('radar-draft-email').isDisabled(), true);
  assert.equal(await page.getByTestId('radar-draft-teams').isDisabled(), true);
  await editor.getByTestId('email-open-actions').click();
  const queue = page.getByTestId('action-queue');
  await queue.getByText('Executing', { exact: true }).first().waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.__draftCalls.length), 1, 'Actions dispatched a duplicate inline operation');
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.evaluate((result) => window.__resolveInlineDraft(result), outcome === 'success'
    ? { ok: true, action: 'outlook-draft-created' }
    : outcome === 'cancel' ? { ok: false, code: 'CANCELLED', dispatched: false }
      : { ok: true, draftId: 'not-an-authoritative-receipt' });
  await page.getByRole('button', { name: 'Radar', exact: true }).click();
  await selectFixtureThread(page);
  if (outcome === 'success') {
    await editor.waitFor({ state: 'hidden' });
  } else {
    const status = editor.getByTestId('email-draft-status');
    await status.filter({ hasText: outcome === 'cancel'
      ? 'cancelled before dispatch. No external action occurred.' : 'Check Outlook Drafts before trying again' }).waitFor({ state: 'visible' });
    assert.equal(await create.isDisabled(), outcome !== 'cancel', 'Unexpected retry availability for the Outlook result');
  }
  assert.equal(await actionStatus.count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__draftCalls), [{
    to: ['sofia@example.com'], subject: 'Edited deployment window', body: 'Please confirm the deployment window.',
  }]);
  const audit = page.getByTestId('action-timeline-entry');
  assert.equal(await audit.filter({ hasText: 'Action proposal execution started' }).count(), 1);
  if (outcome === 'success') {
    assert.equal(await audit.filter({ hasText: 'Outlook draft saved in Outlook Drafts. Nothing was sent.' }).count(), 1);
    await page.getByRole('button', { name: 'View created Outlook draft', exact: true }).click();
    const preview = page.getByTestId('action-message-preview');
    await preview.waitFor({ state: 'visible' });
    assert.equal(await preview.getByTestId('action-message-subject').textContent(), 'Edited deployment window');
    assert.equal((await preview.getByTestId('action-message-body').textContent()).trim(), 'Please confirm the deployment window.');
    assert.equal(await preview.locator('input, textarea').count(), 0, 'Completed draft history was editable');
    assert.equal(await editor.count(), 0, 'Viewing history reopened the editable composer');
  } else if (outcome === 'cancel') {
    assert.equal(await message.isEnabled(), true, 'Cancellation locked the editable inline draft');
    await message.fill('Revised after cancelling confirmation');
    assert.equal(await create.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__draftCalls.length), 1, 'Editing a cancelled draft retried a write');
  }
  await assertHealthy(session, page.viewportSize().width > 960 ? 'desktop' : 'mobile');
}

async function inlineEmailIncompleteScenario(session) {
  const { page } = session;
  await openApp(session);
  await selectFixtureThread(page);
  await page.getByTestId('radar-draft-email').click();
  const editor = page.getByTestId('email-draft-editor');
  await editor.getByTestId('email-draft-recipient').fill('');
  await editor.getByTestId('email-draft-subject').fill('');
  await editor.getByTestId('email-draft-message').fill('');
  assert.equal(await editor.getByTestId('email-draft-create').isDisabled(), true);
  await expect.poll(() => page.evaluate(async (id) => (await window.workiq.storeGet('flightdeck.demo.v2'))?.actionProposals
    ?.some((proposal) => proposal.sourceItemId === id && proposal.sourceTitle === '' && proposal.content === '' && proposal.target === ''), FIXTURE_ITEM_ID)).toBe(true);
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  await page.getByTestId('radar-review-email').click();
  for (const field of ['recipient', 'subject', 'message']) {
    assert.equal(await editor.getByTestId(`email-draft-${field}`).inputValue(), '');
  }
  assert.equal(await editor.getByTestId('email-draft-create').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__draftCalls.length), 0);
  await assertHealthy(session);
}

async function teamsReviewScenario(session, missingRecipient = false) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-teams').click();
  const draft = session.page.getByTestId('teams-draft-editor');
  await draft.waitFor({ state: 'visible' });
  await assertDraftContextStyles(draft);
  const proposalCalls = await session.page.evaluate(() => structuredClone(window.__proposalCalls));
  assert.equal(proposalCalls.length, 1, 'Draft Teams message did not invoke the narrow API exactly once');
  assert.equal(proposalCalls[0].requestedChannel, 'teams');
  await draft.getByText('A confirmed window is the smallest step that unblocks the renewal.', { exact: true }).waitFor({ state: 'visible' });
  await draft.getByText('Confirm the recipient is the current owner.', { exact: true }).waitFor({ state: 'visible' });
  await draft.getByText('Verify the channel.', { exact: true }).waitFor({ state: 'visible' });
  const recipient = draft.locator('input[type="text"]');
  const recipientEmail = draft.locator('input[type="email"]');
  assert.equal(await recipient.inputValue(), missingRecipient ? '' : 'James Farquharson');
  assert.equal(await recipientEmail.inputValue(), missingRecipient ? '' : 'james@example.com',
    'Generated recipient email was discarded before review');
  if (missingRecipient) {
    assert.equal(await draft.getByTestId('teams-draft-send').isDisabled(), true, 'An unknown Teams recipient must block sending, not composing');
    assert.ok((await draft.locator('textarea').inputValue()).trim(), 'Missing Teams recipient discarded the draft');
  }
  await recipient.fill('Alex Johnson');
  assert.equal(await recipient.inputValue(), 'Alex Johnson', 'Teams recipient was not editable');
  assert.equal(await recipientEmail.inputValue(), '', 'Editing the name retained a stale recipient email');
  await recipientEmail.fill('not-an-email');
  assert.equal(await draft.getByTestId('teams-draft-send').isDisabled(), true,
    'Invalid explicit email fell back to the display name');
  await recipient.fill('');
  await recipientEmail.fill('alex@example.com');
  assert.equal(await draft.getByTestId('teams-draft-send').isEnabled(), true,
    'A verified email-only target could not be reviewed for sending');
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

async function concurrentThreadDraftsScenario(session) {
  const { page } = session;
  await openApp(session);
  await selectFixtureThread(page);
  const otherId = await page.locator('.radar-thread').evaluateAll((rows, firstId) =>
    rows.find((row) => row.dataset.threadId !== firstId).dataset.threadId, FIXTURE_ITEM_ID);
  const select = (id) => page.locator(`[data-thread-id="${id}"]`).click();
  const actionStatus = (id) => page.locator(`[data-thread-id="${id}"]`).getByTestId('thread-action-status');
  await page.evaluate(() => {
    window.__pendingProposals = {};
    window.workiq.proposeThreadActions = (context) => new Promise((resolve) => {
      window.__pendingProposals[context.thread.id] = { resolve, context };
    });
  });
  const resolve = (id, fail = false) => page.evaluate(({ id, fail }) => {
    const { resolve, context } = window.__pendingProposals[id];
    delete window.__pendingProposals[id];
    resolve(fail ? { ok: false, code: 'TIMEOUT' } : { ok: true, result: {
      schemaVersion: 1, recommendation: 'Confirm the window', confidence: 'high',
      evidence: [{ kind: 'observed', text: 'Owner requested confirmation' }],
      proposals: [{
        channel: context.requestedChannel,
        target: { displayName: 'Alex', address: 'alex@example.com' },
        payload: context.requestedChannel === 'email'
          ? { subject: 'Window', body: `Please confirm ${id}` } : { message: `Please confirm ${id}` },
      }],
    } });
  }, { id, fail });
  await page.getByTestId('radar-draft-email').click();
  await actionStatus(FIXTURE_ITEM_ID).filter({ hasText: 'Drafting email...' }).waitFor({ state: 'visible' });
  await select(otherId);
  await page.getByTestId('radar-draft-teams').click();
  await actionStatus(otherId).filter({ hasText: 'Drafting Teams message...' }).waitFor({ state: 'visible' });
  assert.equal(await actionStatus(FIXTURE_ITEM_ID).isVisible(), true, 'Navigating hid the first thread action');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await actionStatus(otherId).locator('.radar-thread__action-spinner')
    .evaluate((element) => getComputedStyle(element).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await actionStatus(otherId).locator('.radar-thread__action-spinner')
    .evaluate((element) => getComputedStyle(element).animationName), 'draftSpin');
  assert.equal(await page.evaluate(() => Object.keys(window.__pendingProposals).length), 2);
  await select(FIXTURE_ITEM_ID);
  assert.equal(await page.getByTestId('radar-draft-email').textContent().then((text) => text.trim()), 'Drafting…');
  assert.equal(await page.getByTestId('radar-draft-email').isDisabled(), true);
  await select(otherId);
  await resolve(otherId, true);
  await page.getByTestId('proposal-error').filter({ hasText: 'timed out' }).waitFor({ state: 'visible' });
  assert.equal(await actionStatus(otherId).textContent().then((text) => text.trim()), 'Teams draft failed');
  assert.equal(await actionStatus(otherId).locator('.radar-thread__action-spinner').count(), 0, 'Failed action retained its spinner');
  assert.equal(await actionStatus(FIXTURE_ITEM_ID).isVisible(), true, 'Failure cleared another thread spinner');
  await page.getByTestId('proposal-error').getByRole('button', { name: 'Retry Teams draft', exact: true }).click();
  await actionStatus(otherId).filter({ hasText: 'Drafting Teams message...' }).waitFor({ state: 'visible' });
  await resolve(otherId);
  const editor = page.getByTestId('teams-draft-editor');
  await editor.locator('textarea').fill('Edited thread B draft');
  assert.equal(await actionStatus(otherId).count(), 0, 'Completed draft retained its spinner');
  await editor.locator('input[type="text"]').fill('Taylor');
  await select(FIXTURE_ITEM_ID);
  assert.equal(await page.getByTestId('teams-draft-editor').count(), 0);
  assert.equal(await page.getByTestId('proposal-error').count(), 0);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await resolve(FIXTURE_ITEM_ID);
  await page.waitForFunction(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state?.actionProposals?.some((proposal) => proposal.sourceItemId === id && proposal.content === `Please confirm ${id}`);
  }, FIXTURE_ITEM_ID);
  assert.equal(await page.getByTestId('action-queue').count(), 0, 'Background completion stole the current view');
  await page.getByRole('button', { name: 'Radar', exact: true }).click();
  await select(FIXTURE_ITEM_ID);
  assert.equal(await actionStatus(FIXTURE_ITEM_ID).count(), 0, 'Background completion retained its spinner');
  await page.getByTestId('email-open-actions').click();
  const queue = page.getByTestId('action-queue');
  await queue.waitFor({ state: 'visible' });
  assert.equal(await queue.locator('textarea').inputValue(), `Please confirm ${FIXTURE_ITEM_ID}`);
  await queue.getByTestId('action-segment-archived').click();
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await page.getByTestId('email-open-actions').click();
  assert.equal(await queue.getByTestId('action-segment-open').getAttribute('aria-selected'), 'true');
  assert.equal(await queue.locator('textarea').inputValue(), `Please confirm ${FIXTURE_ITEM_ID}`);
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await select(otherId);
  assert.equal(await editor.locator('textarea').inputValue(), 'Edited thread B draft');
  assert.equal(await editor.locator('input[type="text"]').inputValue(), 'Taylor');
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0],
    'Synthesis dispatched an unapproved external write');
  await page.evaluate(() => {
    window.workiq.sendTeamsMessage = (payload) => new Promise((resolve) => {
      window.__teamsSendCalls.push(payload);
      window.__resolveThreadSend = resolve;
    });
  });
  await editor.getByTestId('teams-draft-send').click();
  await actionStatus(otherId).filter({ hasText: 'Sending Teams message...' }).waitFor({ state: 'visible' });
  await select(FIXTURE_ITEM_ID);
  assert.equal(await actionStatus(otherId).isVisible(), true, 'Navigation hid the sending indicator');
  await select(otherId);
  assert.equal(await editor.getByTestId('teams-draft-send').textContent().then((text) => text.trim()), 'Sending…');
  assert.equal(await editor.getByTestId('teams-draft-send').isDisabled(), true);
  await select(FIXTURE_ITEM_ID);
  await page.evaluate(() => window.__resolveThreadSend({ ok: true, action: 'teams-message-sent' }));
  await select(otherId);
  await editor.waitFor({ state: 'hidden' });
  assert.equal(await actionStatus(otherId).count(), 0, 'Sent message retained its spinner');
  assert.equal(await editor.getByTestId('teams-draft-send').count(), 0);
  await page.getByRole('button', { name: 'View sent Teams message', exact: true }).click();
  assert.equal(await page.getByTestId('action-message-body').textContent(), 'Edited thread B draft',
    'A background send displayed the wrong thread message');
  assert.deepEqual(await page.evaluate(() => window.__teamsSendCalls), [
    { targetDisplayName: 'Taylor', message: 'Edited thread B draft' },
  ]);
  await openApp(session, { reseed: false });
  await select(FIXTURE_ITEM_ID);
  await page.getByTestId('radar-review-email').click();
  await page.getByTestId('email-open-actions').click();
  assert.equal(await queue.locator('textarea').inputValue(), `Please confirm ${FIXTURE_ITEM_ID}`,
    'Persisted email lost its source-thread review action after reload');
  await queue.getByRole('button', { name: 'Close actions' }).click();
  await assertHealthy(session);
}

async function assertTeamsStatusAppearance(status, isError) {
  assert.equal(await status.getAttribute('role'), isError ? 'alert' : 'status');
  const colors = await status.evaluate((element, error) => {
    const style = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.color = style.getPropertyValue(error ? '--color-critical' : '--text-muted');
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: style.color, expected };
  }, isError);
  assert.equal(colors.actual, colors.expected, 'Teams outcome color did not match its severity');
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
  await assertTeamsStatusAppearance(draft.getByTestId('teams-send-status'), false);
  assert.equal(await message.inputValue(), editedMessage, 'Cancellation discarded the edited Teams draft');

  await send.click();
  await draft.getByTestId('teams-send-status').filter({ hasText: 'Delivery could not be confirmed. Check Teams before trying again.' }).waitFor({ state: 'visible' });
  await assertTeamsStatusAppearance(draft.getByTestId('teams-send-status'), true);
  assert.equal(await message.inputValue(), editedMessage, 'Unconfirmed send discarded the edited Teams draft');
  assert.equal(await send.isDisabled(), true, 'An unconfirmed write allowed an immediate duplicate retry');
  assert.equal(await session.page.getByTestId('radar-draft-teams').isDisabled(), true,
    'Regeneration could bypass unconfirmed delivery protection');
  assert.equal(await draft.getByRole('button', { name: 'Close', exact: true }).isDisabled(), true,
    'Discarding the draft could bypass unconfirmed delivery protection');
  assert.equal(await session.page.evaluate(() => window.__teamsSendCalls.length), 2);
  const allowRetry = draft.getByTestId('teams-allow-retry');
  await session.page.getByRole('button', { name: 'Today', exact: true }).click();
  await session.page.getByRole('button', { name: 'Radar', exact: true }).click();
  await selectFixtureThread(session.page);
  assert.equal(await send.isDisabled(), true, 'Navigation cleared unconfirmed delivery protection');
  await allowRetry.click();
  assert.equal(await session.page.evaluate(() => window.__teamsSendCalls.length), 2,
    'Acknowledging a Teams check dispatched a message without pressing Send');

  await send.click();
  await draft.getByTestId('teams-send-status').filter({ hasText: 'Teams reported that the message was not sent' }).waitFor({ state: 'visible' });
  await assertTeamsStatusAppearance(draft.getByTestId('teams-send-status'), true);
  assert.equal(await message.inputValue(), editedMessage, 'Failure discarded the edited Teams draft');

  await send.click();
  await draft.waitFor({ state: 'hidden' });
  assert.equal(await send.count(), 0, 'Authoritative success left a duplicate-send control in the editor');
  const calls = await session.page.evaluate(() => structuredClone(window.__teamsSendCalls));
  assert.equal(calls.length, 4, 'Teams send did not preserve explicit retry attempts');
  assert.deepEqual(calls[3], {
    targetDisplayName: 'James Farquharson', targetEmail: 'james@example.com', message: editedMessage,
  });
  const timeline = session.page.getByTestId('action-timeline-entry');
  await timeline.filter({ hasText: 'Teams send cancelled before dispatch. No request was dispatched.' }).waitFor({ state: 'visible' });
  await timeline.filter({ hasText: 'Teams send could not be confirmed. Check Teams before trying again.' }).waitFor({ state: 'visible' });
  await timeline.filter({ hasText: 'Teams message sent with a matching receipt.' }).waitFor({ state: 'visible' });
  await session.page.getByRole('button', { name: 'View sent Teams message', exact: true }).click();
  const preview = session.page.getByTestId('action-message-preview');
  assert.equal(await preview.getByTestId('action-message-body').textContent(), editedMessage);
  assert.equal(await preview.getByTestId('action-message-recipient').textContent(), 'james@example.com');
  assert.equal(await preview.locator('input, textarea').count(), 0);
  const beforeReload = await timeline.count();
  await openApp(session, { reseed: false });
  await selectFixtureThread(session.page);
  assert.equal(await session.page.getByTestId('action-timeline-entry').count(), beforeReload, 'Reload duplicated Teams action callbacks');
  await session.page.getByRole('button', { name: 'View sent Teams message', exact: true }).click();
  assert.equal(await preview.getByTestId('action-message-body').textContent(), editedMessage, 'Reload lost the confirmed message');
  assert.equal(await session.page.evaluate(() => window.__teamsSendCalls.length), 0, 'Viewing persisted message history resent it');
  await assertHealthy(session);
}

async function historySourceNavigationScenario(session) {
  await openApp(session);
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('email-open-actions').click();
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
  const todayId = await session.page.locator('.next-move').getAttribute('data-item-id');
  const todayTarget = await session.page.evaluate(async (id) => (await window.workiq.storeGet('flightdeck.demo.v2'))?.items?.find((item) => item.id === id), todayId);
  await session.page.locator('.next-move').getByRole('button', { name: 'Open thread', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: todayTarget.title }).waitFor({ state: 'visible' });
  await assertExternalRadarSelection(session.page, todayTarget);

  await openApp(session, { reseed: false });
  await selectFixtureThread(session.page);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.getByTestId('email-open-actions').click();
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
  const todayId = await session.page.locator('.next-move').getAttribute('data-item-id');
  const todayTarget = await session.page.evaluate(async (id) => (await window.workiq.storeGet('flightdeck.demo.v2'))?.items?.find((item) => item.id === id), todayId);
  await session.page.locator('.next-move').getByRole('button', { name: 'Open thread', exact: true }).click();
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).waitFor({ state: 'visible' });
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: todayTarget.title }).waitFor({ state: 'visible' });
  await assertExternalRadarSelection(session.page, todayTarget, { mobile: true });
  await session.page.getByTestId('radar-detail-back').click();
  await session.page.locator('.radar-thread-list-pane.mobile-active').waitFor({ state: 'visible' });
  await session.page.waitForFunction((title) => [...document.querySelectorAll('.radar-thread')]
    .some((element) => element.textContent.includes(title) && element.getAttribute('aria-current') === 'true'), todayTarget.title);
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
  assert.equal(await session.page.getByRole('heading', { name: 'Your day at a glance', exact: true }).isVisible(), true,
    'Deleted cold notification changed the active destination');
  assert.equal(await session.page.locator('.radar-thread-detail h2').count(), 0,
    'Deleted cold notification populated a detail pane');

  await session.page.evaluate((id) => window.__notificationCallback?.({ taskId: id }), setup.unavailableId);
  await session.page.waitForTimeout(100);
  assert.equal(await session.page.getByRole('heading', { name: 'Your day at a glance', exact: true }).isVisible(), true,
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
  const editor = session.page.getByTestId('email-draft-editor');
  await editor.waitFor({ state: 'visible' });
  await session.page.waitForTimeout(700);
  const firstCount = await session.page.evaluate(async () => (await window.workiq.storeGet('flightdeck.demo.v2'))?.actionProposals?.length || 0);
  await session.page.getByTestId('radar-draft-email').click();
  await session.page.waitForFunction(() => window.__proposalCalls.length === 2);
  await editor.waitFor({ state: 'visible' });
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
  await session.page.getByTestId('email-draft-editor').waitFor({ state: 'visible' });
  assert.equal(await session.page.evaluate(() => window.__proposalCalls.length), 2);
  await assertHealthy(session);
}

async function selectionRegressionScenario(session) {
  for (const action of ['snooze', 'complete', 'archive']) {
    await openApp(session);
    await selectFixtureThread(session.page);
    if (action === 'complete') {
      await session.page.getByLabel('Work state', { exact: true }).selectOption('complete');
    } else {
      await session.page.getByTestId('radar-more').click();
      await session.page.getByTestId(`radar-${action}`).click();
    }
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
    const viewButtons = session.page.locator('.radar-view-nav [data-testid^="radar-view-"]');
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
    if (view !== 'inbox') await selectRadarView(session.page, view);
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
  await session.page.getByLabel('Criticality', { exact: true }).selectOption('Elevated');
  await session.page.getByLabel('Work state', { exact: true }).selectOption('blocked');
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
  await session.page.getByTestId('inbox-filters').click();
  await session.page.getByTestId('inbox-quick-updated').click();
  await session.page.getByRole('button', { name: 'Close filters', exact: true }).click();
  await session.page.locator(`[data-thread-id="${fixture.newerId}"]`).waitFor({ state: 'visible' });
  assert.equal(await session.page.locator(`[data-thread-id="${fixture.olderId}"]`).count(), 0,
    'UPDATED quick filter retained a non-updated thread');
  await session.page.locator(`[data-thread-id="${fixture.newerId}"]`).click();
  await session.page.getByLabel('Scanner assignment').selectOption(fixture.targetScannerId);
  await session.page.getByLabel('Owner').fill('Browser owner');
  await session.page.getByLabel('Owner').press('Tab');
  await session.page.getByLabel('Due date').fill('2099-09-15T14:30');
  await session.page.getByLabel('Due date').press('Tab');
  await session.page.getByLabel('Done when', { exact: true }).fill('Browser workflow is persisted.');
  await session.page.getByLabel('Done when', { exact: true }).press('Tab');
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

async function panelCornerCoverage(panel) {
  return panel.evaluate(element => {
    const box = element.getBoundingClientRect();
    return [
      [box.left + 20, box.top + 20], [box.right - 20, box.top + 20],
      [box.left + 20, box.bottom - 20], [box.right - 20, box.bottom - 20],
    ].map(([x, y]) => element.contains(document.elementFromPoint(x, y)));
  });
}

async function radarCleanWorkspaceScenario(session, width, captureSuffix = '') {
  const { page } = session;
  await openApp(session);
  assert.equal(await page.locator('.summary-strip, .ticker-bar').count(), 0, 'Radar retained the overview strip or ticker');
  assert.equal(await page.locator('.radar-smart-views').count(), 0, 'Radar retained the empty sidebar');
  assert.equal(await page.locator('.radar-thread-list-pane .radar-view-nav').isVisible(), true,
    'View navigation was not mounted above the threads');
  assert.equal(await page.getByRole('button', { name: 'Views', exact: true }).count(), 0,
    'Mobile retained a separate Views step');
  assert.equal(await page.locator('.radar-view-nav > button').count(), 2, 'Inbox and Priority were not directly accessible');
  if (width > 960) {
    const layout = await page.locator('.radar-triage').evaluate(element => {
      const panes = [...element.children].map(pane => pane.getBoundingClientRect());
      return { panes: panes.length, left: element.getBoundingClientRect().left,
        listLeft: panes[0].left, listWidth: panes[0].width, listRight: panes[0].right, detailLeft: panes[1].left };
    });
    assert.equal(layout.panes, 2, 'Radar did not use two panes');
    assert.ok(Math.abs(layout.listLeft - layout.left) < 1, 'Unused space remained before the thread list');
    assert.ok(layout.listWidth >= 420, `The thread list did not gain most of the sidebar width: ${layout.listWidth}px`);
    assert.ok(Math.abs(layout.detailLeft - layout.listRight) < 1, 'Unused space remained between the panes');
  }
  assert.equal(await page.getByTestId('radar-view-completed').isVisible(), false, 'Secondary views were not collapsed');
  const viewsTrigger = page.getByTestId('radar-more-views');
  const viewsPanel = page.locator('.radar-secondary-views__panel');
  await expect(viewsTrigger).toHaveText('Monitored');
  await expect(page.getByTestId('radar-view-inbox')).toHaveAttribute('aria-pressed', 'true');
  await viewsTrigger.click();
  await expect(viewsPanel).toBeVisible();
  await page.getByRole('heading', { name: 'Radar', exact: true }).click();
  await expect(viewsPanel).toBeHidden();
  await expect(page.getByTestId('radar-view-inbox')).toHaveAttribute('aria-pressed', 'true');
  await viewsTrigger.click();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('radar-view-monitored')).toBeFocused();
  await expect(viewsPanel).toBeVisible();
  await page.getByTestId('radar-view-archived').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('inbox-quick-unread')).toBeFocused();
  await expect(viewsPanel).toBeHidden();
  await viewsTrigger.click();
  await page.getByTestId('radar-view-priority').click();
  await expect(viewsPanel).toBeHidden();
  await expect(page.getByTestId('radar-view-priority')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('radar-view-inbox').click();
  await viewsTrigger.click();
  await viewsTrigger.click();
  await expect(viewsPanel).toBeHidden();
  await page.getByTestId('radar-more-views').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByTestId('radar-view-completed').isVisible(), true, 'More views did not expose secondary navigation');
  await expect.poll(() => panelCornerCoverage(page.locator('.radar-secondary-views__panel'))).toEqual([true, true, true, true]);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('radar-view-completed').isVisible(), false, 'Escape did not collapse More views');
  for (const [view, label] of [['monitored', 'Monitored'], ['snoozed', 'Snoozed'], ['completed', 'Completed'], ['archived', 'Archive']]) {
    await selectRadarView(page, view);
    await expect(page.getByTestId(`radar-view-${view}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('radar-more-views')).toHaveText(label);
    assert.equal(await page.getByTestId(`radar-view-${view}`).isVisible(), false, 'Choosing a view did not close its menu');
    assert.equal(await page.getByTestId('radar-more-views').evaluate(element => element === document.activeElement), true,
      'Choosing a view did not return focus to its summary');
  }
  await selectFixtureThread(page);
  if (width <= 960) await page.getByTestId('radar-detail-back').click();
  await expect(page.getByTestId('radar-more-views')).toHaveText('Monitored');
  await expect(page.getByTestId('radar-view-inbox')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await page.getByTestId('inbox-quick-updated').isVisible(), false, 'Additional quick filters were not tucked away');
  assert.equal(await page.getByTestId('radar-snooze').isVisible(), false, 'Snooze was not tucked into More');

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `radar-clean-workspace-${width}${captureSuffix}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: width <= 960, animations: 'disabled' });
  screenshotPaths.push(screenshotPath);
  process.stdout.write(`SCREENSHOT view=radar-clean-workspace width=${width} path=${screenshotPath}\n`);

  const threadsStep = page.getByRole('button', { name: 'Threads', exact: true });
  if (await threadsStep.isVisible()) await threadsStep.click();
  await page.getByTestId('inbox-filters').click();
  const panel = page.locator('.inbox-refine__panel');
  const box = await panel.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'Filters escaped the viewport');
  const coverage = () => panelCornerCoverage(panel);
  await expect.poll(coverage, { message: 'Part of the Filters panel was clipped or covered' }).toEqual([true, true, true, true]);
  const filtersScreenshot = path.join(SCREENSHOT_DIR, `radar-filters-${width}${captureSuffix}.png`);
  await page.screenshot({ path: filtersScreenshot, fullPage: false, animations: 'disabled' });
  screenshotPaths.push(filtersScreenshot);
  const viewport = page.viewportSize();
  if (width > 960 && viewport.height > 600) {
    await page.setViewportSize({ width, height: 600 });
    await expect.poll(coverage, { message: 'Resizing clipped the open Filters panel' }).toEqual([true, true, true, true]);
    await page.setViewportSize(viewport);
    await expect.poll(coverage).toEqual([true, true, true, true]);
  }
  const lastFilter = panel.locator('fieldset').last().locator('input').last();
  await lastFilter.check();
  await lastFilter.uncheck();
  assert.equal(await page.locator('.radar-thread-list-pane').evaluate(element => element.scrollLeft), 0,
    'Reaching a filter scrolled the thread pane horizontally');
  await page.getByRole('checkbox', { name: 'Read', exact: true }).check();
  assert.match(await page.getByTestId('inbox-filters').textContent(), /Filters \(1\)/);
  await expect(panel).toBeVisible();
  await page.getByRole('heading', { name: 'Radar', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('inbox-filters')).toHaveText('Filters (1)');
  await page.getByTestId('inbox-filters').click();
  await expect(page.getByRole('checkbox', { name: 'Read', exact: true })).toBeChecked();
  await page.locator('#radar-search').focus();
  await expect(panel).toBeHidden();
  await expect(page.locator('#radar-search')).toBeFocused();
  await page.getByTestId('inbox-filters').click();
  await expect(page.getByRole('checkbox', { name: 'Read', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false, 'Escape did not close Filters');
  assert.equal(await page.getByTestId('inbox-filters').evaluate(element => element === document.activeElement), true,
    'Filters did not restore keyboard focus');
  await page.getByTestId('inbox-active-filter').click();
  assert.equal(await page.getByTestId('inbox-filters').textContent(), 'Filters');

  const scannerId = await page.locator('#radar-scanner option').nth(1).getAttribute('value');
  await page.locator('#radar-scanner').selectOption(scannerId);
  await page.getByTestId('radar-scanner-tools').click();
  const toolsBox = await page.locator('.radar-scanner-menu__panel').boundingBox();
  assert.ok(toolsBox.x >= 0 && toolsBox.x + toolsBox.width <= width + 1, 'Scanner tools escaped the viewport');
  assert.equal(await page.getByTestId('radar-edit-scanner').isVisible(), true, 'Scanner settings became unreachable');
  assert.equal(await page.getByTestId('radar-toggle-scanner').isVisible(), true, 'Scanner pause/resume became unreachable');
  assert.equal(await page.getByRole('button', { name: 'Run scanner', exact: true }).isDisabled(), true,
    'Demo scanner controls lost their remote-operation gate');
  await page.getByRole('heading', { name: 'Radar', exact: true }).click();
  await expect(page.locator('.radar-scanner-menu__panel')).toBeHidden();
  await page.getByTestId('radar-scanner-tools').click();
  await page.locator('#radar-search').focus();
  await expect(page.locator('.radar-scanner-menu__panel')).toBeHidden();
  await expect(page.locator('#radar-search')).toBeFocused();
  await page.getByTestId('radar-scanner-tools').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('radar-edit-scanner').isVisible(), false, 'Scanner tools did not close');
  await assertHealthy(session, width > 960 ? 'desktop' : 'mobile');
}

async function actionHierarchyScenario(session, viewportWidth, captureScreenshot = false) {
  await openApp(session);
  const threadsStep = session.page.getByRole('button', { name: 'Threads', exact: true });
  if (await threadsStep.isVisible()) await threadsStep.click();
  const thread = session.page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`);
  await thread.waitFor({ state: 'visible' });
  await thread.click();
  await session.page.locator('.radar-thread-detail h2').filter({ hasText: FIXTURE_ITEM_TITLE }).waitFor({ state: 'visible' });

  const compose = session.page.getByRole('group', { name: 'Draft work plan message', exact: true });
  const toolbar = session.page.getByTestId('radar-thread-toolbar');
  const email = session.page.getByTestId('radar-draft-email');
  const teams = session.page.getByTestId('radar-draft-teams');
  const snooze = session.page.getByTestId('radar-snooze');
  const more = session.page.getByTestId('radar-more');
  const archive = session.page.getByTestId('radar-archive');
  const deleteCard = session.page.getByTestId('radar-delete');

  assert.equal(await compose.locator('button').count(), 2, 'Compose actions were not grouped together');
  assert.equal(await toolbar.locator('button').count(), 3, 'Overflow actions were not grouped together');
  assert.equal(await compose.getAttribute('aria-busy'), 'false', 'Idle compose group was marked busy');
  assert.deepEqual(await compose.locator('button').allTextContents(), ['Email', 'Teams']);
  assert.equal(await toolbar.locator(':scope > button').count(), 0, 'Redundant standalone command remains');
  assert.equal(await session.page.getByTestId('radar-complete').count(), 0);
  assert.equal(await more.textContent(), '...');
  assert.equal(await more.getAttribute('aria-label'), 'More thread actions');
  assert.equal(await more.getAttribute('title'), 'More thread actions');
  assert.equal(await archive.isVisible(), false, 'Archive was visible before opening More actions');
  assert.equal(await snooze.isVisible(), false, 'Snooze was visible before opening More actions');
  assert.equal(await deleteCard.isVisible(), false, 'Delete was visible before opening More actions');
  await more.focus();
  await more.press('Enter');
  assert.equal(await archive.isVisible(), true, 'Archive was not disclosed by More actions');
  assert.equal(await deleteCard.isVisible(), true, 'Delete was not disclosed by More actions');
  assert.deepEqual(await session.page.getByRole('menu', { name: 'More item actions' }).locator('button').allTextContents(), ['Snooze', 'Archive', 'Delete from FlightDeck…']);
  await more.press('Tab');
  await expect(snooze).toBeFocused();
  await session.page.keyboard.press('Tab');
  await expect(archive).toBeFocused();
  await session.page.keyboard.press('Tab');
  await expect(deleteCard).toBeFocused();
  await session.page.keyboard.press('Escape');
  await expect(archive).toBeHidden();
  await expect(more).toBeFocused();
  assert.equal(await more.evaluate((element) =>
    element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2), true,
  'Overflow disclosure lacked visible keyboard focus');
  await more.press('Space');
  await expect(snooze).toBeVisible();
  await session.page.getByRole('heading', { name: 'Radar', exact: true }).click();
  await expect(archive).toBeHidden();
  await more.click();
  await session.page.locator('.radar-thread-detail h2').focus();
  await expect(archive).toBeHidden();
  await expect(session.page.locator('.radar-thread-detail h2')).toBeFocused();
  await more.click();
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
    return {
      email: describe('radar-draft-email'),
      teams: describe('radar-draft-teams'),
      snooze: describe('radar-snooze'),
      archive: describe('radar-archive'),
      deleteCard: describe('radar-delete'),
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
  assert.ok(semanticStyles.snooze.classes.includes('radar-action-button--snooze'));
  assert.ok(semanticStyles.archive.classes.includes('radar-more-menu__item'));
  assert.ok(semanticStyles.deleteCard.classes.includes('radar-more-menu__item--delete'));
  assert.equal(semanticStyles.archive.classes.some((className) => className === 'warn' || className === 'primary'), false, 'Archive received high-emphasis styling');

  await email.focus();
  await session.page.keyboard.press('Shift+Tab');
  await session.page.keyboard.press('Tab');
  assert.equal(await email.evaluate((element) => element === document.activeElement), true, 'Keyboard focus did not return to Draft email');
  assert.equal(await email.evaluate((element) => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2), true, 'Draft email lacked visible keyboard focus');
  await session.page.keyboard.press('Tab');
  assert.equal(await teams.evaluate((element) => element === document.activeElement), true, 'Tab did not advance to Draft Teams message');
  assert.equal(await teams.evaluate((element) => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2), true, 'Draft Teams message lacked visible keyboard focus');

  for (const group of [compose, toolbar]) {
    await group.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
  }
  const geometry = await session.page.locator('.radar-thread-detail').evaluate((element) => {
    const rectangle = (target) => target.getBoundingClientRect().toJSON();
    const buttons = [...element.querySelectorAll('.radar-action-button')].filter((button) => {
      const menu = button.closest('details');
      return button.getClientRects().length && (!menu || button.tagName === 'SUMMARY' || menu.open);
    });
    return {
      toolbar: rectangle(element.querySelector('.radar-thread-toolbar')),
      header: rectangle(element.querySelector(':scope > header')),
      recommendations: rectangle(element.querySelector('[data-testid="scanner-recommendations"]')),
      compose: rectangle(element.querySelector('.radar-action-group--compose')),
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
  assert.equal(geometry.buttons.length, 3, `Expected two compose commands and one overflow disclosure at ${viewportWidth}px`);
  assert.ok(geometry.toolbar.x >= geometry.header.x - 1
    && geometry.toolbar.x + geometry.toolbar.width <= geometry.header.x + geometry.header.width + 1,
  `Thread toolbar escaped the header at ${viewportWidth}px`);
  assert.ok(geometry.toolbar.bottom <= geometry.recommendations.top,
    `Management commands were not above the Work plan at ${viewportWidth}px`);
  assert.ok(geometry.compose.x >= geometry.recommendations.x - 1
    && geometry.compose.right <= geometry.recommendations.right + 1,
  `Compose controls escaped the recommended next moves at ${viewportWidth}px`);
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
  await session.page.waitForFunction(() => document.querySelector('[role="group"][aria-label="Draft work plan message"]')?.getAttribute('aria-busy') === 'true');
  assert.equal(await email.isDisabled(), true, 'Active compose action remained enabled while synthesis was pending');
  assert.equal(await teams.isDisabled(), true, 'Alternate compose action remained enabled while synthesis was pending');
  assert.equal(await email.evaluate((element) => element.classList.contains('is-loading')), true, 'Pending compose action lacked loading state');
  const widthsAfter = await Promise.all([email.evaluate((element) => element.getBoundingClientRect().width), teams.evaluate((element) => element.getBoundingClientRect().width)]);
  assert.equal(widthsAfter.every((width, index) => Math.abs(width - widthsBefore[index]) <= 1), true, `Compose labels shifted widths while loading at ${viewportWidth}px`);
  await assertHealthy(session, viewportWidth > 960 ? 'desktop' : 'mobile');
}

async function prepareWorkPlanFixture(session, noMoves = false) {
  const { page } = session;
  const moves = ['Confirm the deployment window with Sofia.', 'Ask Alex to verify the deployment owner.'];
  await openApp(session);
  await page.evaluate(async ({ id, steps }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state, items: state.items.map((item) => item.id === id ? { ...item, suggestedNextSteps: steps } : item),
    });
  }, { id: FIXTURE_ITEM_ID, steps: noMoves ? [] : moves });
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  await installWorkPlanProposalMock(page);
  return moves;
}

async function installWorkPlanProposalMock(page) {
  await page.evaluate(() => {
    const original = window.workiq.proposeThreadActions;
    window.workiq.proposeThreadActions = async (context) => {
      if (window.__failWorkPlanNext) {
        window.__failWorkPlanNext = false;
        window.__proposalCalls.push(structuredClone(context));
        return { ok: false, code: 'TIMEOUT' };
      }
      const response = await original(context);
      response.result.proposals[0].channel = context.requestedChannel;
      const message = context.requestedNextStep || 'Follow up on the thread.';
      response.result.proposals[0].payload = context.requestedChannel === 'email'
        ? { subject: 'Selected next move', body: message } : { message };
      return response;
    };
  });
}

async function workPlanDraftScenario(session, noMoves = false) {
  const { page } = session;
  const moves = await prepareWorkPlanFixture(session, noMoves);
  if (noMoves) {
    assert.equal(await page.getByRole('radio').count(), 1, 'Custom next move must remain available without recommendations');
    for (const channel of ['email', 'teams']) {
      await page.getByTestId(`radar-draft-${channel}`).click();
      await page.getByTestId(`${channel}-draft-editor`).waitFor({ state: 'visible' });
    }
    const calls = await page.evaluate(() => window.__proposalCalls);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((context) => !Object.hasOwn(context, 'requestedNextStep')),
      'A thread without recommendations invented a selected next step');
  } else {
    const first = page.getByTestId('radar-next-move-0');
    const second = page.getByTestId('radar-next-move-1');
    assert.equal(await first.isChecked(), true, 'The first recommendation was not selected initially');
    await first.focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await second.isChecked(), true, 'Keyboard selection did not choose the second recommendation');
    await page.getByTestId('radar-draft-teams').click();
    const teamsEditor = page.getByTestId('teams-draft-editor');
    await expect.poll(() => teamsEditor.locator('textarea').inputValue()).toBe(moves[1]);
    const showThreads = async () => {
      const threadsStep = page.getByRole('button', { name: 'Threads', exact: true });
      if (await threadsStep.isVisible()) await threadsStep.click();
    };
    await showThreads();
    await page.locator(`.radar-thread:not([data-thread-id="${FIXTURE_ITEM_ID}"])`).first().click();
    await showThreads();
    await page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).click();
    assert.equal(await second.isChecked(), true, 'Navigating to another thread discarded the chosen next move');
    assert.equal(await teamsEditor.locator('textarea').inputValue(), moves[1], 'Thread navigation lost the inline draft');
    await page.getByTestId('radar-draft-email').click();
    await expect.poll(() => page.getByTestId('email-draft-message').inputValue()).toBe(moves[1]);
    let calls = await page.evaluate(() => window.__proposalCalls);
    assert.deepEqual(calls.map((context) => [context.requestedChannel, context.requestedNextStep]),
      [['teams', moves[1]], ['email', moves[1]]], 'The channel buttons did not compose for the selected work-plan step');

    await first.check();
    await page.evaluate(() => { window.__failWorkPlanNext = true; });
    await page.getByTestId('radar-draft-teams').click();
    await page.getByTestId('proposal-error').waitFor({ state: 'visible' });
    await second.check();
    await expect(page.getByTestId('proposal-error')).toHaveCount(0);
    await page.getByTestId('radar-draft-teams').click();
    await expect.poll(() => teamsEditor.locator('textarea').inputValue()).toBe(moves[1]);
    calls = await page.evaluate(() => window.__proposalCalls);
    assert.deepEqual(calls.slice(-2).map((context) => context.requestedNextStep), [moves[0], moves[1]],
      'Switching moves retained a stale error/retry instruction');
  }
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0],
    'Selecting a next move or drafting caused an external write');
  await assertHealthy(session, page.viewportSize().width > 960 ? 'desktop' : 'mobile');
}

async function customWorkPlanScenario(session, noMoves = false) {
  const { page } = session;
  const moves = await prepareWorkPlanFixture(session, noMoves);
  const custom = page.getByTestId('radar-custom-next-move');
  const input = page.getByTestId('radar-custom-next-move-text');
  assert.equal(await page.locator('.radar-next-moves input[type="radio"]').count(), noMoves ? 1 : 3);
  await page.getByTestId('radar-draft-email').click();
  await page.getByTestId('email-draft-editor').waitFor({ state: 'visible' });
  await custom.check();
  await expect(input).toBeFocused();
  await expect(page.getByTestId('email-draft-editor')).toHaveCount(0);
  for (const text of ['', ' \n ']) {
    await input.fill(text);
    for (const channel of ['email', 'teams']) await expect(page.getByTestId(`radar-draft-${channel}`)).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Enter a custom next move before drafting.' })).toBeVisible();
  }
  const instruction = 'Ask Sofia to confirm the unresolved blocker.\nRequest the ownership update.';
  await input.fill(`  ${instruction}  `);
  for (const channel of ['teams', 'email']) {
    await page.getByTestId(`radar-draft-${channel}`).click();
    const message = channel === 'email' ? page.getByTestId('email-draft-message')
      : page.getByTestId('teams-draft-editor').locator('textarea');
    await expect(message).toHaveValue(instruction);
    const context = await page.evaluate(() => window.__proposalCalls.at(-1));
    assert.equal(context.requestedNextStep, instruction);
    assert.equal(context.requestedChannel, channel);
    assert.equal(Object.hasOwn(context.thread, 'workPlanChoice'), false);
    if (channel === 'email') await expect(page.getByTestId('email-draft-recipient')).toHaveValue('sofia@example.com');
    else await expect(page.getByTestId('teams-draft-editor').locator('input[type="email"]')).toHaveValue('sofia@example.com');
  }
  const saved = await page.evaluate(async () => (await window.workiq.storeGet('flightdeck.demo.v2')).actionProposals);
  assert.ok(saved.some(proposal => proposal.sourceNextStep === instruction), 'Custom email lost its completion mapping');
  if (!noMoves) assert.ok(saved.some(proposal => proposal.sourceNextStep === moves[0]), 'Custom composition deleted the previous email draft');
  const edited = `${instruction}\nAsk for clarification if needed.`;
  await input.fill(edited);
  await expect(page.getByTestId('email-draft-editor')).toHaveCount(0);
  await expect(page.getByTestId('teams-draft-editor')).toHaveCount(0);
  if (!noMoves) {
    await page.getByTestId('radar-next-move-0').check();
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId('radar-review-email')).toBeVisible();
    await custom.check();
    await expect(input).toHaveValue(edited);
  }
  const showThreads = async () => {
    const button = page.getByRole('button', { name: 'Threads', exact: true });
    if (await button.isVisible()) await button.click();
  };
  await showThreads();
  await page.locator(`.radar-thread:not([data-thread-id="${FIXTURE_ITEM_ID}"])`).first().click();
  await custom.check();
  await expect(input).toHaveValue('');
  await input.fill('Ask the other owner for a status update.');
  await showThreads();
  await page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).click();
  await expect(input).toHaveValue(edited);
  await expect(custom).toBeChecked();
  await expect.poll(() => page.evaluate(async id =>
    (await window.workiq.storeGet('flightdeck.demo.v2')).items.find(item => item.id === id)?.workPlanChoice?.customText,
  FIXTURE_ITEM_ID)).toBe(edited);
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    await assertHealthy(session, page.viewportSize().width > 960 ? 'desktop' : 'mobile');
    const colors = await input.evaluate(element => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    assert.notEqual(colors.text, colors.background);
  }
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0],
    'Custom typing or composition dispatched an external write');
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  await expect(custom).toBeChecked();
  await expect(input).toHaveValue(edited);
  await expect(page.getByTestId('radar-review-email')).toHaveCount(0);
  await expect(page.getByTestId('radar-draft-email')).toBeEnabled();
  await input.fill('   ');
  for (const channel of ['email', 'teams']) await expect(page.getByTestId(`radar-draft-${channel}`)).toBeDisabled();
  await expect(page.getByTestId('radar-review-email')).toHaveCount(0);
  if (page.viewportSize().width > 960) {
    await input.fill(edited);
    await page.locator(`.radar-thread:not([data-thread-id="${FIXTURE_ITEM_ID}"])`).first().click({ modifiers: ['Control'] });
    for (const channel of ['email', 'teams']) await expect(page.getByTestId(`radar-draft-${channel}`)).toBeDisabled();
    await expect(input).toBeDisabled();
    await expect(custom).toBeDisabled();
    assert.equal(await page.evaluate(() => window.__proposalCalls.length), 0);
  }
  await assertHealthy(session, page.viewportSize().width > 960 ? 'desktop' : 'mobile');
}

async function customWorkPlanCompletionScenario(session, channel) {
  const { page } = session;
  await prepareWorkPlanFixture(session);
  const instruction = 'Ask Sofia to confirm the remaining blocker and current owner.';
  await page.getByTestId('radar-custom-next-move').check();
  await page.getByTestId('radar-custom-next-move-text').fill(instruction);
  await page.getByTestId(`radar-draft-${channel}`).click();
  const editor = page.getByTestId(`${channel}-draft-editor`);
  await editor.waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0]);
  await page.getByTestId(channel === 'email' ? 'email-draft-create' : 'teams-draft-send').click();
  await editor.waitFor({ state: 'hidden' });
  await expect.poll(() => page.evaluate(async id =>
    (await window.workiq.storeGet('flightdeck.demo.v2')).items.find(item => item.id === id)?.completedNextSteps || [],
  FIXTURE_ITEM_ID)).toContain(instruction);
  for (const target of ['email', 'teams']) await expect(page.getByTestId(`radar-draft-${target}`)).toBeDisabled();
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]),
    channel === 'email' ? [1, 0] : [0, 1]);
  await page.getByTestId('radar-custom-next-move-text').fill('Ask Sofia to clarify any follow-on work.');
  for (const target of ['email', 'teams']) await expect(page.getByTestId(`radar-draft-${target}`)).toBeEnabled();
  await assertHealthy(session);
}

async function workPlanCompletionScenario(session) {
  const { page } = session;
  const moves = await prepareWorkPlanFixture(session);
  const message = 'Please confirm the owner.\n<This is literal message text, not markup>';
  await page.getByTestId('radar-draft-teams').click();
  await page.getByTestId('teams-draft-editor').locator('textarea').fill(message);
  await page.getByTestId('teams-draft-send').click();
  await page.getByTestId('teams-draft-editor').waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('radar-next-move-0').isDisabled(), true, 'Confirmed Teams send did not disable its next move');
  assert.equal(await page.getByTestId('radar-next-move-1').isChecked(), true, 'The next unfinished move was not available');
  assert.equal(await page.getByTestId('radar-draft-email').isEnabled(), true, 'Completing one move incorrectly disabled another');
  const viewTeams = page.getByRole('button', { name: 'View sent Teams message', exact: true });
  await viewTeams.focus();
  await page.keyboard.press('Enter');
  const preview = page.getByTestId('action-message-preview');
  await preview.waitFor({ state: 'visible' });
  await expect(preview.getByTestId('action-message-body')).toBeInViewport();
  assert.equal(await preview.locator('h3').evaluate((element) => element === document.activeElement), true);
  assert.equal(await preview.getByTestId('action-message-body').textContent(), message);
  assert.equal(await preview.getByTestId('action-message-body').locator('*').count(), 0, 'Message content was treated as markup');
  assert.equal(await preview.locator('input, textarea').count(), 0, 'Sent message history was editable');
  assert.deepEqual(await preview.locator('button').allTextContents(), ['Close'], 'History exposed an execution control');
  await page.getByTestId('action-preview-close').click();
  assert.equal(await viewTeams.evaluate((element) => element === document.activeElement), true, 'Closing message history lost timeline focus');

  await page.getByTestId('radar-draft-email').click();
  const email = page.getByTestId('email-draft-editor');
  await email.getByTestId('email-draft-message').fill('Please confirm the deployment window by reply.');
  await email.getByTestId('email-draft-create').click();
  await email.waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('radar-next-move-1').isDisabled(), true, 'Confirmed Outlook draft did not finish its next move');
  for (const channel of ['email', 'teams']) {
    assert.equal(await page.getByTestId(`radar-draft-${channel}`).isDisabled(), true, 'A completed plan still allowed another draft');
  }
  await expect.poll(() => page.evaluate(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state.items.find((item) => item.id === id)?.completedNextSteps || [];
  }, FIXTURE_ITEM_ID)).toEqual(moves);
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  assert.equal(await page.getByTestId('teams-draft-editor').count(), 0);
  assert.equal(await page.getByTestId('email-draft-editor').count(), 0);
  for (const index of [0, 1]) assert.equal(await page.getByTestId(`radar-next-move-${index}`).isDisabled(), true);
  for (const channel of ['email', 'teams']) assert.equal(await page.getByTestId(`radar-draft-${channel}`).isDisabled(), true);
  await page.getByRole('button', { name: 'View created Outlook draft', exact: true }).click();
  assert.equal(await preview.getByTestId('action-message-body').textContent(), 'Please confirm the deployment window by reply.');
  await preview.getByText('Saved in Outlook Drafts. Nothing was sent.', { exact: true }).waitFor({ state: 'visible' });
  await page.getByTestId('action-preview-close').click();
  const showOlder = page.getByRole('button', { name: /^Show \d+ older$/ });
  if (await showOlder.isVisible()) await showOlder.click();
  await page.getByRole('button', { name: 'View sent Teams message', exact: true }).click();
  assert.equal(await preview.getByTestId('action-message-body').textContent(), message, 'Sent message text did not survive restart');
  await expect(preview.getByTestId('action-message-body')).toBeInViewport();
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0],
    'Inspecting completed actions dispatched another write');
  await page.getByTestId('action-preview-close').click();
  await page.getByTestId('radar-custom-next-move').check();
  await installWorkPlanProposalMock(page);
  await page.getByTestId('radar-custom-next-move-text').fill('Ask Sofia to confirm whether any follow-on work is needed.');
  for (const channel of ['email', 'teams']) {
    await expect(page.getByTestId(`radar-draft-${channel}`)).toBeEnabled();
    await page.getByTestId(`radar-draft-${channel}`).click();
    await page.getByTestId(`${channel}-draft-editor`).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.__proposalCalls.at(-1).requestedNextStep),
      'Ask Sofia to confirm whether any follow-on work is needed.');
  }
  assert.deepEqual(await page.evaluate(() => [window.__draftCalls.length, window.__teamsSendCalls.length]), [0, 0]);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `completed-action-message-${page.viewportSize().width}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: page.viewportSize().width <= 960, animations: 'disabled' });
  screenshotPaths.push(screenshotPath);
  process.stdout.write(`SCREENSHOT view=completed-message path=${screenshotPath}\n`);
  await assertHealthy(session, page.viewportSize().width > 960 ? 'desktop' : 'mobile');
}

async function workPlanUnfinishedOutcomeScenario(session, channel, outcome) {
  const { page } = session;
  await prepareWorkPlanFixture(session);
  await page.getByTestId(`radar-draft-${channel}`).click();
  await page.getByTestId(`${channel}-draft-editor`).waitFor({ state: 'visible' });
  await page.evaluate(({ channel, outcome }) => {
    const response = outcome === 'cancel' ? { ok: false, code: 'CANCELLED', dispatched: false }
      : outcome === 'unconfirmed' ? { ok: false, code: channel === 'teams' ? 'SEND_UNCONFIRMED' : 'ACTION_UNCONFIRMED', dispatched: true }
        : { ok: false, code: outcome === 'resolution' ? 'RESOLUTION_FAILED'
          : outcome === 'chat-open' ? 'CHAT_OPEN_FAILED' : channel === 'teams' ? 'SEND_FAILED' : 'CREATE_FAILED', dispatched: false };
    window.workiq[channel === 'teams' ? 'sendTeamsMessage' : 'createOutlookDraft'] = async (payload) => {
      window[channel === 'teams' ? '__teamsSendCalls' : '__draftCalls'].push(structuredClone(payload));
      return response;
    };
  }, { channel, outcome });
  await page.getByTestId(channel === 'teams' ? 'teams-draft-send' : 'email-draft-create').click();
  const editor = page.getByTestId(`${channel}-draft-editor`);
  const status = editor.getByTestId(channel === 'teams' ? 'teams-send-status' : 'email-draft-status');
  await expect.poll(() => status.textContent()).toMatch(outcome === 'cancel' ? /cancelled/i
    : outcome === 'unconfirmed' ? /confirm|check.*before/i : /failed|not.*created|not.*sent/i);
  if (channel === 'teams') await assertTeamsStatusAppearance(status, outcome !== 'cancel');
  assert.equal(await editor.isVisible(), true, `${outcome} closed the ${channel} editor`);
  assert.equal(await page.getByTestId('radar-next-move-0').isDisabled(), false, `${outcome} completed the next move`);
  const state = await page.evaluate(async () => window.workiq.storeGet('flightdeck.demo.v2'));
  assert.deepEqual(state.items.find((item) => item.id === FIXTURE_ITEM_ID).completedNextSteps, []);
  assert.equal(await page.getByRole('button', { name: /^View (sent Teams message|created Outlook draft)$/ }).count(), 0);
  await assertHealthy(session);
}

async function legacyActionMessageScenario(session) {
  const { page } = session;
  await openApp(session);
  await page.evaluate(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state, items: state.items.map((item) => item.id === id ? {
        ...item, updateHistory: [{
          kind: 'action', eventId: 'legacy-sent-message', proposalId: 'missing-old-message',
          itemId: id, event: 'succeeded', outcome: 'succeeded', channel: 'teams',
          verification: 'runtime-backend-confirmed', code: 'SEND_CONFIRMED',
          timestamp: new Date().toISOString(), target: 'alex@example.com', seen: true,
        }, ...item.updateHistory],
      } : item),
    });
  }, FIXTURE_ITEM_ID);
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  await page.getByRole('button', { name: 'View sent Teams message', exact: true }).click();
  const preview = page.getByTestId('action-message-preview');
  await preview.getByTestId('action-message-unavailable').waitFor({ state: 'visible' });
  assert.equal(await preview.getByTestId('action-message-recipient').textContent(), 'alex@example.com');
  assert.equal(await preview.getByTestId('action-message-body').count(), 0, 'Legacy history invented missing message content');
  assert.deepEqual(await page.evaluate(() => [window.__proposalCalls.length, window.__teamsSendCalls.length]), [0, 0]);
  await assertHealthy(session);
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

async function radarActivityResponsiveHeightScenario(session) {
  const { page } = session;
  await openApp(session);
  const history = Array.from({ length: 12 }, (_, index) => ({
    kind: 'reply',
    timestamp: new Date(Date.now() - index * 3_600_000).toISOString(),
    changes: ['Updated'],
    summary: `Update ${index + 1}. ${'Customer approval is pending while the delivery team confirms the rollout plan and remaining dependencies. '.repeat(8)}`,
    severity: 'Elevated',
    seen: true,
  }));
  await page.evaluate(async ({ id, history }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    await window.workiq.storeSet('flightdeck.demo.v2', {
      ...state,
      items: state.items.map((item) => item.id === id ? { ...item, updateHistory: history } : item),
    });
  }, { id: FIXTURE_ITEM_ID, history });
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);

  const timeline = page.locator('.radar-activity-panel .activity-timeline');
  await timeline.locator('.at-summary').filter({ hasText: 'Update 1.' }).waitFor({ state: 'visible' });
  const assertCompactWorkColumn = async () => {
    const gap = await page.evaluate(() => {
      const work = document.querySelector('.radar-work-panel');
      const children = [...work.children].filter(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).display !== 'none';
      });
      return document.querySelector('[data-testid="radar-context-reason"]').getBoundingClientRect().top
        - children.at(-1).getBoundingClientRect().bottom;
    });
    assert.ok(gap >= 0 && gap <= 48,
      `Work plan and context should be separated by at most 48px, not ${gap}px`);
    process.stdout.write(`WORK_COLUMN_GAP width=${page.viewportSize().width} gap=${gap}\n`);
    return gap;
  };
  const measure = () => timeline.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const detailBounds = element.closest('.radar-thread-detail').getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      animation: style.animationName,
      visibleHeight: Math.max(0,
        Math.min(bounds.bottom, detailBounds.bottom, innerHeight) - Math.max(bounds.top, detailBounds.top, 0)),
    };
  });
  const measurements = [];
  for (const height of [700, 1100]) {
    await page.setViewportSize({ width: 1440, height });
    await page.locator('.radar-thread-detail').evaluate((element) => { element.scrollTop = 0; });
    const measurement = await measure();
    assert.equal(measurement.maxHeight, 'none', 'Radar timeline retained the fixed height cap');
    assert.equal(measurement.animation, 'none', 'Timeline reveal animation reinstated the height cap');
    assert.equal(measurement.overflowY, 'visible', 'Radar timeline retained a nested scrollbar');
    await assertCompactWorkColumn();
    assert.ok(measurement.height > 420, `Timeline is still constrained: ${JSON.stringify(measurement)}`);
    assert.ok(measurement.scrollHeight <= measurement.height + 1, 'Timeline content is clipped');
    measurements.push(measurement);
    await assertHealthy(session, 'desktop');
  }
  assert.ok(measurements[1].visibleHeight > measurements[0].visibleHeight + 300,
    `Activity did not gain space in a taller window: ${JSON.stringify(measurements)}`);
  assert.ok(measurements[1].visibleHeight > 420, 'Tall windows still show only a 420px activity viewport');
  assert.equal(await timeline.locator('.at-event').count(), 5);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, 'radar-work-column-spacing-1440.png');
  await page.screenshot({ path: screenshotPath, animations: 'disabled' });
  screenshotPaths.push(screenshotPath);
  await timeline.getByRole('button', { name: 'Show 7 older', exact: true }).click();
  assert.equal(await timeline.locator('.at-event').count(), 12, 'Expanding history lost activity entries');
  await assertCompactWorkColumn();

  await page.setViewportSize({ width: 360, height: 900 });
  await timeline.waitFor({ state: 'visible' });
  const mobile = await measure();
  assert.equal(mobile.overflowY, 'visible', 'Mobile timeline has a nested scroll trap');
  assert.ok(mobile.scrollHeight <= mobile.height + 1, 'Mobile timeline clips activity');
  await assertCompactWorkColumn();
  const mobileFlow = await page.evaluate(() => ({
    overflow: getComputedStyle(document.body).overflow,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  assert.notEqual(mobileFlow.overflow, 'hidden', 'Mobile activity cannot scroll with the page');
  assert.ok(mobileFlow.scrollHeight > mobileFlow.clientHeight, 'Mobile activity did not extend the document');
  await assertHealthy(session, 'mobile');
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
  assert.equal(await done.getByRole('textbox', { name: 'Done when', exact: true }).inputValue(), '');

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
  assert.equal(await session.page.getByRole('textbox', { name: 'Done when', exact: true }).inputValue(), doneCriteria);

  const recommendations = session.page.getByTestId('scanner-recommendations');
  await session.page.getByRole('heading', { name: 'Work plan', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await session.page.getByRole('heading', { name: 'Context', exact: true }).count(), 0,
    'The combined Work plan pane retained the old Context heading');
  assert.deepEqual(await recommendations.locator('[data-next-move-text]').allTextContents(), recommendedMoves,
    'Radar Work plan did not preserve both scanner recommendations');
  assert.equal(await recommendations.locator('xpath=ancestor::*[contains(@class, "radar-detail-columns")]').count(), 1,
    'Scanner recommendations were not moved into the Work plan column');
  assert.equal(await recommendations.locator('.radar-action-group--compose').count(), 1,
    'Draft controls were not integrated with the recommended next moves');
  assert.equal(await session.page.locator('.radar-thread-detail > header .radar-more-menu').count(), 1,
    'Management controls were not moved into the thread header');
  assert.equal(await session.page.locator('.radar-work-panel .radar-more-menu').count(), 0,
    'Management controls were duplicated below the draft editor');
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

async function consolidatedDetailsScenario(session, width) {
  const { page } = session;
  await openApp(session);
  const threadsStep = page.getByRole('button', { name: 'Threads', exact: true });
  if (await threadsStep.isVisible()) await threadsStep.click();
  const listPills = page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"] .mailbox-status, [data-thread-id="${FIXTURE_ITEM_ID}"] .mailbox-severity`);
  const listHeights = await listPills.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height));
  assert.equal(listHeights.length, 2);
  assert.ok(listHeights.every((height) => height > 0 && height < 30), 'Read-only list pills are no longer compact');
  await selectFixtureThread(page);
  const header = page.locator('.radar-thread-detail > header');
  const metadata = page.locator('.radar-context-meta');
  assert.equal(await page.locator('.radar-control-strip').count(), 0, 'Duplicate control strip remains');
  assert.equal(await page.getByLabel('Done when', { exact: true }).count(), 1);
  assert.equal(await page.getByLabel('Done criteria', { exact: true }).count(), 0);
  assert.equal(await header.getByRole('button', { name: 'Open', exact: true }).count(), 0);
  assert.equal(await header.getByRole('button', { name: 'Complete', exact: true }).count(), 0);
  const layout = await header.evaluate((element) => {
    const heading = element.querySelector('h2').getBoundingClientRect();
    const actions = element.querySelector('.radar-header-actions').getBoundingClientRect();
    return { titleLeft: heading.left, titleBottom: heading.bottom, pillsLeft: actions.left, pillsTop: actions.top };
  });
  assert.ok(Math.abs(layout.pillsLeft - layout.titleLeft) <= 1, 'Header pills are not aligned to the left of the title');
  assert.ok(layout.pillsTop >= layout.titleBottom, 'Header pills are not below the title');

  await header.getByLabel('Criticality', { exact: true }).selectOption('Elevated');
  await header.getByLabel('Work state', { exact: true }).selectOption('blocked');
  await header.getByLabel('Criticality', { exact: true }).focus();
  assert.equal(await header.locator('.radar-header-pill').first().evaluate((element) =>
    getComputedStyle(element).outlineStyle), 'solid', 'Keyboard focus is not visible on the pill');
  await header.getByLabel('Criticality', { exact: true }).press('ArrowUp');
  assert.equal(await header.getByLabel('Criticality', { exact: true }).inputValue(), 'Critical');
  await header.getByLabel('Criticality', { exact: true }).press('ArrowDown');
  assert.equal(await header.getByLabel('Criticality', { exact: true }).inputValue(), 'Elevated');

  const assertPillStyles = async () => {
    const styles = await page.evaluate((id) => {
      const readStyle = (selector) => {
        const element = document.querySelector(selector);
        const style = getComputedStyle(element);
        return {
          text: element.querySelector('span')?.textContent || element.textContent,
          color: style.color,
          borderColor: style.borderColor,
          borderRadius: style.borderRadius,
          backgroundColor: style.backgroundColor,
        };
      };
      return {
        headerSeverity: readStyle('.radar-header-actions .mailbox-severity'),
        rowSeverity: readStyle(`[data-thread-id="${id}"] .mailbox-severity`),
        headerStatus: readStyle('.radar-header-actions .mailbox-status'),
        rowStatus: readStyle(`[data-thread-id="${id}"] .mailbox-status`),
      };
    }, FIXTURE_ITEM_ID);
    assert.deepEqual(styles.headerSeverity, styles.rowSeverity, 'Header criticality lost its themed colors');
    assert.deepEqual(styles.headerStatus, styles.rowStatus, 'Header work state lost its themed colors');
    const geometry = await header.locator('.radar-header-pill').evaluateAll((pills) =>
      pills.map((pill) => {
        const bounds = pill.getBoundingClientRect();
        const select = pill.querySelector('select');
        const target = select.getBoundingClientRect();
        const style = getComputedStyle(pill);
        const chevron = getComputedStyle(pill, '::after');
        return {
          height: bounds.height, left: bounds.left, right: bounds.right,
          fontSize: parseFloat(style.fontSize), padding: parseFloat(style.paddingLeft),
          fullTarget: Math.abs(target.width - bounds.width) <= 2 && Math.abs(target.height - bounds.height) <= 2
            && Math.abs(target.left - bounds.left) <= 1 && Math.abs(target.top - bounds.top) <= 1,
          nativeSelect: select instanceof HTMLSelectElement && style.position === 'relative',
          chevron: parseFloat(chevron.width) >= 5 && parseFloat(chevron.borderRightWidth) >= 1,
          clipped: pill.scrollWidth > pill.clientWidth + 1,
        };
      }));
    for (const pill of geometry) {
      assert.ok(pill.height >= (width <= 960 ? 40 : 36), `Editable pill is too small: ${JSON.stringify(pill)}`);
      assert.ok(pill.fontSize >= 12 && pill.padding >= 10, 'Editable pill text or padding is too small');
      assert.ok(pill.fullTarget && pill.nativeSelect && pill.chevron, 'Editable pill lost its full-area native dropdown');
      assert.ok(pill.left >= 0 && pill.right <= width && !pill.clipped, 'Editable pill is clipped or overflows');
    }
  };
  await assertPillStyles();
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await assertPillStyles();

  const owner = metadata.getByLabel('Owner', { exact: true });
  await owner.fill('');
  await owner.pressSequentially('Browser owner');
  assert.equal(await owner.inputValue(), 'Browser owner', 'Typing lost spaces in the owner');
  const due = metadata.getByLabel('Due date', { exact: true });
  const dueValue = '2099-09-15T14:30';
  const expectedDue = await page.evaluate((value) => new Date(value).toISOString(), dueValue);
  await due.fill(dueValue);
  const scanner = metadata.getByLabel('Scanner assignment', { exact: true });
  await scanner.selectOption('');
  await page.getByLabel('Done when', { exact: true }).fill('Owner confirms.\nWork is delivered.');
  await page.getByLabel('Done when', { exact: true }).press('Tab');
  await page.waitForFunction(async ({ id, expectedDue }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const item = state?.items.find((entry) => entry.id === id);
    return item?.severity === 'Elevated' && item?.lifecycleStatus === 'blocked'
      && item?.owner === 'Browser owner' && item?.dueAt === expectedDue
      && item?.scannerId == null && item?.doneCriteria === 'Owner confirms.\nWork is delivered.';
  }, { id: FIXTURE_ITEM_ID, expectedDue });

  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  assert.equal(await header.getByLabel('Criticality', { exact: true }).inputValue(), 'Elevated');
  assert.equal(await header.getByLabel('Work state', { exact: true }).inputValue(), 'blocked');
  assert.equal(await owner.inputValue(), 'Browser owner');
  assert.equal(await due.inputValue(), dueValue);
  assert.equal(await scanner.inputValue(), '');
  assert.equal(await page.getByLabel('Done when', { exact: true }).inputValue(), 'Owner confirms.\nWork is delivered.');
  await header.scrollIntoViewIfNeeded();
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `radar-consolidated-details-${width}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
  screenshotPaths.push(screenshotPath);
  process.stdout.write(`SCREENSHOT view=radar-consolidated-details viewport=${width} path=${screenshotPath}\n`);
  for (const control of [header, owner, due, scanner]) {
    await control.scrollIntoViewIfNeeded();
    const bounds = await control.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
      'A consolidated detail control overflows the viewport');
  }
  await owner.fill('');
  await due.fill('');
  await due.press('Tab');
  await page.waitForFunction(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    const item = state?.items.find((entry) => entry.id === id);
    return item?.owner === '' && item?.dueAt == null;
  }, FIXTURE_ITEM_ID);
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  assert.equal(await owner.inputValue(), 'You', 'Cleared owner did not retain the default responsibility');
  assert.equal(await due.inputValue(), '', 'Cleared due date returned after reload');
  const workState = header.getByLabel('Work state', { exact: true });
  await workState.focus();
  assert.equal(await workState.evaluate((element) =>
    parseFloat(getComputedStyle(element.closest('label')).outlineWidth) >= 2), true,
  'Work state lacks visible keyboard focus');
  await workState.press('Home');
  await workState.press('ArrowDown');
  await workState.press('ArrowDown');
  await workState.press('ArrowDown');
  await page.waitForFunction(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state?.items.find((item) => item.id === id)?.lifecycleStatus === 'complete';
  }, FIXTURE_ITEM_ID);
  await openApp(session, { reseed: false });
  await selectFixtureThread(page, 'completed');
  assert.equal(await workState.inputValue(), 'complete', 'Native select completion did not survive reload');
  assert.equal(await header.getByLabel('Criticality', { exact: true }).inputValue(), 'Elevated');
  await assertHealthy(session, width <= 960 ? 'mobile' : 'desktop');
}

async function doneWhenEditingScenario(session, width) {
  const { page } = session;
  await openApp(session);
  await selectFixtureThread(page);
  const textbox = page.getByRole('textbox', { name: 'Done when', exact: true });
  await textbox.scrollIntoViewIfNeeded();
  assert.equal(await textbox.inputValue(), '');
  assert.equal(await textbox.getAttribute('maxlength'), '500');
  await textbox.click();
  assert.equal(await textbox.evaluate((element) => element === document.activeElement), true);
  await textbox.pressSequentially('Legal approves the renewal.');
  await textbox.press('Enter');
  await textbox.pressSequentially('Both parties sign. ');
  const criteria = 'Legal approves the renewal.\nBoth parties sign. ';
  assert.equal(await textbox.inputValue(), criteria, 'Typing lost spaces or line breaks');
  await textbox.press('Tab');
  await page.waitForFunction(async ({ id, expected }) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return state?.items.find((item) => item.id === id)?.doneCriteria === expected;
  }, { id: FIXTURE_ITEM_ID, expected: criteria });

  const back = page.getByTestId('radar-detail-back');
  if (await back.isVisible()) await back.click();
  await page.locator(`.radar-thread:not([data-thread-id="${FIXTURE_ITEM_ID}"])`).first().click();
  assert.notEqual(await textbox.inputValue(), criteria, 'Criteria leaked to another thread');
  if (await back.isVisible()) await back.click();
  await page.locator(`[data-thread-id="${FIXTURE_ITEM_ID}"]`).click();
  await textbox.waitFor({ state: 'visible' });
  assert.equal(await textbox.inputValue(), criteria, 'Criteria were lost after switching threads');

  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  assert.equal(await textbox.inputValue(), criteria, 'Multiline criteria did not survive reload');
  await textbox.fill('');
  await textbox.press('Tab');
  await page.waitForFunction(async (id) => {
    const state = await window.workiq.storeGet('flightdeck.demo.v2');
    return !state?.items.find((item) => item.id === id)?.doneCriteria;
  }, FIXTURE_ITEM_ID);
  await openApp(session, { reseed: false });
  await selectFixtureThread(page);
  assert.equal(await textbox.inputValue(), '', 'Cleared criteria returned after reload');
  await textbox.scrollIntoViewIfNeeded();
  const rectangle = await textbox.boundingBox();
  assert.ok(rectangle && rectangle.x >= 0 && rectangle.x + rectangle.width <= width,
    'Done when textbox overflows the viewport');
  await assertHealthy(session, width <= 760 ? 'mobile' : 'desktop');
}

(async () => {
  let rendererServer;
  let browser;
  try {
    const executablePath = findEdge();
    rendererServer = await startRendererServer();
    browser = await chromium.launch({ executablePath, headless: true });
    process.stdout.write(`EDGE_EXECUTABLE=${executablePath}\nLOCAL_RENDERER=${rendererServer.baseUrl}\n`);
    await runScenario('workiq-queue-status', browser, rendererServer.baseUrl, workiqQueueStatusScenario, {
      queueStatus: { active: 4, pending: 12, limit: 5, backgroundLimit: 4, cooldownUntil: 0 },
    });
    await runScenario('theme-continuity-and-switching', browser, rendererServer.baseUrl, themeScenario);
    await runScenario('scanner-create-and-persist', browser, rendererServer.baseUrl, scannerScenario);
    await runScenario('add-item-submit-persist-reload', browser, rendererServer.baseUrl, addItemPersistScenario);
    await runScenario('scanner-delete-keep-and-reassign', browser, rendererServer.baseUrl, scannerDeletionReassignScenario);
    await runScenario('scanner-delete-all', browser, rendererServer.baseUrl, scannerDeletionDeleteAllScenario);
    await runScenario('scanner-delete-unhydrated-archive', browser, rendererServer.baseUrl, scannerDeletionUnhydratedArchiveScenario);
    await runScenario('context-menu-appearance', browser, rendererServer.baseUrl, contextMenuAppearanceScenario);
    await runScenario('context-menu-interaction', browser, rendererServer.baseUrl, contextMenuInteractionScenario);
    await runScenario('context-menu-persistence', browser, rendererServer.baseUrl, contextMenuPersistenceScenario);
    await runScenario('context-menu-delete', browser, rendererServer.baseUrl, contextMenuDeleteScenario);
    await runScenario('context-menu-drafts', browser, rendererServer.baseUrl, contextMenuDraftScenario);
    await runScenario('context-menu-cold', browser, rendererServer.baseUrl, contextMenuColdScenario);
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
    for (const width of [1440, 760, 360]) {
      await runScenario(`today-dashboard-${width}`, browser, rendererServer.baseUrl,
        session => todayDashboardScenario(session, width),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    for (const width of [1440, 360]) {
      await runScenario(`briefings-automatic-day-${width}`, browser, rendererServer.baseUrl,
        session => automaticBriefingsScenario(session),
        { briefingMode: 'success', viewport: { width, height: 1000 } });
    }
    await runScenario('briefings-automatic-failure-retry', browser, rendererServer.baseUrl,
      session => automaticBriefingsScenario(session, true), { briefingMode: 'fail' });
    await runScenario('today-midnight-rollover', browser, rendererServer.baseUrl, todayRolloverScenario);
    await runScenario('today-empty-states', browser, rendererServer.baseUrl, todayEmptyScenario);
    await runScenario('proposal-missing-address-edit-state', browser, rendererServer.baseUrl, missingAddressScenario, { proposalMode: 'missing-address' });
    await runScenario('proposal-missing-recipient-retains-draft', browser, rendererServer.baseUrl,
      (session) => missingAddressScenario(session, true), { proposalMode: 'missing-recipient' });
    await runScenario('proposal-teams-review-only', browser, rendererServer.baseUrl, teamsReviewScenario, { proposalMode: 'teams' });
    for (const width of [1440, 360]) {
      await runScenario(`work-plan-selected-step-${width}`, browser, rendererServer.baseUrl, workPlanDraftScenario,
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    await runScenario('work-plan-no-recommendations', browser, rendererServer.baseUrl,
      (session) => workPlanDraftScenario(session, true));
    for (const width of [1440, 360]) {
      await runScenario(`work-plan-custom-${width}`, browser, rendererServer.baseUrl, customWorkPlanScenario,
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    await runScenario('work-plan-custom-no-recommendations', browser, rendererServer.baseUrl,
      session => customWorkPlanScenario(session, true));
    for (const channel of ['email', 'teams']) {
      await runScenario(`work-plan-custom-completion-${channel}`, browser, rendererServer.baseUrl,
        session => customWorkPlanCompletionScenario(session, channel));
    }
    for (const width of [1440, 360]) {
      await runScenario(`work-plan-completion-${width}`, browser, rendererServer.baseUrl, workPlanCompletionScenario,
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
    for (const channel of ['email', 'teams']) {
      for (const outcome of channel === 'teams' ? ['cancel', 'unconfirmed', 'failed', 'resolution', 'chat-open'] : ['cancel', 'unconfirmed', 'failed']) {
        await runScenario(`work-plan-${channel}-${outcome}`, browser, rendererServer.baseUrl,
          (session) => workPlanUnfinishedOutcomeScenario(session, channel, outcome));
      }
    }
    await runScenario('teams-resolution-error-mobile', browser, rendererServer.baseUrl,
      (session) => workPlanUnfinishedOutcomeScenario(session, 'teams', 'resolution'),
      { viewport: { width: 360, height: 900 } });
    await runScenario('timeline-legacy-message-unavailable', browser, rendererServer.baseUrl, legacyActionMessageScenario);
    await runScenario('email-inline-create-success', browser, rendererServer.baseUrl, inlineEmailScenario);
    await runScenario('email-inline-incomplete-edits-persist', browser, rendererServer.baseUrl, inlineEmailIncompleteScenario);
    await runScenario('email-inline-cancel', browser, rendererServer.baseUrl,
      (session) => inlineEmailScenario(session, 'cancel'));
    await runScenario('email-inline-unconfirmed', browser, rendererServer.baseUrl,
      (session) => inlineEmailScenario(session, 'unconfirmed'));
    await runScenario('email-inline-mobile', browser, rendererServer.baseUrl, inlineEmailScenario,
      { viewport: { width: 360, height: 900 } });
    await runScenario('proposal-teams-missing-recipient', browser, rendererServer.baseUrl,
      (session) => teamsReviewScenario(session, true), { proposalMode: 'teams-missing-recipient' });
    await runScenario('proposal-concurrent-thread-lifecycle', browser, rendererServer.baseUrl, concurrentThreadDraftsScenario);
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
    for (const width of [1440, 1154, 360]) {
      await runScenario(`radar-clean-workspace-${width}`, browser, rendererServer.baseUrl,
        (session) => radarCleanWorkspaceScenario(session, width),
        { viewport: { width, height: width === 1154 ? 768 : width === 1440 ? 1000 : 900 } });
    }
    await runScenario('radar-filters-short-window', browser, rendererServer.baseUrl,
      session => radarCleanWorkspaceScenario(session, 1154, '-short'),
      { viewport: { width: 1154, height: 600 } });
    for (const width of [1440, 360]) {
      await runScenario(`radar-consolidated-details-${width}`, browser, rendererServer.baseUrl,
        (session) => consolidatedDetailsScenario(session, width),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
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
    await runScenario('radar-activity-responsive-height', browser, rendererServer.baseUrl,
      radarActivityResponsiveHeightScenario,
      { viewport: { width: 1440, height: 700 } });
    await runScenario('radar-rich-context-and-source-links', browser, rendererServer.baseUrl,
      radarRichContextScenario,
      { viewport: { width: 1440, height: 1000 } });
    for (const width of [1440, 360]) {
      await runScenario(`done-when-editing-${width}`, browser, rendererServer.baseUrl,
        (session) => doneWhenEditingScenario(session, width),
        { viewport: { width, height: width === 1440 ? 1000 : 900 } });
    }
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
