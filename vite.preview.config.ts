import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Serves src/renderer in a plain browser for UI preview (see preview.ts). */
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()]
})
