import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// VITE_BACKEND_WS_TARGET: set to "ws://backend:8000" in Docker.
// Defaults to localhost for direct npm run dev usage.
const backendWsTarget = process.env.VITE_BACKEND_WS_TARGET ?? 'ws://localhost:8000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
          dest: ''
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/*.onnx',
          dest: ''
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: ''
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.mjs',
          dest: ''
        }
      ]
    })
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
