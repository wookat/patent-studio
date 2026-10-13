import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: true,
    port: 5173,
    // 测试以 ?raw 读仓库根 examples/*/content.md（jsdom 环境走 client 变换，受 fs.allow 约束）
    fs: { allow: [path.resolve(import.meta.dirname, '..')] },
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000', changeOrigin: true, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
