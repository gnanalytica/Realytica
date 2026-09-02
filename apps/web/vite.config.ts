import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Fail loudly rather than drifting. With fallback enabled Vite quietly
    // takes the next free port — which is 5174, the API's own port — and the
    // dev server then shadows the backend it is supposed to be proxying to.
    // A clear "port in use" beats a confusing half-working app.
    strictPort: true,
    proxy: {
      '/api': {
        // Overridable so a second dev server can be pointed at an API running
        // with authentication on, without editing this file.
        target: process.env.REALYTICA_API_TARGET ?? 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
