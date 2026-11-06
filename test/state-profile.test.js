const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  generateStateProfile, createGeneratedProfile, assertGeneratedProfile, removeGeneratedProfile,
} = require('./fixtures/state-profile');

it('generates deterministic large histories and intentional source collisions without item ID collisions', async () => {
  const first = generateStateProfile({ size: 'large', collisions: true });
  const second = generateStateProfile({ size: 'large', collisions: true });
  assert.deepEqual(first, second);
  assert.equal(first.state.items.length, 500);
  assert.equal(first.cold.length, 5000);
  assert.equal(first.state.items[0].updateHistory.length, 40);
  assert.equal(first.state.items[0].sourceId, first.state.items[1].sourceId);
  assert.equal(new Set([...first.state.items, ...first.cold].map(item => item.id)).size, 5500);
  const { normalizeItem } = await import('../src/svelte/lib/models/item.js');
  const item = normalizeItem(first.state.items[0]);
  assert.equal(item.id, first.state.items[0].id);
  assert.equal(item.lifecycleStatus, 'in-progress');
  assert.equal(item.updateHistory.length, 40);
  assert.equal(item.monitorEnabled, false);
  assert.ok(item.sourceIdentities.length > 0);
});

it('isolates hot, demo, cold and browser profile data and only deletes its generated directory', () => {
  const first = createGeneratedProfile({ size: 'small' });
  const second = createGeneratedProfile({ size: 'small' });
  try {
    assert.notEqual(first.directory, second.directory);
    const data = JSON.parse(fs.readFileSync(path.join(first.directory, 'flightdeck-data.json'), 'utf8'));
    assert.equal(data.flightdeck.persisted.v2.items.length, 100);
    assert.equal(data.flightdeck.demo.v2.items.length, 100);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.directory, 'flightdeck-cold.json'), 'utf8')), { items: [] });
    assert.throws(() => assertGeneratedProfile(path.resolve(__dirname, '..')));
    assert.throws(() => removeGeneratedProfile(path.resolve(__dirname, '..', 'test-results', 'state-reload')));
  } finally {
    removeGeneratedProfile(first.directory);
    assert.ok(fs.existsSync(second.directory));
    removeGeneratedProfile(second.directory);
  }
});

it('generates the actual 1.0.3 persisted-v2 shape separately, without modern aliases or a cold store', () => {
  const { directory, fixture } = createGeneratedProfile({ legacy103: true });
  try {
    const data = JSON.parse(fs.readFileSync(path.join(directory, 'flightdeck-data.json'), 'utf8'));
    assert.deepEqual(Object.keys(data.flightdeck), ['persisted']);
    assert.deepEqual(Object.keys(data.flightdeck.persisted.v2), [
      'trackingItems', 'briefingsByMeetingId', 'briefingSeenAt', 'history',
      'connected', 'trackingDensity', 'radarDensity',
    ]);
    assert.equal(fixture.state.trackingItems.length, 3);
    assert.equal(Object.hasOwn(fixture.state, 'items'), false);
    assert.equal(Object.hasOwn(fixture.state.trackingItems[0], 'lifecycleStatus'), false);
    assert.equal(fs.existsSync(path.join(directory, 'flightdeck-cold.json')), false);
  } finally {
    removeGeneratedProfile(directory);
  }
});
