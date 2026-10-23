import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages เปิดเว็บที่ https://koii-karnna.github.io/store-inventory/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/store-inventory/' : '/',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
}));
