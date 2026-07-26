import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/firestore-rules.js'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
