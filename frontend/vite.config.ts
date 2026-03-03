import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// VITE_BACKEND_WS_TARGET: set to "ws://backend:8000" in Docker.
// Defaults to localhost for direct npm run dev usage.
const backendWsTarget = process.env.VITE_BACKEND_WS_TARGET ?? 'ws://localhost:8000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: backendWsTarget,
        ws: true,
      },
    },
  },
})
