'use strict';

require('./helpers/electron-mock');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { getNodeExecutable, stripAnsi } = require('../src/main/pty-bridge');

/* ------------------------------------------------------------------ */
/*  stripAnsi()                                                        */
/* ------------------------------------------------------------------ */
describe('stripAnsi()', () => {
  it('removes SGR color codes', () => {
    assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  });

  it('removes bold/underline codes', () => {
    assert.equal(stripAnsi('\x1b[1mbold\x1b[22m'), 'bold');
  });

  it('removes cursor movement sequences', () => {
    assert.equal(stripAnsi('\x1b[2Aup two lines'), 'up two lines');
  });

  it('removes OSC title sequences (BEL terminator)', () => {
    assert.equal(stripAnsi('\x1b]0;window title\x07text'), 'text');
  });

  it('removes OSC title sequences (ST terminator)', () => {
    assert.equal(stripAnsi('\x1b]0;window title\x1b\\text'), 'text');
  });

  it('removes C0 control characters', () => {
    assert.equal(stripAnsi('hello\x00\x01\x02world'), 'helloworld');
  });

  it('preserves tabs, newlines, and carriage returns', () => {
    assert.equal(stripAnsi('a\tb\nc\r\nd'), 'a\tb\nc\r\nd');
  });

  it('passes through clean text unchanged', () => {
    assert.equal(stripAnsi('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.equal(stripAnsi(''), '');
  });

  it('removes multiple nested sequences', () => {
    assert.equal(
      stripAnsi('\x1b[1m\x1b[32mbold green\x1b[0m\x1b[39m'),
      'bold green'
    );
  });
});

/* ------------------------------------------------------------------ */
/*  getNodeExecutable()                                                */
/* ------------------------------------------------------------------ */
describe('getNodeExecutable()', () => {

  /**
   * Helper — save listed env vars and restore them after the test.
   */
  function saveAndClearEnv(t, keys) {
    const saved = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    t.after(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    return saved;
  }

  /* -------------------------------------------------------------- */
  /*  win32 — existing .exe resolution behavior                      */
  /* -------------------------------------------------------------- */
  describe('win32 — .exe resolution', () => {
    it('returns npm_node_execpath when it ends in .exe and exists', (t) => {
      const fakePath = 'C:\\fake\\node.exe';
      const saved = process.env.npm_node_execpath;
      process.env.npm_node_execpath = fakePath;
      t.after(() => {
        if (saved === undefined) delete process.env.npm_node_execpath;
        else process.env.npm_node_execpath = saved;
      });

      t.mock.method(fs, 'existsSync', (p) => p === fakePath);
      assert.equal(getNodeExecutable(), fakePath);
    });

    it('uses NODE env var when npm_node_execpath is absent', (t) => {
      const fakePath = 'C:\\custom\\node.exe';
      const savedExec = process.env.npm_node_execpath;
      const savedNode = process.env.NODE;
      delete process.env.npm_node_execpath;
      process.env.NODE = fakePath;
      t.after(() => {
        if (savedExec === undefined) delete process.env.npm_node_execpath;
        else process.env.npm_node_execpath = savedExec;
        if (savedNode === undefined) delete process.env.NODE;
        else process.env.NODE = savedNode;
      });

      t.mock.method(fs, 'existsSync', (p) => p === fakePath);
      assert.equal(getNodeExecutable(), fakePath);
    });

    it('falls back to "node" when no candidate .exe exists on disk', (t) => {
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      t.mock.method(fs, 'existsSync', () => false);
      assert.equal(getNodeExecutable(), 'node');
    });

    it('skips candidates that do not end in .exe', (t) => {
      const savedExec = process.env.npm_node_execpath;
      const savedNode = process.env.NODE;
      process.env.npm_node_execpath = '/usr/bin/node';
      process.env.NODE = '/usr/local/bin/node';
      t.after(() => {
        if (savedExec === undefined) delete process.env.npm_node_execpath;
        else process.env.npm_node_execpath = savedExec;
        if (savedNode === undefined) delete process.env.NODE;
        else process.env.NODE = savedNode;
      });

      // existsSync returns true for everything — non-.exe candidates
      // should still be skipped; only the ProgramFiles candidate passes
      const programFilesCandidate = path.join(
        process.env.ProgramFiles || 'C:\\Program Files',
        'nodejs',
        'node.exe'
      );
      t.mock.method(fs, 'existsSync', () => true);
      assert.equal(getNodeExecutable(), programFilesCandidate);
    });

    it('prefers npm_node_execpath over NODE env var (priority order)', (t) => {
      const first = 'C:\\first\\node.exe';
      const second = 'C:\\second\\node.exe';
      const savedExec = process.env.npm_node_execpath;
      const savedNode = process.env.NODE;
      process.env.npm_node_execpath = first;
      process.env.NODE = second;
      t.after(() => {
        if (savedExec === undefined) delete process.env.npm_node_execpath;
        else process.env.npm_node_execpath = savedExec;
        if (savedNode === undefined) delete process.env.NODE;
        else process.env.NODE = savedNode;
      });

      t.mock.method(fs, 'existsSync', (p) => p === first || p === second);
      assert.equal(getNodeExecutable(), first);
    });

    it('uses process.execPath when env vars are absent and it is .exe', (t) => {
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      // process.execPath on Windows is typically node.exe — mock existsSync
      // to reject the ProgramFiles candidate but accept process.execPath
      t.mock.method(fs, 'existsSync', (p) => p === process.execPath);

      if (process.execPath.toLowerCase().endsWith('.exe')) {
        assert.equal(getNodeExecutable(), process.execPath);
      } else {
        // On non-Windows test runners, execPath won't end in .exe so
        // current code falls through to 'node'
        assert.equal(getNodeExecutable(), 'node');
      }
    });
  });

  /* -------------------------------------------------------------- */
  /*  darwin / linux — cross-platform candidate resolution           */
  /*  These tests validate Viper's cross-platform changes to         */
  /*  pty-bridge.js. On macOS/Linux, candidates should be accepted   */
  /*  WITHOUT requiring a .exe suffix.                               */
  /*  Skipped until the production code is updated.                  */
  /* -------------------------------------------------------------- */
  describe('darwin / linux — cross-platform resolution', () => {
    // Helper to mock process.platform for a single test
    function mockPlatform(t, platform) {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true,
        enumerable: true,
      });
      t.after(() => {
        Object.defineProperty(process, 'platform', descriptor);
      });
    }

    it('accepts npm_node_execpath without .exe suffix on darwin', {
      skip: 'Requires cross-platform getNodeExecutable (Viper PR)',
    }, (t) => {
      mockPlatform(t, 'darwin');
      const unixPath = '/usr/local/bin/node';
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      process.env.npm_node_execpath = unixPath;
      t.mock.method(fs, 'existsSync', (p) => p === unixPath);
      assert.equal(getNodeExecutable(), unixPath);
    });

    it('accepts npm_node_execpath without .exe suffix on linux', {
      skip: 'Requires cross-platform getNodeExecutable (Viper PR)',
    }, (t) => {
      mockPlatform(t, 'linux');
      const unixPath = '/usr/bin/node';
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      process.env.npm_node_execpath = unixPath;
      t.mock.method(fs, 'existsSync', (p) => p === unixPath);
      assert.equal(getNodeExecutable(), unixPath);
    });

    it('accepts NODE env path without .exe suffix on darwin', {
      skip: 'Requires cross-platform getNodeExecutable (Viper PR)',
    }, (t) => {
      mockPlatform(t, 'darwin');
      const unixPath = '/opt/homebrew/bin/node';
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      process.env.NODE = unixPath;
      t.mock.method(fs, 'existsSync', (p) => p === unixPath);
      assert.equal(getNodeExecutable(), unixPath);
    });

    it('accepts process.execPath without .exe suffix on darwin', {
      skip: 'Requires cross-platform getNodeExecutable (Viper PR)',
    }, (t) => {
      mockPlatform(t, 'darwin');
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      const fakeExecPath = '/usr/local/bin/node';
      const origExecPath = process.execPath;
      // Override process.execPath for this test
      Object.defineProperty(process, 'execPath', {
        value: fakeExecPath,
        configurable: true,
      });
      t.after(() => {
        Object.defineProperty(process, 'execPath', {
          value: origExecPath,
          configurable: true,
        });
      });
      // Only accept the execPath, not ProgramFiles or unix common paths
      t.mock.method(fs, 'existsSync', (p) => p === fakeExecPath);
      assert.equal(getNodeExecutable(), fakeExecPath);
    });

    it('falls back to "node" on darwin when no candidates exist', (t) => {
      mockPlatform(t, 'darwin');
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      t.mock.method(fs, 'existsSync', () => false);
      assert.equal(getNodeExecutable(), 'node');
    });

    it('falls back to "node" on linux when no candidates exist', (t) => {
      mockPlatform(t, 'linux');
      saveAndClearEnv(t, ['npm_node_execpath', 'NODE']);
      t.mock.method(fs, 'existsSync', () => false);
      assert.equal(getNodeExecutable(), 'node');
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Notes: module-level workiq resolution                              */
/*  The workiq path resolution runs at require() time (module top     */
/*  level). Testing cross-platform behavior (workiqMode='system' on   */
/*  macOS/Linux) would require re-requiring the module with mocked    */
/*  process.platform and fs.existsSync BEFORE the module loads.       */
/*  Deferred to integration testing once Viper's cross-platform PR    */
/*  lands.                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Notes: runWorkiqCommand()                                          */
/*  This function spawns a real PTY process and depends on node-pty   */
/*  and the workiq CLI being installed. Integration testing requires  */
/*  a running Electron environment. Deferred to Phase 5 Part 2.      */
/* ------------------------------------------------------------------ */
