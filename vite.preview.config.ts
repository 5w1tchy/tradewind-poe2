import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/** Serves src/renderer in a plain browser for UI preview (see preview.ts). */
export default defineConfig({
  root: 'src/renderer',
  plugins: [vue()]
})
