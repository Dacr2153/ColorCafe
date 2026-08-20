import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// CaféVision — config Vite con PWA (Workbox) y estrategias de cache por ruta.
// Principio: NUNCA servir datos "antiguos" sin que el cliente pueda diferenciarlos.
//   - Assets estáticos:    CacheFirst con expiración
//   - GET /api/v1 (datos): NetworkFirst con fallback a cache (+ timeout)
//   - Imágenes thumbnails: StaleWhileRevalidate
//   - POST/PATCH/DELETE:   NUNCA cacheadas
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg', 'robots.txt', 'apple-touch-icon.png',
        'pwa-96.png', 'pwa-192.png', 'pwa-512.png', 'pwa-512-maskable.png',
      ],
      manifest: {
        name: 'CaféVision — Análisis de café honesto',
        short_name: 'CaféVision',
        description: 'Análisis profesional y trazable de granos de café. Conecta caficultores y compradores con datos reales.',
        lang: 'es-CO',
        dir: 'ltr',
        theme_color: '#6B4423',
        background_color: '#F8F4EC',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        scope: '/',
        start_url: '/?source=pwa',
        categories: ['business', 'productivity', 'utilities'],
        icons: [
          { src: 'pwa-96.png',           sizes: '96x96',   type: 'image/png' },
          { src: 'pwa-192.png',          sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png',          sizes: '512x512', type: 'image/png' },
          { src: 'pwa-192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Nuevo análisis',
            short_name: 'Analizar',
            description: 'Subir una foto de muestra para análisis',
            url: '/capture?source=shortcut',
            icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
          },
          {
            name: 'Marketplace',
            short_name: 'Mercado',
            description: 'Explorar lotes verificados',
            url: '/marketplace?source=shortcut',
            icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
          },
          {
            name: 'Mis métricas',
            short_name: 'Métricas',
            description: 'Ver evolución de calidad',
            url: '/metrics?source=shortcut',
            icons: [{ src: 'pwa-192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\b/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,        // requerimos UX explícita de "nueva versión disponible"
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Assets versionados de Vite
            urlPattern: ({ request }) => ['style', 'script', 'worker'].includes(request.destination),
            handler: 'CacheFirst',
            options: {
              cacheName: 'cv-static-v1',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Fuentes
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'cv-fonts-v1',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            // Imágenes/thumbnails (incluye URLs presigned de MinIO)
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cv-images-v1',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            // GET de API: NetworkFirst con timeout. Las mutaciones NO entran aquí
            // (matcher por method).
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cv-api-v1',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 30 },
              // Importante: marcar cache origin para que la UI pueda detectarlo
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,           // habilitar a mano cuando se prueba SW en dev
        type: 'module',
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
          ui: ['lucide-react'],
        },
      },
    },
  },
});
