const { createStateDiagnostics } = require('../shared/state-diagnostics.mjs');
const diagnostics = createStateDiagnostics({ enabled: process.env.FLIGHTDECK_STATE_DIAGNOSTICS === '1' });

function measureStore(operation, store, action) {
  if (!diagnostics.enabled) return action();
  const end = diagnostics.begin(operation);
  try {
    const result = action();
    let bytes;
    try { bytes = require('fs').statSync(store.path).size; } catch (_) {}
    end({ outcome: 'ok', bytes });
    return result;
  } catch (error) {
    end({ outcome: 'failed' });
    throw error;
  }
}

module.exports = { diagnostics, measureStore };
