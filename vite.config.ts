/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // VexFlow bundles its music fonts; the single chunk is expected to be large.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
  },
});
