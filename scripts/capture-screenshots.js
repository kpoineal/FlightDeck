#!/usr/bin/env node
// ── Automated screenshot capture for FlightDeck documentation ───────
// Launches the app in demo mode via Playwright's Electron support,
// navigates through each view, and saves screenshots to docs/screenshots/.
//
// Usage:  npm run screenshots
//         node scripts/capture-screenshots.js

const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const DIST_RENDERER = path.join(__dirname, '..', 'dist-renderer');
const ELECTRON_MAIN = path.join(__dirname, '..', 'src', 'main', 'index.js');

// Ensure output directory exists
fs.mkdirSync(OUT_DIR, { recursive: true });

// Check that dist-renderer exists (needs a build first)
if (!fs.existsSync(path.join(DIST_RENDERER, 'app.html'))) {
  console.error('❌ dist-renderer/app.html not found. Run "npm run build:renderer" first.');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function capture(page, name, theme) {
  const filename = `${name}-${theme}.png`;
  const filepath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: filepath, type: 'png' });
  console.log(`  📸 ${filename}`);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('fd-theme', t);
  }, theme);
  await sleep(300); // let CSS transitions settle
}

async function run() {
  console.log('🚀 Launching FlightDeck in demo mode...\n');

  const app = await electron.launch({
    args: [ELECTRON_MAIN, '--demo-reseed'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' },
  });

  const page = await app.firstWindow();

  // Wait for the app to fully load (Svelte mount + data seeding)
  await page.waitForSelector('.app-shell', { timeout: 15000 });
  await sleep(2000); // allow stores to populate and render

  // Set a consistent window size for screenshots
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const theme of ['dark', 'light']) {
    console.log(`\n🎨 Capturing ${theme} theme...\n`);
    await setTheme(page, theme);

    // ── 1. Radar View (default landing) ──────────────────────────
    await page.locator('button.mode-btn:has-text("Radar")').click();
    await sleep(500);
    await capture(page, '01-radar-view', theme);

    // ── 2. KPI Summary Strip (crop to top section) ──────────────
    const strip = page.locator('section.summary-strip');
    if (await strip.isVisible()) {
      await strip.screenshot({ path: path.join(OUT_DIR, `02-summary-strip-${theme}.png`), type: 'png' });
      console.log(`  📸 02-summary-strip-${theme}.png`);
    }

    // ── 3. Tracker card — Activity tab (default) ───────────────
    const firstCard = page.locator('article.tracker-card').first();
    if (await firstCard.isVisible()) {
      // Activity tab is shown by default
      await firstCard.scrollIntoViewIfNeeded();
      await sleep(300);
      await firstCard.screenshot({ path: path.join(OUT_DIR, `03a-tracker-card-activity-${theme}.png`), type: 'png' });
      console.log(`  📸 03a-tracker-card-activity-${theme}.png`);

      // ── 3b. Tracker card — Overview tab ──────────────────────
      const overviewTab = firstCard.locator('button.card-tab').nth(1);
      if (await overviewTab.count() > 0) {
        await overviewTab.click();
        await sleep(300);
        await firstCard.screenshot({ path: path.join(OUT_DIR, `03b-tracker-card-overview-${theme}.png`), type: 'png' });
        console.log(`  📸 03b-tracker-card-overview-${theme}.png`);
      }

      // ── 3c. Tracker card — Monitor tab ───────────────────────
      const monitorTab = firstCard.locator('button.card-tab').nth(2);
      if (await monitorTab.count() > 0) {
        await monitorTab.click();
        await sleep(300);
        await firstCard.screenshot({ path: path.join(OUT_DIR, `03c-tracker-card-monitor-${theme}.png`), type: 'png' });
        console.log(`  📸 03c-tracker-card-monitor-${theme}.png`);
      }

      // Reset to activity tab for clean state
      const activityTab = firstCard.locator('button.card-tab').nth(0);
      if (await activityTab.count() > 0) {
        await activityTab.click();
        await sleep(300);
      }
    }

    // ── 4. Tracker card with NEW UPDATE badge ───────────────────
    const updatedCard = page.locator('article.tracker-card[data-item-new="true"]').first();
    if (await updatedCard.count() > 0 && await updatedCard.isVisible()) {
      await updatedCard.scrollIntoViewIfNeeded();
      await sleep(300);
      await updatedCard.screenshot({ path: path.join(OUT_DIR, `04-tracker-card-updated-${theme}.png`), type: 'png' });
      console.log(`  📸 04-tracker-card-updated-${theme}.png`);
    }

    // ── 5. Briefings View ────────────────────────────────────────
    await page.locator('button.mode-btn:has-text("Briefings")').click();
    await sleep(500);
    await capture(page, '05-briefings-view', theme);

    // ── 6. Individual meeting card ──────────────────────────────
    const meetingCard = page.locator('div.list-card').first();
    if (await meetingCard.isVisible()) {
      await meetingCard.screenshot({ path: path.join(OUT_DIR, `06-meeting-card-${theme}.png`), type: 'png' });
      console.log(`  📸 06-meeting-card-${theme}.png`);
    }

    // ── 7. History View ──────────────────────────────────────────
    await page.locator('button.mode-btn:has-text("History")').click();
    await sleep(500);
    await capture(page, '07-history-view', theme);

    // ── 8. Scanner section header (go back to Radar) ────────────
    await page.locator('button.mode-btn:has-text("Radar")').click();
    await sleep(500);
    const sectionHeader = page.locator('div.radar-section-header').first();
    if (await sectionHeader.isVisible()) {
      await sectionHeader.screenshot({ path: path.join(OUT_DIR, `08-scanner-section-header-${theme}.png`), type: 'png' });
      console.log(`  📸 08-scanner-section-header-${theme}.png`);
    }

    // ── 9. Topbar ────────────────────────────────────────────────
    const topbar = page.locator('header.topbar');
    if (await topbar.isVisible()) {
      await topbar.screenshot({ path: path.join(OUT_DIR, `09-topbar-${theme}.png`), type: 'png' });
      console.log(`  📸 09-topbar-${theme}.png`);
    }

    // ── 10. Scanner Settings Modal ──────────────────────────────
    // Click the gear icon on the first scanner section
    await page.locator('button.mode-btn:has-text("Radar")').click();
    await sleep(500);
    const settingsBtn = page.locator('div.radar-section-header').first().locator('button.icon-btn').nth(3);
    if (await settingsBtn.count() > 0) {
      await settingsBtn.click();
      await sleep(500);
      const modal = page.locator('div.modal.show');
      if (await modal.count() > 0) {
        await modal.locator('div.modal-card').screenshot({ path: path.join(OUT_DIR, `10-scanner-settings-modal-${theme}.png`), type: 'png' });
        console.log(`  📸 10-scanner-settings-modal-${theme}.png`);
        // Close by clicking backdrop (top-left corner of modal overlay)
        await modal.click({ position: { x: 5, y: 5 } });
        await sleep(500);
      }
    }

    // ── 11. Add Task Modal ──────────────────────────────────────
    const addBtn = page.locator('div.radar-section-header').first().locator('button.icon-btn').first();
    if (await addBtn.count() > 0) {
      await addBtn.click();
      await sleep(500);
      const addModal = page.locator('div.modal.show');
      if (await addModal.count() > 0) {
        await addModal.locator('div.modal-card').screenshot({ path: path.join(OUT_DIR, `11-add-task-modal-${theme}.png`), type: 'png' });
        console.log(`  📸 11-add-task-modal-${theme}.png`);
        await addModal.click({ position: { x: 5, y: 5 } });
        await sleep(500);
      }
    }

    // ── 12. Monitor/Schedule controls on a tracker card ─────────
    // Click the gear icon on the first tracker card to show schedule tab
    const cardGear = page.locator('article.tracker-card').first().locator('button.icon-btn-gear, .icon-btn-settings, [title="Settings"], [aria-label="Settings"]').first();
    if (await cardGear.count() > 0) {
      await cardGear.click();
      await sleep(500);
      await capture(page, '12-monitor-controls', theme);
    }
  }

  console.log(`\n✅ Screenshots saved to docs/screenshots/\n`);

  await app.close();
}

run().catch((err) => {
  console.error('❌ Screenshot capture failed:', err.message);
  process.exit(1);
});
