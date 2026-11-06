import { mount, tick } from 'svelte';
import { stateDiagnostics as diagnostics } from './lib/state-diagnostics.js';
import PopoutView from './components/PopoutView.svelte';
import { loadPersistentState, savePersistentState, subscribePersistentState, flushPersistentState } from './lib/persistence.js';
import { applyConnectionStatus } from './lib/connection.js';
import { items, isDemo } from './lib/stores.js';
import {
  deleteItem,
  markItemRead,
  setItemMonitorPrompt,
  setItemScheduleField,
  setItemSeverity,
} from './lib/item-actions.js';
import { runItemCheck } from './lib/monitor-engine.js';
import { get } from 'svelte/store';
import { resolveRadarItem } from './lib/radar-navigation.js';
import { coldItems } from './lib/stores.js';

const params = new URLSearchParams(window.location.search);
const popoutItemId = params.get('popout');

async function init() {
  diagnostics.record('popout-bootstrap');
  const demo = params.has('demo');
  isDemo.set(demo);
  await loadPersistentState(demo);
  await resolveRadarItem(popoutItemId);
  const disposers = [subscribePersistentState(demo)];
  if (window.workiq.onFlushState) disposers.push(window.workiq.onFlushState(() => flushPersistentState(demo)));
  if (window.workiq.onConnectionStatus) disposers.push(window.workiq.onConnectionStatus(applyConnectionStatus));

  mount(PopoutView, {
    target: document.getElementById('popout-app'),
    props: {
      itemId: popoutItemId,
      onseveritychange(data) {
        setItemSeverity(data.itemId, data.value);
      },
      onmarkseen(data) {
        markItemRead(data.itemId);
      },
      ondelete(data) {
        if (confirm('Delete this item permanently?')) {
          deleteItem(data.itemId, { recordHistory: false });
        }
      },
      onschedulechange(data) {
        setItemScheduleField(data.itemId, data.field, data.value);
      },
      async onrunnow(data) {
        const item = [...get(items), ...get(coldItems)].find(i => i.id === data.itemId);
        if (item) {
          try { await runItemCheck(item); savePersistentState(); } catch (_) {}
        }
      },
      onpromptchange(data) {
        setItemMonitorPrompt(data.itemId, data.value);
      },
    },
  });
  if (diagnostics.enabled) {
    const endTick = diagnostics.begin('svelte-tick');
    void tick().then(() => {
      endTick();
      const endFrame = diagnostics.begin('frame-opportunity');
      requestAnimationFrame(() => endFrame());
    });
  }

  // Reload state when changed from other windows
  if (window.workiq && typeof window.workiq.onStateChanged === 'function') {
    disposers.push(window.workiq.onStateChanged(() => {
      diagnostics.record('state-sync');
      void loadPersistentState(demo).then(loaded => loaded && resolveRadarItem(popoutItemId));
    }));
  }
  window.addEventListener('pagehide', () => disposers.forEach(dispose => dispose()), { once: true });
  diagnostics.record('startup-complete');
}

init();
