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
  const rows = Array.from({ length: 205 }, (_, index) => ({
    ...template,
    id: `inbox_${String(index).padStart(3, '0')}`,
    title: `Generated unread thread ${index}`,
    isNew: true,
    updateHistory: [{
      kind: 'update', timestamp: template.lastChangedAt, summary: 'Generated unread update.', seen: false,
    }],
  }));
  fixture.state.items = rows;
  delete fixture.state.trackingItems;
  delete fixture.state.radarItems;
  fs.writeFileSync(path.join(directory, 'flightdeck-data.json'), JSON.stringify({
    flightdeck: { persisted: { v2: fixture.state } },
  }));
  let electron;
  try {
    const env = { ...process.env, FLIGHTDECK_GENERATED_PROFILE: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({
      executablePath: process.env.FLIGHTDECK_ELECTRON_PATH || require('electron'),
      args: [path.join(__dirname, 'state-reload-electron.cjs')], env, timeout: 30000,
    });
    const page = await electron.firstWindow();
    const errors = [];
    page.on('pageerror', failure => errors.push(failure.message));
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    await expect(page.getByTestId('today-active-count')).toHaveText('205', { timeout: 60000 });
    await page.evaluate(() => {
      window.__inboxSaveBannerInsertions = 0;
      const observer = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE
              && (node.matches('.persistence-banner') || node.querySelector('.persistence-banner'))) {
              window.__inboxSaveBannerInsertions++;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    await expect(page.locator('.radar-thread')).toHaveCount(100);

    async function selectUnreadWithoutJump(expectedPage) {
      const target = page.locator('.radar-thread').nth(20);
      await target.scrollIntoViewIfNeeded();
      const id = await target.getAttribute('data-thread-id');
      const selectedRow = page.locator(`[data-thread-id="${id}"]`);
      const title = await target.locator('strong').innerText();
      await expect(target).toHaveClass(/unread/);
      const before = await page.locator('.radar-thread-list').evaluate(element => ({
        scrollTop: element.scrollTop, firstId: element.firstElementChild.dataset.threadId,
        documentTop: document.scrollingElement.scrollTop,
        listTop: element.getBoundingClientRect().top,
      }));
      assert.ok(before.scrollTop > 0, 'Fixture must exercise an already-scrolled Inbox');
      await target.click();
      await expect(page.locator('.radar-thread-detail h2')).toHaveText(title);
      await expect(selectedRow).not.toHaveClass(/unread/);
      await expect.poll(async () => {
        const item = await page.evaluate(id => window.workiq.stateQuery('getThread', { id }), id);
        return item && !item.isNew && item.updateHistory.every(event => event.seen !== false);
      }).toBe(true);
      const { revision } = await page.evaluate(() => window.workiq.stateQuery('status'));
      await expect.poll(() => electron.evaluate((_context, { offset, revision }) =>
        global.__stateHarness.pageQueries.some(query => query.offset === offset && query.revision >= revision),
      { offset: (expectedPage - 1) * 100, revision })).toBe(true);
      await expect(page.getByRole('navigation', { name: 'Thread pages' })).toContainText(`Page ${expectedPage}`);
      const after = await page.locator('.radar-thread-list').evaluate(element => ({
        scrollTop: element.scrollTop, firstId: element.firstElementChild.dataset.threadId,
        documentTop: document.scrollingElement.scrollTop,
        listTop: element.getBoundingClientRect().top,
      }));
      assert.equal(after.firstId, before.firstId, 'Marking read must not replace the current page');
      assert.ok(Math.abs(after.scrollTop - before.scrollTop) <= 1,
        `Marking read moved the thread list: ${JSON.stringify({ before, after })}`);
      assert.equal(after.documentTop, before.documentTop, 'Selecting a thread must not scroll the application');
      assert.equal(after.listTop, before.listTop, 'Routine saves must not shift the Inbox layout');
      await expect(page.locator('.radar-thread.selected')).toHaveAttribute('data-thread-id', id);
    }

    await selectUnreadWithoutJump(1);
    await page.getByRole('button', { name: 'Next threads', exact: true }).click();
    await expect(page.locator('.radar-thread').first()).toHaveAttribute('data-thread-id', 'inbox_100');
    await selectUnreadWithoutJump(2);
    await page.locator('.radar-thread.selected').focus();
    await page.keyboard.press('ArrowDown');
    const keyboardRow = page.locator('.radar-thread.selected');
    await expect(keyboardRow).toHaveAttribute('data-thread-id', 'inbox_121');
    await expect(keyboardRow).toHaveClass(/unread/);
    await page.keyboard.press('Enter');
    await expect(keyboardRow).not.toHaveClass(/unread/);
    await page.getByTestId('inbox-quick-unread').click();
    await expect(page.getByRole('navigation', { name: 'Thread pages' })).toContainText('Page 1');
    await expect(page.locator('.radar-thread').first()).toHaveAttribute('data-thread-id', 'inbox_000');
    await page.locator('.radar-thread').first().click();
    await expect(page.locator('.radar-thread-detail h2')).toHaveText('Generated unread thread 0');
    await expect(page.locator('.radar-thread').first()).toHaveClass(/unread/);
    assert.equal((await page.evaluate(() => window.workiq.stateQuery('getThread', { id: 'inbox_000' }))).isNew, true,
      'Opening a read-filtered thread must preserve its membership');
    await page.getByTestId('inbox-quick-unread').click();
    for (const firstId of ['inbox_100', 'inbox_200']) {
      await page.getByRole('button', { name: 'Next threads', exact: true }).click();
      await expect(page.locator('.radar-thread').first()).toHaveAttribute('data-thread-id', firstId);
    }
    for (let index = 200; index < 205; index++) {
      const row = page.locator(`[data-thread-id="inbox_${index}"]`);
      await row.click();
      await page.getByTestId('radar-more').click();
      await page.getByTestId('radar-delete').click();
      await page.getByTestId('confirm-submit').click();
      await expect(row).toHaveCount(0);
    }
    await expect(page.getByRole('navigation', { name: 'Thread pages' })).toContainText('Page 2');
    await expect(page.locator('.radar-thread').first()).toHaveAttribute('data-thread-id', 'inbox_100');
    assert.equal(await page.evaluate(() => window.__inboxSaveBannerInsertions), 0,
      'Routine local edits must never insert a save-status banner, even briefly');
    assert.deepEqual(errors, []);
    assert.equal(await electron.evaluate(() => global.__stateHarness.remoteCalls), 0);
    console.log('PASS: unread selection preserves page, list/document scroll and detail; keyboard/unread filters retain their behavior; deleting the last page selects the nearest valid page');
  } finally {
    if (electron) await electron.close();
    removeGeneratedProfile(directory);
  }
}

main().catch(failure => { console.error(failure); process.exitCode = 1; });
