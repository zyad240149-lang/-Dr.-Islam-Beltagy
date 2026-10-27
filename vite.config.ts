import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: '127.0.0.1', port: 4660, strictPort: true },
  preview: { host: '127.0.0.1', port: 4660, strictPort: true },
});
