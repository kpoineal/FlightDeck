import App from './App.svelte';
import { mode } from './lib/stores.js';

const app = new App({
  target: document.getElementById('svelte-app'),
});

// Bridge: sync vanilla JS mode tab clicks → Svelte mode store
document.querySelectorAll('.mode-btn[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    const newMode = button.dataset.mode;
    if (newMode) mode.set(newMode === 'Tracking' ? 'Radar' : newMode);
  });
});

export default app;
