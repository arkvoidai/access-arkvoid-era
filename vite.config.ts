import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import chatRoute from './api/chat.ts';
import healthRoute from './api/health.ts';
import sessionRoute from './api/session.ts';

function arkvoidApiPlugin(): Plugin {
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/api/health') {
      await healthRoute(req, res);
      return;
    }
    if (url === '/api/session') {
      await sessionRoute(req, res);
      return;
    }
    if (url === '/api/chat') {
      await chatRoute(req, res);
      return;
    }
    next();
  };

  return {
    name: 'arkvoid-api-middleware',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), arkvoidApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react';
            }
            if (id.includes('node_modules/gsap')) {
              return 'gsap';
            }
            if (
              id.includes('node_modules/three') ||
              id.includes('node_modules/postprocessing')
            ) {
              return 'three-vendor';
            }
            if (id.includes('/src/engine/')) {
              return 'engine';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
