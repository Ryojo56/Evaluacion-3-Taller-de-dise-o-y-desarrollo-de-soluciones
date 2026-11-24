# Bodega - Frontend (React + Vite) conectado a Django

Necesitas DOS terminales abiertas:

- Terminal 1 (backend):  `cd bodega-backend` → `venv\Scripts\activate` → `python manage.py runserver`
- Terminal 2 (frontend): `cd bodega-frontend` → `npm install` (solo la 1a vez) → `npm run dev`

Abre http://localhost:5173 (NO el 8000)

Usuarios de prueba (contraseña `Bodega#2026`):
admin@bodega.cl · bodeguero@bodega.cl · trabajador@bodega.cl · nuevo@bodega.cl

Archivos clave de la conexión:

- `vite.config.js` — proxy /api → Django (puerto 8000)
- `src/api.js` — fetch + token CSRF + manejo de errores
- `src/useApi.js` — hook para cargar datos al abrir una página
- `src/context/AuthContext.jsx` — quién inició sesión
- `src/components/RutaProtegida.jsx` — bloquea páginas según sesión y rol
