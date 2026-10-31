import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'קריירה: מהשכונה לפסגה',
        short_name: 'קריירה',
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#22344F',
        theme_color: '#22344F',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2,json}'], maximumFileSizeToCacheInBytes: 4_000_000 },
    }),
  ],
  worker: { format: 'es' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
