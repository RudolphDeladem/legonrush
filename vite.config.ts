import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'LEGONRUSH',
        short_name: 'LEGONRUSH',
        description: 'The Campus Lifestyle Reimagined. Ride. Race. Connect.',
        theme_color: '#0a1020',
        background_color: '#0a1020',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '/play/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp,woff2}'],
        globIgnores: ['photos/**', 'art/**', 'shots/**', 'brand/**'],
        navigateFallback: null,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play/index.html'),
      },
      output: {
        // three.js and the campus map change rarely, so they get their own long-lived files
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : id.includes('legon-map.json') ? 'campus-map' : undefined),
      },
    },
  },
});
