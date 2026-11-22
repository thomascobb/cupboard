import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Firestore with offline persistence is most of the Firebase chunk (~190 kB gzipped); it's precached by the service worker.
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 800 },
  server: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cupboard',
        short_name: 'Cupboard',
        description: 'What’s in the store cupboard, and which one to use first.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F2F2F7',
        theme_color: '#FFFFFF',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        // Firebase Hosting's reserved URLs (auth handler, init.json) must always hit the network.
        navigateFallbackDenylist: [/^\/__\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
