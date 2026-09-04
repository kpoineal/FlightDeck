import { mount } from 'svelte';
import PopoutView from './components/PopoutView.svelte';
import { loadPersistentState, savePersistentState } from './lib/persistence.js';
import { items } from './lib/stores.js';
import {
  deleteItem,
  markItemRead,
  setItemMonitorPrompt,
  setItemScheduleField,
  setItemSeverity,
} from './lib/item-actions.js';
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
        const item = get(items).find(i => i.id === data.itemId);
        if (item) {
          try { await runItemCheck(item); savePersistentState(); } catch (_) {}
        }
      },
      onpromptchange(data) {
        setItemMonitorPrompt(data.itemId, data.value);
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
