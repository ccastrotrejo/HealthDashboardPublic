import { defineConfig } from 'vitest/config';
import { athleteConfigPlugin } from './scripts/lib/dashboard-assets.js';

export default defineConfig({
  plugins: [athleteConfigPlugin(true)],
  test: {
    // Node by default; client-rendered tests opt into jsdom per file.
    include: ['scripts/**/*.test.ts', 'src/**/*.test.ts', 'utils/**/*.test.ts', 'middleware.test.ts'],
    environment: 'node',
  },
});
