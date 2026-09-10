import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Pure-logic tests only: hex math, A*, layout validation, lighting presets,
// schema, reconciliation, adapters. Nothing here needs a DOM or a GPU, which
// is the point — a pathfinding bug is found here, not by watching an avatar
// walk into a wall.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
