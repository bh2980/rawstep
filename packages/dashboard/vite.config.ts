import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true } } },
  preview: { host: '127.0.0.1' },
});
