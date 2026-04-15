import PopoutView from './components/PopoutView.svelte';
import { loadPersistentState, savePersistentState } from './lib/persistence.js';
import { items } from './lib/stores.js';

const params = new URLSearchParams(window.location.search);
const popoutItemId = params.get('popout');

async function init() {
  await loadPersistentState();

  const app = new PopoutView({
    target: document.getElementById('popout-app'),
    props: { itemId: popoutItemId },
  });

  // Wire up event handlers
  app.$on('severitychange', (e) => {
    const { itemId, value } = e.detail;
    items.update(($items) => {
      const item = $items.find((i) => i.id === itemId);
      if (item) item.severity = value;
      return $items;
    });
    savePersistentState();
  });

  app.$on('markseen', (e) => {
    const { itemId } = e.detail;
    items.update(($items) => {
      const item = $items.find((i) => i.id === itemId);
      if (item) {
        item.hasNewUpdate = false;
        item.isNew = false;
        if (Array.isArray(item.updateHistory)) {
          item.updateHistory.forEach((entry) => { entry.seen = true; });
        }
      }
      return $items;
    });
    savePersistentState();
  });

  app.$on('delete', (e) => {
    const { itemId } = e.detail;
    if (confirm('Delete this item permanently?')) {
      items.update(($items) => $items.filter((i) => i.id !== itemId));
      savePersistentState();
    }
  });

  app.$on('schedulechange', (e) => {
    const { itemId, field, value } = e.detail;
    items.update(($items) => {
      const item = $items.find((i) => i.id === itemId);
      if (item) item[field] = value;
      return $items;
    });
    savePersistentState();
  });

  app.$on('runnow', (e) => {
    const { itemId } = e.detail;
    if (window.workiq && typeof window.workiq.runItemCheck === 'function') {
      window.workiq.runItemCheck(itemId);
    }
  });

  app.$on('promptchange', (e) => {
    const { itemId, value } = e.detail;
    items.update(($items) => {
      const item = $items.find((i) => i.id === itemId);
      if (item) item.monitorPrompt = value;
      return $items;
    });
    savePersistentState();
  });

  // Reload state when changed from other windows
  if (window.workiq && typeof window.workiq.onStateChanged === 'function') {
    window.workiq.onStateChanged(() => {
      loadPersistentState();
    });
  }
}

init();
