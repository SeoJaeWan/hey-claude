import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { dynamicPortPlugin } from './scripts/vite-port-plugin';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), dynamicPortPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui'),
    },
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
  },
  server: {
    // 포트는 dynamicPortPlugin에서 동적으로 할당됨 (17777 ~ 17877)
    proxy: {
      '/api': {
        // target은 server.lock 파일 기반으로 dynamicPortPlugin에서 동적 설정
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
    },
  },
});
