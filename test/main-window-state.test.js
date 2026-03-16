'use strict';

const { electronMock } = require('./helpers/electron-mock');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { isStateOnScreen } = require('../src/main/window-state');

/* ------------------------------------------------------------------ */
/*  isStateOnScreen()                                                  */
/* ------------------------------------------------------------------ */
describe('isStateOnScreen()', () => {
  beforeEach(() => {
    // Default: single 1920×1080 display at origin
    electronMock.screen.getAllDisplays = () => [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    ];
  });

  it('returns true when window is fully on-screen', () => {
    const state = { bounds: { x: 100, y: 100, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), true);
  });

  it('returns true when window partially overlaps the display', () => {
    const state = { bounds: { x: -100, y: -100, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), true);
  });

  it('returns false when window is completely off-screen to the right', () => {
    const state = { bounds: { x: 5000, y: 500, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), false);
  });

  it('returns false when window is completely above the display', () => {
    const state = { bounds: { x: 100, y: -700, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), false);
  });

  it('returns false when window is completely to the left', () => {
    const state = { bounds: { x: -900, y: 100, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), false);
  });

  it('returns false when window is completely below the display', () => {
    const state = { bounds: { x: 100, y: 2000, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), false);
  });

  it('detects overlap on a second monitor', () => {
    electronMock.screen.getAllDisplays = () => [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ];
    const state = { bounds: { x: 2000, y: 100, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), true);
  });

  it('returns false when no displays exist', () => {
    electronMock.screen.getAllDisplays = () => [];
    const state = { bounds: { x: 0, y: 0, width: 800, height: 600 } };
    assert.equal(isStateOnScreen(state), false);
  });

  it('returns true for a 1×1 window at screen origin', () => {
    const state = { bounds: { x: 0, y: 0, width: 1, height: 1 } };
    assert.equal(isStateOnScreen(state), true);
  });
});

/* ------------------------------------------------------------------ */
/*  Notes: loadWindowState / saveWindowState / debouncedSaveWindowState */
/*  These depend on Electron app.getPath() and fs read/write with     */
/*  real file paths. Full integration tests would require either:     */
/*    - A temp-dir fixture with a mock app object, or                 */
/*    - Running inside Electron via electron-mocha / spectron.        */
/*  Skipped for now — flagged for Phase 5 Part 2 integration tests.  */
/* ------------------------------------------------------------------ */
