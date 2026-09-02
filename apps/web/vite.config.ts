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
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        /*
         * Keep the libraries in their own chunk, separate from our code.
         *
         * Without this every deploy renames the one big chunk, so a person who
         * has used the app all week re-downloads React and the icon set to get
         * a two-line fix. Split, the vendor chunk's hash only changes when a
         * dependency actually changes — which is rare — and an app deploy is a
         * small file against a warm cache.
         *
         * Only the libraries that are genuinely everywhere are named here.
         * Leaflet, the PDF engine and the .docx converter are deliberately
         * absent: they are behind `lazy` imports at their use sites, which
         * gives them their own chunks *and* keeps them out of the first load
         * entirely. Naming them here would drag them back into a chunk that is
         * always fetched.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return undefined;
        },
      },
    },
  },
});
