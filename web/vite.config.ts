import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // 开发时后端在 8787，浏览器只认 5173
      '/api': 'http://127.0.0.1:8787',
      '/img': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
