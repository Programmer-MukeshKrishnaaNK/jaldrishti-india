import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Served from https://programmer-mukeshkrishnaank.github.io/jaldrishti-india/
export default defineConfig({
  base: '/jaldrishti-india/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        // Experimental Google 3D page; it only works on the local dev server with a key.
        google3d: fileURLToPath(new URL('google3d.html', import.meta.url)),
      },
    },
  },
})
