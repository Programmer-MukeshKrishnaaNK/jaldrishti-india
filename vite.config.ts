import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from https://programmer-mukeshkrishnaank.github.io/pannipulse/
export default defineConfig({
  base: '/pannipulse/',
  plugins: [react()],
})
