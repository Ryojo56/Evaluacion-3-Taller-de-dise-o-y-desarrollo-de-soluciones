import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // PROXY: todo lo que React pida a /api/... se lo reenvía a Django (puerto 8000).
    // Para el navegador, React y Django son "el mismo sitio", así que las cookies
    // de sesión funcionan y no hace falta configurar CORS.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
