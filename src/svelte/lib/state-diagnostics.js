import { createStateDiagnostics } from '../../shared/state-diagnostics.mjs';

export const stateDiagnostics = createStateDiagnostics({
  enabled: typeof window !== 'undefined' && window.workiq?.stateDiagnosticsEnabled === true,
});

// Explicit retrieval only; events never go through the persisted engine log.
if (typeof window !== 'undefined' && stateDiagnostics.enabled) {
  window.__flightdeck_state_diagnostics = async () => ({
    renderer: stateDiagnostics.snapshot(),
    main: await window.workiq.getStateDiagnostics(),
  });
}
