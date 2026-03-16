'use strict';

/**
 * Helper for loading vanilla-JS renderer files into a vm context with
 * minimal browser-API mocks.  These files define globals (no module.exports)
 * so we use vm.runInContext to execute them in a sandboxed context and then
 * read the resulting global functions/variables from that context object.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'src');

/**
 * Create a vm context pre-populated with JS builtins and browser API stubs.
 * Pass `extraGlobals` to inject additional stubs (e.g. `state`, `savePersistentState`).
 */
function createRendererContext(extraGlobals = {}) {
  const ctx = vm.createContext({
    // ── JS builtins (vm contexts start empty) ──
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    RegExp,
    Set,
    Map,
    Boolean,
    Error,
    TypeError,
    RangeError,
    URIError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,

    // ── Minimal browser-API mocks ──
    window: { location: { search: '' } },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    localStorage: {
      _store: {},
      getItem(key) { return this._store[key] ?? null; },
      setItem(key, val) { this._store[key] = String(val); },
      removeItem(key) { delete this._store[key]; },
    },
    alert: () => {},

    // ── Merge caller-supplied globals ──
    ...extraGlobals,
  });

  return ctx;
}

/**
 * Read a file relative to the project root and execute it inside `ctx`.
 * Globals defined by the file become properties of `ctx`.
 */
function loadFile(ctx, relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
  vm.runInContext(code, ctx, { filename: relPath });
}

module.exports = { createRendererContext, loadFile };
