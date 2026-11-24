import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { errorGeneral } from '../api.js'
import { AlertaError } from '../components/Estados.jsx'

export default function Login() {
  const { usuario, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recordar, setRecordar] = useState(false)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const navigate = useNavigate()

  if (usuario) return <Navigate to="/" replace /> // ya tiene sesión

  const handleSubmit = async (e) => {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      const u = await login(email, password, recordar)          // POST /api/login/
      navigate(u.debe_cambiar_password ? '/cambiar-password' : '/')
    } catch (err) {
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="container-fluid bg-body">
      <div className="row min-vh-100">
        <section className="col-md-6 login-side d-flex flex-column justify-content-center p-5">
          <div className="d-flex align-items-center gap-3 mb-4">
            <div className="logo"></div>
            <h1 className="display-3 fw-semibold mb-0">Bodega</h1>
          </div>
          <p className="fs-5 text-white-50">Control de materiales, herramientas y préstamos en un solo lugar.</p>
          <p className="small text-white-50 border-top border-secondary pt-3">
            Acceso restringido a personal autorizado.
          </p>
        </section>

        <main className="col-md-6 d-flex align-items-center justify-content-center p-4">
          <form className="w-100" style={{ maxWidth: 380 }} onSubmit={handleSubmit}>
            <h2 className="fw-bold text-center mb-4">Iniciar sesión</h2>
            <AlertaError mensaje={errorGeneral(error)} />
            <div className="mb-3">
              <label htmlFor="email" className="form-label fw-semibold">Ingresa tu correo </label>
              <input type="text" id="email" className="form-control" autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="mb-3">
              <label htmlFor="pass" className="form-label fw-semibold">Ingresa contraseña.</label>
              <input type="password" id="pass" className="form-control" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="form-check mb-4">
              <input className="form-check-input" type="checkbox" id="remember"
                checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
              <label className="form-check-label" htmlFor="remember">Acuérdate de mí</label>
            </div>
            <button type="submit" className="btn btn-lg btn-login w-100" disabled={enviando}>
              {enviando ? 'Entrando...' : 'Login'}
            </button>
          </form>
        </main>
      </div>
    </div>
  )
}
