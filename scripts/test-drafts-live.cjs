'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

async function main() {
  const statePath = process.env.FLIGHTDECK_LIVE_STATE_PATH;
  const threadId = process.env.FLIGHTDECK_LIVE_THREAD_ID;
  assert.ok(statePath && threadId, 'Set FLIGHTDECK_LIVE_STATE_PATH and FLIGHTDECK_LIVE_THREAD_ID to opt into read-only live draft testing.');
  const source = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const state = source.flightdeck?.persisted?.v2;
  const item = state?.items?.find((entry) => entry.id === threadId);
  assert.ok(item, 'The requested thread was not found in the source state.');
  const secondId = process.env.FLIGHTDECK_LIVE_SECOND_THREAD_ID;
  const secondItem = secondId ? state.items.find((entry) => entry.id === secondId) : item;
  assert.ok(secondItem && (!secondId || secondId !== threadId), 'The second thread must exist and differ from the first.');
  const requireRecipientEmail = process.env.FLIGHTDECK_LIVE_REQUIRE_RECIPIENT_EMAIL === '1';
  const expectedRecipientEmail = String(process.env.FLIGHTDECK_LIVE_RECIPIENT_EMAIL || '').trim().toLowerCase();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flightdeck-live-drafts-'));
  let application;
  try {
    fs.writeFileSync(path.join(profile, 'flightdeck-data.json'), JSON.stringify({
      flightdeck: { persisted: { v2: {
        items: secondId ? [item, secondItem] : [item], scanners: [], actionProposals: [], history: [],
        meetings: [], connected: false,
      } } },
    }));
    application = await electron.launch({
      args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`],
      timeout: 30000,
    });
    const actualProfile = await application.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(path.resolve(actualProfile).toLowerCase(), path.resolve(profile).toLowerCase(), 'Live testing must use an isolated profile.');
    await application.evaluate(({ app, ipcMain, BrowserWindow }) => {
      app.liveDraftWriteAttempts = [];
      for (const channel of ['create-outlook-draft', 'send-teams-message']) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => {
          app.liveDraftWriteAttempts.push(channel);
          throw new Error('External writes are forbidden during live draft testing.');
        });
      }
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 1000 });
    });
    const page = await application.firstWindow();
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    const select = async (id) => {
      const selector = await page.evaluate((value) => `[data-thread-id="${CSS.escape(value)}"]`, id);
      await page.locator(selector).click();
    };
    const requests = [
      { channel: 'email', item },
      { channel: 'teams', item: secondItem },
    ];
    if (secondId) {
      for (const request of requests) {
        await select(request.item.id);
        request.started = Date.now();
        await page.getByTestId(`radar-draft-${request.channel}`).click();
      }
      await page.waitForFunction((ids) => ids.every((id) =>
        !document.querySelector(`[data-thread-id="${CSS.escape(id)}"] .radar-thread__action-spinner`)
      ), [item.id, secondId], { timeout: 330000 });
    }
    const outcomes = [];
    let emailBody;
    let teamsMessage;
    let teamsRecipientEmail;
    for (const request of requests) {
      const { channel } = request;
      await select(request.item.id);
      const started = request.started || Date.now();
      if (!secondId) {
        await page.getByTestId(`radar-draft-${channel}`).click();
        await page.waitForFunction(() => {
          const busy = document.querySelector('[aria-label="Compose a response"]');
          return busy && busy.getAttribute('aria-busy') === 'false';
        }, null, { timeout: 330000 });
      }
      if (await page.getByTestId('proposal-error').count()) {
        outcomes.push({ channel, status: 'error', elapsedMs: Date.now() - started });
      } else if (await page.getByTestId('proposal-no-communication').count()) {
        outcomes.push({ channel, status: 'no-draft', elapsedMs: Date.now() - started });
      } else if (channel === 'email') {
        const editor = page.getByTestId('email-draft-editor');
        await editor.waitFor({ state: 'visible' });
        assert.equal(await page.getByTestId('action-queue').count(), 0, 'Email generation must stay inline like Teams.');
        const subject = await editor.getByTestId('email-draft-subject').inputValue();
        const body = await editor.getByTestId('email-draft-message').inputValue();
        const recipientEmail = await editor.getByTestId('email-draft-recipient').inputValue();
        assert.ok(subject.trim() && body.trim(), 'The real email draft must have a subject and body.');
        if (requireRecipientEmail) assert.match(recipientEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'The real email draft must include a resolved recipient address.');
        if (expectedRecipientEmail) assert.equal(recipientEmail.trim().toLowerCase(), expectedRecipientEmail, 'Email draft resolved a different recipient than expected.');
        emailBody = body;
        outcomes.push({ channel, status: 'draft-visible', recipientEmailPresent: Boolean(recipientEmail), subjectCharacters: subject.length, bodyCharacters: body.length, elapsedMs: Date.now() - started });
      } else {
        const editor = page.getByTestId('teams-draft-editor');
        await editor.waitFor({ state: 'visible' });
        const message = await editor.locator('textarea').inputValue();
        teamsRecipientEmail = await editor.locator('input[type="email"]').inputValue();
        assert.ok(message.trim(), 'The real Teams draft must contain a message.');
        if (requireRecipientEmail) assert.match(teamsRecipientEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'The real Teams draft must include a resolved recipient address.');
        if (expectedRecipientEmail) assert.equal(teamsRecipientEmail.trim().toLowerCase(), expectedRecipientEmail, 'Teams draft resolved a different recipient than expected.');
        teamsMessage = message;
        outcomes.push({ channel, status: 'draft-visible', recipientEmailPresent: Boolean(teamsRecipientEmail), messageCharacters: message.length, elapsedMs: Date.now() - started });
      }
    }
    assert.deepEqual(await application.evaluate(({ app }) => app.liveDraftWriteAttempts), [], 'Draft generation attempted an external write.');
    console.log('LIVE_DRAFT_OUTCOMES', JSON.stringify(outcomes));
    assert.ok(outcomes.every((outcome) => outcome.status === 'draft-visible'), 'Both channels must generate actual visible drafts, not only return successful API responses.');
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Radar', exact: true }).click();
    await select(item.id);
    assert.equal(await page.getByTestId('email-draft-message').inputValue(), emailBody, 'Email draft did not survive navigation.');
    await select(secondItem.id);
    assert.equal(await page.getByTestId('teams-draft-editor').locator('textarea').inputValue(), teamsMessage, 'Teams draft did not survive navigation.');
    assert.equal(await page.getByTestId('teams-draft-editor').locator('input[type="email"]').inputValue(), teamsRecipientEmail, 'Recipient address did not survive navigation.');
    assert.deepEqual(await application.evaluate(({ app }) => app.liveDraftWriteAttempts), [], 'Navigation attempted an external write.');
    console.log('LIVE_DRAFT_NAVIGATION_PASS', secondId ? 'concurrent-threads' : 'same-thread', 'externalWrites=0');
  } finally {
    if (application) await application.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
