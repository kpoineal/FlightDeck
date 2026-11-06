import { get } from 'svelte/store';
import { connected, connectionIntent, connectionStatus } from './stores.js';
import { stateDiagnostics as diagnostics } from './state-diagnostics.js';

let generation = 0;
let pending = null;

export function getConnectionGeneration() { return generation; }

export function applyConnectionStatus(state) {
  if (state.status === 'disconnected') {
    generation++;
    pending = null;
  }
  connectionStatus.set(state.status);
  connected.set(state.status === 'ready');
}

export async function disconnectWorkiq() {
  generation++;
  pending = null;
  connectionIntent.set(false);
  applyConnectionStatus({ status: 'disconnected' });
  await window.workiq.disconnect?.();
}

export function validateConnection(retry = false) {
  if (pending) return pending;
  if (!retry && get(connected)) return Promise.resolve(true);
  const current = ++generation;
  connectionIntent.set(true);
  applyConnectionStatus({ status: 'validating' });
  const end = diagnostics.begin('connection-validate');
  pending = Promise.resolve().then(() => window.workiq.acceptEula({ retry })).then(
    result => result?.success === true,
    () => false,
  ).then(ready => {
    if (current !== generation) return false;
    pending = null;
    applyConnectionStatus({ status: ready ? 'ready' : 'failed' });
    end({ outcome: ready ? 'ok' : 'failed' });
    if (ready) diagnostics.record('remote-ready');
    return ready;
  });
  return pending;
}
