/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { songLookupApi } from './server/songLookupApi';

export default defineConfig(({ mode }) => {
  // '' prefix reads every variable from .env here in Node; only VITE_* ones
  // ever reach the browser bundle, so ANTHROPIC_API_KEY stays on this machine.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [react(), songLookupApi(env.ANTHROPIC_API_KEY || undefined)],
    build: {
      // VexFlow bundles its music fonts; the single chunk is expected to be large.
      chunkSizeWarningLimit: 2000,
    },
    test: {
      environment: 'node',
    },
  };
});
