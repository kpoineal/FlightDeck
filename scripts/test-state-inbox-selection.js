'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const { createGeneratedProfile, removeGeneratedProfile } = require('../test/fixtures/state-profile');

async function main() {
  const { directory, fixture } = createGeneratedProfile({ size: 'small' });
  const template = fixture.state.items[0];
  fixture.state.items = Array.from({ length: 605 }, (_, index) => ({
    ...template, id: `selection_${String(index).padStart(3, '0')}`,
    title: `Selection thread ${index}`, isNew: true,
    updateHistory: [{ kind: 'update', timestamp: template.lastChangedAt, summary: 'Unread update', seen: false }],
  }));
  delete fixture.state.trackingItems;
  delete fixture.state.radarItems;
  fs.writeFileSync(path.join(directory, 'flightdeck-data.json'), JSON.stringify({
    flightdeck: { persisted: { v2: fixture.state } },
  }));
  let electron;
  let completed = false;
  try {
    const env = { ...process.env, FLIGHTDECK_GENERATED_PROFILE: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({
      executablePath: process.env.FLIGHTDECK_ELECTRON_PATH || require('electron'),
      args: [path.join(__dirname, 'state-reload-electron.cjs')], env, timeout: 30000,
    });
    const page = await electron.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    await expect(page.getByTestId('today-active-count')).toHaveText('605', { timeout: 60000 });
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    const rows = page.locator('.radar-thread');
    const row = index => page.locator(`[data-thread-id="selection_${String(index).padStart(3, '0')}"]`);
    const selected = () => page.locator('.radar-thread[aria-pressed="true"]');
    const selectPage = async () => {
      await rows.first().focus();
      await page.keyboard.press('Control+a');
    };
    const requestDelete = async () => {
      await selected().first().focus();
      await page.keyboard.press('Delete');
    };
    const saved = index => page.evaluate(id => window.workiq.stateQuery('getThread', { id }),
      `selection_${String(index).padStart(3, '0')}`);
    await expect(rows).toHaveCount(100);
    await expect(page.locator('.radar-thread-list input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('.inbox-selection-bar')).toHaveCount(0);

    await row(0).click({ modifiers: ['Control'] });
    await row(2).click({ modifiers: ['Meta'] });
    await expect(selected()).toHaveCount(2);
    await expect(page.locator('.radar-thread.selected')).toHaveCount(2);
    await expect(row(0)).toHaveClass(/unread/);
    await expect(row(2)).toHaveClass(/unread/);
    await expect(page.locator('.radar-thread-detail h2')).toHaveCount(0);
    await row(0).click({ modifiers: ['Control'] });
    await expect(selected()).toHaveCount(1);
    await row(4).click({ modifiers: ['Shift'] });
    await expect(selected()).toHaveCount(5);
    await expect(row(4)).toHaveClass(/unread/);
    await row(4).focus();
    await page.keyboard.press('Shift+ArrowUp');
    await expect(selected()).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(selected()).toHaveCount(0);
    await row(7).click();
    await expect(selected()).toHaveCount(1);
    await expect(page.locator('.radar-thread-detail h2')).toHaveText('Selection thread 7');
    await expect(row(7)).not.toHaveClass(/unread/);
    await row(7).focus();
    await page.keyboard.press('Control+a');
    await expect(selected()).toHaveCount(100);
    await page.getByRole('button', { name: 'Next threads', exact: true }).click();
    await expect(row(100)).toBeVisible();
    await expect(selected()).toHaveCount(0);
    await selectPage();
    await expect(selected()).toHaveCount(100);
    await page.getByTestId('inbox-quick-unread').click();
    await expect(row(0)).toBeVisible();
    await expect(selected()).toHaveCount(0);
    await page.getByTestId('inbox-quick-unread').click();
    await selectPage();
    await page.locator('#radar-search').fill('Selection thread 604');
    await expect(rows).toHaveCount(1);
    await expect(selected()).toHaveCount(0);
    await selectPage();
    await page.locator('#radar-search').fill('');
    await expect(rows).toHaveCount(100);
    await expect(selected()).toHaveCount(0);
    await selectPage();
    await page.locator('#radar-scanner').selectOption('scanner_1');
    await expect(rows).toHaveCount(0);
    await expect(selected()).toHaveCount(0);
    await page.locator('#radar-scanner').selectOption('all');
    await expect(rows).toHaveCount(100);
    await selectPage();
    await page.locator('#radar-sort').selectOption('priority');
    await expect(selected()).toHaveCount(0);
    await page.locator('#radar-sort').selectOption('recent');
    await selectPage();
    await page.getByTestId('radar-view-priority').click();
    await expect(selected()).toHaveCount(0);
    await page.getByTestId('radar-view-inbox').click();
    await expect(rows).toHaveCount(100);

    // The last page lies beyond the startup cache and must hydrate before deletion.
    for (let offset = 100; offset <= 600; offset += 100) {
      await page.getByRole('button', { name: 'Next threads', exact: true }).click();
      await expect(row(offset)).toBeVisible();
    }
    await row(600).click({ modifiers: ['Control'] });
    await row(601).click({ modifiers: ['Control'] });
    // Both rows are outside the startup cache: non-delete menu actions must hydrate too.
    const originalSeverity = (await saved(600)).severity;
    await electron.evaluate(() => { global.__stateHarness.failThreadReadId = 'selection_601'; });
    await row(600).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change criticality (2 selected cards)', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Elevated', exact: true }).click();
    await expect(page.locator('.toast').filter({ hasText: 'No cards changed. Could not load every target' })).toBeVisible();
    assert.equal((await saved(600)).severity, originalSeverity);
    await expect(selected()).toHaveCount(2);
    await electron.evaluate(() => { global.__stateHarness.failThreadReadId = null; });
    await row(600).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change criticality (2 selected cards)', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Elevated', exact: true }).click();
    await expect.poll(async () => (await saved(601))?.severity).toBe('Elevated');
    assert.equal((await saved(600)).severity, 'Elevated');
    await expect(selected()).toHaveCount(2);
    await row(600).focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('confirm-modal')).toContainText('Delete 2 cards from FlightDeck?');
    await expect(page.getByTestId('confirm-modal')).toContainText('does not delete source email');
    await page.getByTestId('confirm-cancel').click();
    await expect(selected()).toHaveCount(2);
    assert.ok(await saved(600), 'Cancel must preserve durable records');
    await expect(row(600)).toBeFocused();
    await expect(row(600)).toHaveClass(/unread/);
    await row(600).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete 2 selected cards…', exact: true }).click();
    await page.getByTestId('confirm-submit').click();
    await expect(row(600)).toHaveCount(0);
    await expect(row(601)).toHaveCount(0);
    await expect(selected()).toHaveCount(0);
    assert.equal(await saved(600), null);
    assert.equal(await saved(601), null);

    // Fail a later hydration: successful earlier deletions stay committed; remaining rows stay selected.
    await selectPage();
    await electron.evaluate(() => { global.__stateHarness.failThreadReadId = 'selection_603'; });
    await requestDelete();
    await page.getByTestId('confirm-submit').click();
    await expect(page.getByTestId('radar-delete-error')).toContainText('1 of 3 cards deleted');
    await expect(row(602)).toHaveCount(0);
    await expect(selected()).toHaveCount(2);
    assert.equal(await saved(602), null);
    await electron.evaluate(() => {
      global.__stateHarness.failThreadReadId = null;
      global.__stateHarness.holdThreadReadId = 'selection_603';
    });
    await requestDelete();
    await page.getByTestId('confirm-submit').click();
    await expect(rows.first()).toBeDisabled();
    await expect.poll(() => electron.evaluate(() => typeof global.__stateHarness.releaseThreadRead)).toBe('function');
    await electron.evaluate(() => {
      global.__stateHarness.holdThreadReadId = null;
      global.__stateHarness.releaseThreadRead();
    });
    await expect(row(603)).toHaveCount(0);
    await expect(row(604)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Thread pages' })).toContainText('Page 6');
    await expect(selected()).toHaveCount(0);

    for (const index of [502, 503, 504]) await row(index).click({ modifiers: ['Control'] });
    await electron.evaluate(() => { global.__stateHarness.failDeletionOnceId = 'selection_503'; });
    await requestDelete();
    await page.getByTestId('confirm-submit').click();
    await expect(page.getByTestId('radar-delete-error')).toContainText('1 of 3 cards deleted');
    await expect(selected()).toHaveCount(2);
    assert.equal(await saved(502), null);
    assert.ok(await saved(503), 'A rejected durable deletion must roll back the failed card');
    assert.ok(await saved(504), 'Deletion must stop before attempting the remaining card');
    await requestDelete();
    await page.getByTestId('confirm-submit').click();
    await expect(row(503)).toHaveCount(0);
    await expect(row(504)).toHaveCount(0);
    await expect(selected()).toHaveCount(0);

    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(390, 844));
    await expect(page.locator('.radar-thread-list input[type="checkbox"]')).toHaveCount(0);
    await row(505).click({ modifiers: ['Control'] });
    await row(506).click({ modifiers: ['Control'] });
    await expect(selected()).toHaveCount(2);
    await requestDelete();
    await page.getByTestId('confirm-cancel').click();
    await page.keyboard.press('Escape');
    await expect(selected()).toHaveCount(0);
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));

    await row(500).click();
    await page.getByTestId('radar-more').click();
    await page.getByTestId('radar-delete').click();
    await expect(page.getByTestId('confirm-modal')).toContainText('Delete card from FlightDeck?');
    await page.getByTestId('confirm-submit').click();
    await expect(row(500)).toHaveCount(0);
    await row(501).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete from FlightDeck…', exact: true }).click();
    await page.getByTestId('confirm-submit').click();
    await expect(row(501)).toHaveCount(0);

    await row(505).click();
    await page.getByRole('button', { name: 'Previous threads', exact: true }).click();
    await expect(row(400)).toBeVisible();
    await expect(selected()).toHaveCount(0);
    await expect(page.locator('.radar-thread-detail h2')).toHaveText('Selection thread 505');
    await expect(page.locator('.radar-thread[tabindex="0"]')).toHaveCount(1);
    await page.getByTestId('radar-more').click();
    await page.getByTestId('radar-delete').click();
    await expect(page.getByTestId('confirm-modal')).toContainText('Selection thread 505');
    await page.getByTestId('confirm-submit').click();
    await expect.poll(() => saved(505)).toBe(null);

    await page.reload();
    await expect(page.getByTestId('today-active-count')).toHaveText('594', { timeout: 60000 });
    for (const index of [500, 501, 502, 503, 504, 505, 600, 601, 602, 603, 604]) assert.equal(await saved(index), null);
    assert.ok(await saved(599), 'Unselected records must survive bulk deletion and reload');
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    const menuAction = async (index, label, child) => {
      await row(index).click({ button: 'right' });
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      if (child) await page.getByRole('menuitem', { name: child, exact: true }).click();
    };
    const view = async name => {
      await page.getByTestId('radar-more-views').click();
      await page.getByTestId(`radar-view-${name}`).click();
    };
    // Keep details open while adding a second row: neither draft route may collapse selection.
    await row(10).click();
    await row(11).click({ modifiers: ['Control'] });
    await expect(selected()).toHaveCount(2);
    for (const channel of ['email', 'teams']) {
      await expect(page.getByTestId(`radar-draft-${channel}`)).toBeDisabled();
      await expect(page.getByTestId(`radar-draft-${channel}`)).toHaveAttribute('title', 'Select one thread to draft a message.');
    }
    await row(10).click({ button: 'right' });
    for (const id of ['draft:email', 'draft:teams']) {
      const entry = page.locator(`[data-menu-id="${id}"]`);
      await expect(entry).toBeDisabled();
      await expect(entry).toHaveAttribute('title', 'Select one thread to draft a message.');
    }
    await page.keyboard.press('Escape');
    await expect(selected()).toHaveCount(2);
    await menuAction(11, 'Mark read (2 selected cards)');
    await expect.poll(async () => (await saved(11))?.isNew).toBe(false);
    assert.equal((await saved(10)).hasNewUpdate, false);
    await expect(selected()).toHaveCount(2);
    await menuAction(10, 'Mark unread (2 selected cards)');
    await expect.poll(async () => (await saved(11))?.hasNewUpdate).toBe(true);
    assert.equal((await saved(10)).hasNewUpdate, true);
    // An unselected row remains a single-card operation without clearing the multi-selection.
    await menuAction(12, 'Change criticality', 'Critical');
    await expect.poll(async () => (await saved(12))?.severity).toBe('Critical');
    await expect(selected()).toHaveCount(2);
    await menuAction(10, 'Change criticality (2 selected cards)', 'Elevated');
    await expect.poll(async () => (await saved(11))?.severity).toBe('Elevated');
    assert.equal((await saved(10)).severity, 'Elevated');
    await electron.evaluate(() => { global.__stateHarness.rejectWrites = true; });
    await menuAction(10, 'Change criticality (2 selected cards)', 'Critical');
    await expect(page.locator('.toast').filter({ hasText: '0 of 2 cards confirmed saved. Changes may remain unsaved locally' })).toBeVisible();
    assert.equal((await saved(10)).severity, 'Elevated');
    assert.equal((await saved(11)).severity, 'Elevated');
    await expect(selected()).toHaveCount(2);
    await electron.evaluate(() => { global.__stateHarness.rejectWrites = false; });
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect.poll(async () => (await saved(10))?.severity).toBe('Critical');
    assert.equal((await saved(11)).severity, 'Elevated', 'Stop before the second target on an unacknowledged save');
    await row(10).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change criticality (2 selected cards)', exact: true }).click();
    await expect(page.locator('[data-menu-id^="severity:"][aria-current="true"]')).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Elevated', exact: true }).click();
    await expect.poll(async () => (await saved(10))?.severity).toBe('Elevated');
    await row(10).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change criticality (2 selected cards)', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Elevated', exact: true })).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await menuAction(10, 'Change work status (2 selected cards)', 'Blocked');
    await expect.poll(async () => (await saved(11))?.lifecycleStatus).toBe('blocked');
    assert.equal((await saved(10)).lifecycleStatus, 'blocked');
    await expect(selected()).toHaveCount(2);
    // Removing the first row from this view must not drop the second captured target.
    await menuAction(10, 'Snooze for 24 hours (2 selected cards)');
    await expect(row(10)).toHaveCount(0);
    await expect(row(11)).toHaveCount(0);
    await view('snoozed');
    await expect(rows).toHaveCount(2);
    await selectPage();
    await menuAction(10, 'Unsnooze (2 selected cards)');
    await expect(rows).toHaveCount(0);
    assert.equal((await saved(10)).snoozeUntil, null);
    assert.equal((await saved(11)).snoozeUntil, null);
    await page.getByTestId('radar-view-inbox').click();
    await expect(row(10)).toBeVisible();
    await row(10).click({ modifiers: ['Control'] });
    await row(11).click({ modifiers: ['Control'] });
    await menuAction(10, 'Archive (2 selected cards)');
    await expect(row(10)).toHaveCount(0);
    await expect(row(11)).toHaveCount(0);
    await view('archived');
    await expect(rows).toHaveCount(2);
    await selectPage();
    await menuAction(10, 'Restore to In Progress (2 selected cards)');
    await expect(rows).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('today-active-count')).toHaveText('594', { timeout: 60000 });
    for (const index of [10, 11]) {
      const item = await saved(index);
      assert.equal(item.lifecycleStatus, 'in-progress');
      assert.equal(item.severity, 'Elevated');
      assert.equal(item.snoozeUntil, null);
      assert.equal(item.hasNewUpdate, true);
    }
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    await row(10).click();
    await expect(page.getByTestId('radar-draft-email')).not.toHaveAttribute('title', 'Select one thread to draft a message.');
    await row(10).focus();
    await page.keyboard.press('Escape');
    for (const index of [0, 1, 2]) await row(index).click({ modifiers: ['Control'] });
    await electron.evaluate(() => { global.__stateHarness.loseDeletionAckId = 'selection_001'; });
    await requestDelete();
    await page.getByTestId('confirm-submit').click();
    await expect(page.getByTestId('radar-delete-error')).toContainText('Reload before trying again');
    await requestDelete();
    await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
    await expect(row(2)).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await saved(0), null);
    assert.equal(await saved(1), null, 'A lost acknowledgement can conceal a committed deletion');
    assert.ok(await saved(2), 'Recovery-required must stop before the next selected card');
    await page.reload();
    await expect(page.getByTestId('today-active-count')).toHaveText('592', { timeout: 60000 });
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    await row(2).click();
    await expect.poll(async () => (await saved(2))?.isNew).toBe(false);
    assert.deepEqual(errors, []);
    assert.equal(await electron.evaluate(() => global.__stateHarness.remoteCalls), 0);
    completed = true;
    console.log('PASS: checkbox-free selection; bulk read/status/criticality/snooze/archive and deletion; aggregate menu indicators; draft guards; outside-selection targeting; off-cache hydration; load/save failure and retry; page/filter safety; reload durability; no remote writes');
  } finally {
    if (electron && !completed) await electron.evaluate(({ app }) => app.exit(1)).catch(() => {});
    await electron?.close().catch(error => { if (completed) throw error; });
    removeGeneratedProfile(directory);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
