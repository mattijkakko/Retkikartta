import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/Retkikartta/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      includeManifestIcons: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        runtimeCaching: [{
          urlPattern: /tile\.|arcgisonline|maanmittauslaitos|waymarkedtrails/,
          handler: 'NetworkFirst',
          options: { cacheName: 'map-tiles' }
        }]
      }
    })
  ]
})
