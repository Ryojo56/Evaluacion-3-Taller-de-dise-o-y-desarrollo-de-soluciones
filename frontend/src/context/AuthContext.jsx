import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../api.js'

// Guarda QUIÉN inició sesión y lo comparte con todas las páginas.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)

  // Al abrir la app: pedimos la cookie CSRF y preguntamos si ya hay sesión
  useEffect(() => {
    async function iniciar() {
      try {
        await api.get('/csrf/')
        const data = await api.get('/yo/')
        setUsuario(data.usuario)
      } catch {
        setUsuario(null) // 401 = no hay sesión
      } finally {
        setCargando(false)
      }
    }
    iniciar()

    const alExpirar = () => setUsuario(null)
    window.addEventListener('sesion-expirada', alExpirar)
    return () => window.removeEventListener('sesion-expirada', alExpirar)
  }, [])

  const login = async (email, password, recordar) => {
    const data = await api.post('/login/', { email, password, recordar })
    setUsuario(data.usuario)
    return data.usuario
  }

  const logout = async () => {
    await api.post('/logout/')
    setUsuario(null)
  }

  return (
    <AuthContext.Provider value={{ usuario, setUsuario, cargando, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
