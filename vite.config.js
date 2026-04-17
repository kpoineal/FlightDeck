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
      input: {
        main: 'src/app.html',
        popout: 'src/popout.html',
      },
      output: {
        manualChunks(id) {
          // Force Svelte runtime into a single shared chunk so all
          // components share the same reactive context variables.
          if (id.includes('node_modules/svelte')) {
            return 'svelte-runtime';
          }
        },
      },
    },
  },
});
