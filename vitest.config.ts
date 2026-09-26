import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Opening a fresh file-backed DB runs the full migration through the wasm VFS
    // (1–3 s on a loaded machine); the 5 s default flaked on file-DB tests.
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
