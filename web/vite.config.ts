import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works on GitHub Pages (/<repo>/) and from any static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Polling instead of inotify (this machine's watcher limit is exhausted); never watch the big data files.
    watch: { usePolling: true, interval: 600, ignored: ['**/public/data/**', '**/node_modules/**', '**/dist/**'] },
  },
})
