import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Navy Seal Burpees Tracker',
        short_name: 'NSB Tracker',
        description: 'Registre, acompanhe e evolua nos Navy Seal Burpees.',
        theme_color: '#0d1b2a',
        background_color: '#f7f8fa',
        display: 'standalone',
        lang: 'pt-BR',
        icons: [
          { src: 'nsb-icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
