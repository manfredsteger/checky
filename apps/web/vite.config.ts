import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Selbst-gehostetes Tool: Zugriff über beliebigen Host/IP (Docker-Service "web",
      // Proxmox-VM-IP, Hostname) erlauben – sonst blockt Vite mit "Blocked request".
      allowedHosts: true,
      // Im Docker-Stack läuft die API als Service "api" auf 8080.
      // Lokal (ohne Docker) via API_PROXY_TARGET überschreibbar.
      proxy: {
        '/api': process.env.API_PROXY_TARGET || 'http://api:8080'
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
