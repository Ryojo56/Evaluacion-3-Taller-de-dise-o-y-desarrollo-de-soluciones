import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Deja pasar solo si hay sesión (y, si se indica, solo a ciertos roles).
export default function RutaProtegida({ roles }) {
  const { usuario, cargando } = useAuth()
  const location = useLocation()

  if (cargando) return <div className="p-5 text-center text-secondary">Cargando...</div>
  if (!usuario) return <Navigate to="/login" replace />

  // Primer inicio de sesión: obligado a cambiar la contraseña
  if (usuario.debe_cambiar_password && location.pathname !== '/cambiar-password') {
    return <Navigate to="/cambiar-password" replace />
  }
  if (roles && !roles.includes(usuario.rol)) return <Navigate to="/" replace />

  return <Outlet />
}
