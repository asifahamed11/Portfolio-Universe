// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

const preserveWorkspaceLinks =
  process.env.CODEX_PRESERVE_WORKSPACE_LINKS === '1';

// https://astro.build/config
export default defineConfig({
  site: 'https://asifahamed11.github.io',
  base: '/Portfolio-Universe/',

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      preserveSymlinks: preserveWorkspaceLinks
    },
    optimizeDeps: {
      rolldownOptions: {
        transform: {
          // The dependency optimizer is dev-only. Keep React's optimized runtime
          // in development mode even when another Astro command shares the cache.
          define: {
            'process.env.NODE_ENV': JSON.stringify('development')
          }
        },
        resolve: {
          symlinks: !preserveWorkspaceLinks
        }
      }
    }
  },

  integrations: [react()]
});
