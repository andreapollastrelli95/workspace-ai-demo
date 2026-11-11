import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // aggiornamenti controllati: l'utente conferma con "Aggiorna"
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'splash/*.png'],
      manifest: {
        name: 'Workspace AI',
        short_name: 'Workspace AI',
        description: 'Progetti, documenti, chat AI, analisi, previsioni e simulazioni in un unico spazio.',
        lang: 'it',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#0b1020',
        theme_color: '#0b1020',
        categories: ['productivity', 'business'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'Progetti', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // Plotly è grande
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // letture API: rete prima, cache come ripiego offline (sola consultazione)
            urlPattern: ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET' && !url.pathname.includes('/file'),
            handler: 'NetworkFirst',
            options: { cacheName: 'api-get', networkTimeoutSeconds: 8, expiration: { maxEntries: 200, maxAgeSeconds: 7 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
