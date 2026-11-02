import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from https://programmer-mukeshkrishnaank.github.io/jaldrishti-india/
export default defineConfig({
  base: '/jaldrishti-india/',
  plugins: [react()],
})
