/// <reference types="vitest/config" />
import { defineConfig, loadEnv, runnerImport, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Local-only API for `npm run dev` / `npm run preview` (see server/). The
 * server code is loaded through Vite's module runner when a server starts,
 * so the config itself imports nothing from the app.
 */
function localApi(env: Record<string, string>): Plugin {
  const install = async (server: { middlewares: { use(fn: never): unknown } }) => {
    const { module } = await runnerImport<typeof import('./server/index')>('./server/index.ts', { configFile: false, logLevel: 'error' });
    server.middlewares.use(module.localApiMiddleware(env) as never);
  };
  return { name: 'chord-master-local-api', configureServer: install, configurePreviewServer: install };
}

export default defineConfig(({ mode }) => {
  // '' prefix reads every variable from .env here in Node; only VITE_* ones
  // ever reach the browser bundle, so ANTHROPIC_API_KEY stays on this machine.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [react(), localApi(env)],
    build: {
      // VexFlow bundles its music fonts; the single chunk is expected to be large.
      chunkSizeWarningLimit: 2000,
    },
    test: {
      environment: 'node',
    },
  };
});
