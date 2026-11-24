import { useState } from 'react'
import { api, errorCampo, errorGeneral } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { AlertaError } from './Estados.jsx'
import RequisitosPassword, { revisarRequisitos } from './RequisitosPassword.jsx'

// Formulario para cambiar la contraseña (POST /api/cambiarPassword/).
// Se usa en el primer ingreso y en Mi perfil. "alGuardar" se llama al terminar bien.
export default function FormPassword({ etiquetaActual = 'Contraseña actual', textoBoton = 'Guardar contraseña', alGuardar }) {
  const { setUsuario } = useAuth()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [conf, setConf] = useState('')
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const valido = actual && revisarRequisitos(nueva).every((r) => r.ok) && nueva === conf

  const handleSubmit = async (e) => {
    e.preventDefault()
    setEnviando(true)
    try {
      const data = await api.post('/cambiarPassword/', { actual, nueva, confirmar: conf })
      setUsuario(data.usuario)
      setActual(''); setNueva(''); setConf(''); setError(null)
      alGuardar?.()
    } catch (err) {
      setError(err)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <AlertaError mensaje={errorGeneral(error)} />
      <div className="mb-3">
        <label htmlFor="actual" className="form-label small text-secondary">{etiquetaActual}</label>
        <input type="password" id="actual" autoComplete="current-password"
          className={`form-control ${errorCampo(error, 'actual') ? 'is-invalid' : ''}`}
          value={actual} onChange={(e) => setActual(e.target.value)} />
        <div className="invalid-feedback">{errorCampo(error, 'actual')}</div>
      </div>
      <div className="mb-3">
        <label htmlFor="nueva" className="form-label small text-secondary">Nueva contraseña</label>
        <input type="password" id="nueva" autoComplete="new-password"
          className={`form-control ${errorCampo(error, 'nueva') ? 'is-invalid' : ''}`}
          value={nueva} onChange={(e) => setNueva(e.target.value)} />
        <div className="invalid-feedback">{errorCampo(error, 'nueva')}</div>
      </div>
      <div className="mb-3">
        <label htmlFor="conf" className="form-label small text-secondary">Confirmar nueva contraseña</label>
        <input type="password" id="conf" autoComplete="new-password"
          className={`form-control ${conf && conf !== nueva ? 'is-invalid' : ''}`}
          value={conf} onChange={(e) => setConf(e.target.value)} />
        <div className="invalid-feedback">Las contraseñas no coinciden.</div>
      </div>
      <RequisitosPassword clave={nueva} />
      <button type="submit" className="btn btn-accent w-100 py-2" disabled={!valido || enviando}>
        {enviando ? 'Guardando...' : textoBoton}
      </button>
    </form>
  )
}
