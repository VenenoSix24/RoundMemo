import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// DEV_HTTPS=1 时启用自签 HTTPS：iOS/Android 的陀螺仪传感器事件要求安全上下文，
// 局域网真机调试陀螺仪必须走 https。
export default defineConfig(({ mode }) => ({
  plugins: mode === 'development' && process.env.DEV_HTTPS ? [basicSsl()] : [],
  server: {
    port: 5173,
    host: true,
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
}))
