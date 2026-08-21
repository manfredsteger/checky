import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // ECharts in einen eigenen Vendor-Chunk (schweres Paket, ändert sich selten
          // → getrennt cachebar, hält den App-Chunk klein).
          manualChunks: { echarts: ['echarts'] },
        },
      },
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Selbst-gehostetes Tool: Zugriff über beliebigen Host/IP (Docker-Service "web",
      // Proxmox-VM-IP, Hostname) erlauben – sonst blockt Vite mit "Blocked request".
      allowedHosts: true as const,
      // Im Docker-Stack läuft die API als Service "api" auf 8080.
      // Lokal (ohne Docker) via API_PROXY_TARGET überschreibbar.
      proxy: {
        '/api': process.env.API_PROXY_TARGET || 'http://api:8080'
      },
    },
  };
});
