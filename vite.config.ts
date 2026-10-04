import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves the site from /legonrush/; set BASE_PATH there (see .github/workflows/pages.yml)
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeManifestIcons: false,
      includeAssets: ['icons/favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'LEGONRUSH',
        short_name: 'LEGONRUSH',
        description: 'The Campus Lifestyle Reimagined. Ride. Race. Connect.',
        theme_color: '#0a1020',
        background_color: '#0a1020',
        display: 'fullscreen',
        orientation: 'any',
        start_url: 'play/',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp,woff2}'],
        // keep the offline install small for students on data bundles: no landing-page images,
        // no large install icons, and only the Latin font files the game uses
        globIgnores: ['photos/**', 'art/**', 'shots/**', 'brand/**', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'assets/*-latin-ext-*', 'assets/*-vietnamese-*', 'assets/supabase-*'],
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
        // the Supabase client loads only for riders who sign in, so it stays out of the offline install
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : id.includes('legon-map.json') ? 'campus-map' : id.includes('node_modules/@supabase') ? 'supabase' : undefined),
      },
    },
  },
});
