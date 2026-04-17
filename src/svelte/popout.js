import { mount } from 'svelte';
import PopoutView from './components/PopoutView.svelte';
import { loadPersistentState, savePersistentState } from './lib/persistence.js';
import { items } from './lib/stores.js';
import { runItemCheck } from './lib/monitor-engine.js';
import { get } from 'svelte/store';

const params = new URLSearchParams(window.location.search);
const popoutItemId = params.get('popout');

async function init() {
  await loadPersistentState();

  mount(PopoutView, {
    target: document.getElementById('popout-app'),
    props: {
      itemId: popoutItemId,
      onseveritychange(data) {
        items.update(($items) => $items.map(i =>
          i.id === data.itemId ? { ...i, severity: data.value } : i
        ));
        savePersistentState();
      },
      onmarkseen(data) {
        items.update(($items) => $items.map(i => {
          if (i.id !== data.itemId) return i;
          const updated = { ...i, hasNewUpdate: false, isNew: false };
          if (Array.isArray(updated.updateHistory)) {
            updated.updateHistory = updated.updateHistory.map(e => ({ ...e, seen: true }));
          }
          return updated;
        }));
        savePersistentState();
      },
      ondelete(data) {
        if (confirm('Delete this item permanently?')) {
          items.update(($items) => $items.filter(i => i.id !== data.itemId));
          savePersistentState();
        }
      },
      onschedulechange(data) {
        items.update(($items) => $items.map(i =>
          i.id === data.itemId ? { ...i, [data.field]: data.value } : i
        ));
        savePersistentState();
      },
      async onrunnow(data) {
        const item = get(items).find(i => i.id === data.itemId);
        if (item) {
          try { await runItemCheck(item); savePersistentState(); } catch (_) {}
        }
      },
      onpromptchange(data) {
        items.update(($items) => $items.map(i =>
          i.id === data.itemId ? { ...i, monitorPrompt: data.value } : i
        ));
        savePersistentState();
      },
    },
  });

  // Reload state when changed from other windows
  if (window.workiq && typeof window.workiq.onStateChanged === 'function') {
    window.workiq.onStateChanged(() => {
      loadPersistentState();
    });
  }
}

init();
