// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://asifahamed11.github.io',
  base: '/Portfolio-Universe',
  vite: {
    plugins: [tailwindcss()]
  }
});