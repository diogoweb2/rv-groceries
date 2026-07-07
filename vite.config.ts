import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-trailer.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'RV & Groceries',
        short_name: 'RVList',
        description: 'Offline-first checklists for RV trips and groceries',
        theme_color: '#2f6b4f',
        // Matches the icon's background so the Android splash reads as one scene
        background_color: '#eaf6f3',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-firebase-firestore', test: /node_modules\/(@firebase\/firestore|firebase\/firestore)\//, maxSize: 400_000 },
            { name: 'vendor-firebase-auth', test: /node_modules\/(@firebase\/auth|firebase\/auth)\// },
            { name: 'vendor-firebase', test: /node_modules\/(@firebase|firebase)\// },
            { name: 'vendor-radix', test: /node_modules\/@radix-ui\// },
            { name: 'vendor-dnd-kit', test: /node_modules\/@dnd-kit\// },
            { name: 'vendor-react', test: /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\// },
            { name: 'vendor', test: /node_modules\// },
          ],
        },
      },
    },
  },
})
