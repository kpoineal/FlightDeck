import { mount } from 'svelte';
import PopoutView from './components/PopoutView.svelte';
import { loadPersistentState, savePersistentState } from './lib/persistence.js';
import { items } from './lib/stores.js';

const params = new URLSearchParams(window.location.search);
const popoutItemId = params.get('popout');

async function init() {
  await loadPersistentState();

  mount(PopoutView, {
    target: document.getElementById('popout-app'),
    props: {
      itemId: popoutItemId,
      onseveritychange(data) {
        const { itemId, value } = data;
        items.update(($items) => {
          const item = $items.find((i) => i.id === itemId);
          if (item) item.severity = value;
          return $items;
        });
        savePersistentState();
      },
      onmarkseen(data) {
        const { itemId } = data;
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
      },
      ondelete(data) {
        const { itemId } = data;
        if (confirm('Delete this item permanently?')) {
          items.update(($items) => $items.filter((i) => i.id !== itemId));
          savePersistentState();
        }
      },
      onschedulechange(data) {
        const { itemId, field, value } = data;
        items.update(($items) => {
          const item = $items.find((i) => i.id === itemId);
          if (item) item[field] = value;
          return $items;
        });
        savePersistentState();
      },
      onrunnow(data) {
        const { itemId } = data;
        if (window.workiq && typeof window.workiq.runItemCheck === 'function') {
          window.workiq.runItemCheck(itemId);
        }
      },
      onpromptchange(data) {
        const { itemId, value } = data;
        items.update(($items) => {
          const item = $items.find((i) => i.id === itemId);
          if (item) item.monitorPrompt = value;
          return $items;
        });
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
