import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'src/',
  base: './',
  plugins: [
    svelte({
      configFile: false,
      compilerOptions: { css: 'external' },
    }),
  ],
  build: {
    outDir: '../dist-renderer',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'esnext',
    rollupOptions: {
      input: 'src/app.html',
    },
  },
});
