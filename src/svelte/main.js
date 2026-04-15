import { mount } from 'svelte';
import App from './App.svelte';

// Theme init — runs early to avoid flash
(function initTheme() {
  const stored = localStorage.getItem('fd-theme');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
})();

const app = mount(App, {
  target: document.getElementById('svelte-app'),
});

export default app;
