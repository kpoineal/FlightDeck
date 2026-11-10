'use strict';

const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], {
    env, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', error => {
    console.error('Local WorkIQ CLI live validation could not start:', error.code);
    process.exitCode = 1;
  });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  const { app } = require('electron');
  const { createWorkiqCliClient } = require('../src/main/workiq-cli-client');

  async function main() {
    await app.whenReady();
    const client = createWorkiqCliClient();
    try {
      assert.equal((await client.probe()).ok, true);
      const root = path.resolve(__dirname, '..');
      const prompts = await import(pathToFileURL(path.join(root, 'src', 'svelte', 'lib', 'prompts.js')));
      const { runWorkiqJson } = await import(pathToFileURL(path.join(root, 'src', 'svelte', 'lib', 'json-parser.js')));
      const item = {
        id: 'local-cli-live-check',
        title: 'Recent customer commitments requiring follow-up',
        summary: 'Review recent commitments in Microsoft 365 and report any unresolved follow-ups.',
        status: 'In Progress', severity: 'Observe',
        trackedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      };
      const scanner = {
        id: 'local-cli-live-check', name: 'Recent commitments',
        prompt: 'Find recent Microsoft 365 emails or chats from the past 48 hours that contain commitments needing my attention.',
        maxItemsPerScan: 2,
      };
      const checks = [
        ['monitor', prompts.buildMonitorPrompt(item),
          result => result && typeof result.summary === 'string' && typeof result.status === 'string'],
        ['day-briefing', prompts.buildDayBriefingPrompt([item], [], {},
          fs.readFileSync(path.join(root, 'src', 'prompts', 'day-briefing.md'), 'utf8')),
          result => result && typeof result.headline === 'string'],
        ['scanner', prompts.buildScannerPrompt(scanner, [], []),
          result => result && Array.isArray(result.radarItems)],
      ];
      globalThis.window = { workiq: { ask: client.ask } };
      const outcomes = await Promise.allSettled(checks.map(async ([label, prompt, validator]) => {
        const started = Date.now();
        const result = await runWorkiqJson(prompt, validator, label);
        assert.ok(validator(result), `${label} did not match its production response shape`);
        console.log(JSON.stringify({ workflow: label, passed: true, elapsedMs: Date.now() - started }));
      }));
      const failure = outcomes.find(outcome => outcome.status === 'rejected');
      if (failure) throw failure.reason;
      const synthesis = await client.proposeThreadActions({
        schemaVersion: 1,
        thread: { id: item.id, title: item.title, summary: item.summary },
      });
      assert.equal(synthesis.ok, true, `Proposal synthesis failed: ${synthesis.code}`);
      console.log('Local CLI live validation passed: monitor, day briefing, scanner, proposal synthesis; no external writes.');
    } finally {
      delete globalThis.window;
      await client.shutdown();
    }
  }

  main().then(() => app.exit(0), error => {
    console.error('Local CLI live validation failed:', error.code || 'VALIDATION_FAILED');
    app.exit(1);
  });
}
