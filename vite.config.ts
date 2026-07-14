import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'test-control': resolve(__dirname, 'test-control.html'),
        'api-docs': resolve(__dirname, 'api-docs.html'),
      },
    },
  },
  server: {
    port: 3003,
    proxy: {
      '^/api/': 'http://localhost:3002',
      '/socket.io': {
        target: 'http://localhost:3002',
        ws: true,
      },
    },
  },
});
