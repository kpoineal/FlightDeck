'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { createGeneratedProfile, removeGeneratedProfile } = require('../test/fixtures/state-profile');
const packaged = process.argv.includes('--packaged');
const executablePath = process.env.FLIGHTDECK_ELECTRON_PATH || require('electron');
const { directory } = createGeneratedProfile({ size: process.argv.includes('--large') ? 'large' : 'small' });
try {
  const env = {
    ...process.env, FLIGHTDECK_GENERATED_PROFILE: directory,
    FLIGHTDECK_GENERATED_ROOT: path.dirname(directory),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(executablePath, packaged ? [] : [path.join(__dirname, 'state-sqlite-electron.cjs')], {
    env, timeout: 120000, encoding: 'utf8',
  });
  const file = path.join(directory, 'sqlite-runtime-result.json');
  if (!fs.existsSync(file)) throw new Error(`Runtime did not report: exit=${result.status}, error=${result.error?.code || 'none'}, stderr=${result.stderr?.slice(-1500)}`);
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const output = path.join(__dirname, '..', 'test-results', 'state-reload',
    packaged ? 'sqlite-package-runtime.json' : 'sqlite-locked-runtime.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.equal(report.ok, true);
  assert.equal(report.packaged, packaged);
  assert.equal(report.renderer.bridge, true);
  console.log(JSON.stringify({ ok: true, packaged, runtime: report.status.runtime, threads: report.status.counts.threads,
    renderer: report.renderer, report: path.relative(path.resolve(__dirname, '..'), output) }));
} finally { removeGeneratedProfile(directory); }
