import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { athleteConfigPlugin, dashboardAssetsPlugin } from './scripts/lib/dashboard-assets.js';

export default defineConfig({
  plugins: [react(), athleteConfigPlugin(), dashboardAssetsPlugin()],
  // Raw vendor files and local credentials must never be copied by Vite.
  publicDir: false,
  server: {
    host: '127.0.0.1',
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/private/**'] },
  },
  // Static-site build — no env vars from process.env are exposed to the client
  // unless prefixed VITE_, and we have none of those by design. Browser only
  // ever reads JSON from /data/.
  define: {
    // Prevent process.env leakage to the browser bundle
    'process.env': {},
  },
  build: {
    // Source maps disabled in production so we don't leak source paths
    sourcemap: false,
    // Reasonable chunking for a single-page app.
    // Function form is used because Rollup 4 (Vite 7) often leaves the
    // object form's named chunks empty when entry imports are inlined.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/victory-vendor/')) {
            return 'charts';
          }
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'react-vendor';
          }
        },
      },
    },
  },
});
