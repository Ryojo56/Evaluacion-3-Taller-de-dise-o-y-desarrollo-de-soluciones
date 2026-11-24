import { useNavigate } from 'react-router-dom'
import FormPassword from '../components/FormPassword.jsx'

// Primer inicio de sesión (o contraseña restablecida por el administrador)
export default function CambiarPassword() {
  const navigate = useNavigate()

  return (
    <main className="container py-5" style={{ maxWidth: 520 }}>
      <div className="card p-4 p-md-5">
        <h1 className="h4 fw-bold">Actualiza tu contraseña</h1>
        <p className="text-secondary">
          Es tu primer inicio de sesión. Debes crear una nueva contraseña antes de continuar.
        </p>
        <FormPassword etiquetaActual="Contraseña actual (provisoria)" alGuardar={() => navigate('/')} />
      </div>
    </main>
  )
}
