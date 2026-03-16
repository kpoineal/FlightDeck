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
    const keys = ['npm_node_execpath', 'NODE'];
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
});

/* ------------------------------------------------------------------ */
/*  Notes: runWorkiqCommand()                                          */
/*  This function spawns a real PTY process and depends on node-pty   */
/*  and the workiq CLI being installed. Integration testing requires  */
/*  a running Electron environment. Deferred to Phase 5 Part 2.      */
/* ------------------------------------------------------------------ */
