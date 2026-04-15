import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'src/',
  base: './',
  plugins: [
    svelte({
      configFile: false,
      compilerOptions: { css: 'external', runes: false },
    }),
  ],
  build: {
    outDir: '../dist-renderer',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'esnext',
    rollupOptions: {
      input: {
        main: 'src/app.html',
        popout: 'src/popout.html',
      },
    },
  },
});
