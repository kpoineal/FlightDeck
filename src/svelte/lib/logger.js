// ── FlightDeck structured logger ────────────────────────────────────
// Rotating memory buffer with optional electron-store persistence.
// Access from devtools: window.__flightdeck_log

const MAX_ENTRIES = 500;
const PERSIST_KEY = 'flightdeck.engine-log';
const PERSIST_MAX = 200; // persist fewer entries than memory to keep store small

const buffer = [];

/**
 * Log a structured entry.
 * @param {'scanner'|'monitor'|'briefing'|'persist'|'app'} source
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [meta] Optional structured metadata
 */
export function log(source, level, message, meta = null) {
  const entry = {
    t: new Date().toISOString(),
    src: source,
    lvl: level,
    msg: message,
  };
  if (meta) entry.meta = meta;

  buffer.unshift(entry);
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;

  // Mirror to devtools console with prefix
  const prefix = `[flightdeck:${source}]`;
  if (level === 'error') console.error(prefix, message, meta || '');
  else if (level === 'warn') console.warn(prefix, message, meta || '');
  else console.log(prefix, message, meta || '');
}

/** Convenience wrappers */
export const logInfo = (source, message, meta) => log(source, 'info', message, meta);
export const logWarn = (source, message, meta) => log(source, 'warn', message, meta);
export const logError = (source, message, meta) => log(source, 'error', message, meta);

/** Get the current log buffer (newest first). */
export function getLog() {
  return buffer;
}

/** Persist a trimmed copy to electron-store (call periodically, not on every log). */
export async function persistLog() {
  if (!window.workiq || typeof window.workiq.storeSet !== 'function') return;
  try {
    const trimmed = buffer.slice(0, PERSIST_MAX);
    await window.workiq.storeSet(PERSIST_KEY, trimmed);
  } catch (_) { /* non-critical */ }
}

/** Load persisted log entries on startup (merged below current session). */
export async function loadPersistedLog() {
  if (!window.workiq || typeof window.workiq.storeGet !== 'function') return;
  try {
    const stored = await window.workiq.storeGet(PERSIST_KEY);
    if (Array.isArray(stored)) {
      // Append old entries after current session entries
      const existingTimes = new Set(buffer.map(e => e.t));
      for (const entry of stored) {
        if (!existingTimes.has(entry.t)) {
          buffer.push(entry);
        }
      }
      if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
    }
  } catch (_) { /* non-critical */ }
}

// Expose to devtools for debugging
if (typeof window !== 'undefined') {
  window.__flightdeck_log = getLog;
}
