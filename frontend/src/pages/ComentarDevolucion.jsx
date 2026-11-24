import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorCampo, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { AlertaError, Cargando } from '../components/Estados.jsx'

const opciones = [
  { valor: 'Bueno', color: 'success' },
  { valor: 'Regular', color: 'warning' },
  { valor: 'Con falla', color: 'danger' },
]

export default function ComentarDevolucion() {
  const { id } = useParams() // id del préstamo
  const { data, cargando, error: errorCarga } = useApi(`/prestamos/${id}/`) // GET /api/prestamos/<id>/
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const [estado, setEstado] = useState('Bueno')
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState(null)

  if (cargando) return <Cargando />
  if (errorCarga) return <p>{errorGeneral(errorCarga)} <Link to="/mis-prestamos">Volver</Link></p>

  const prestamo = data.prestamo
  if (prestamo.trabajador_id !== usuario.id) {
    return <p>Las herramientas de otros trabajadores se reciben escaneando su código en <Link to="/prestamos">Préstamos</Link>.</p>
  }
  const volverA = '/mis-prestamos'
  if (!prestamo.activo) return <p>Este préstamo ya fue devuelto. <Link to={volverA}>Volver</Link></p>
  if (prestamo.por_recibir) {
    return <p>Ya avisaste esta devolución: entrega la herramienta en bodega para que escaneen su código. <Link to={volverA}>Volver</Link></p>
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/devolverPrestamo/${id}/`, { estado_devolucion: estado, comentario })
      navigate(volverA)
    } catch (err) {
      setError(err)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <div className="card-header bg-body p-3">
        <h1 className="h6 fw-bold mb-0">Comentar herramienta devuelta</h1>
      </div>
      <form className="card-body p-4" onSubmit={handleSubmit}>
        <p className="fw-medium mb-1">{prestamo.herramienta} · <span className="sku">{prestamo.sku}</span></p>
        {prestamo.unidades.length > 0 && (
          <p className="small text-secondary">
            {prestamo.unidades.length === 1 ? 'Código de la herramienta' : 'Códigos de las herramientas'}:{' '}
            <span className="sku text-dark">{prestamo.unidades.join(', ')}</span>
          </p>
        )}
        <AlertaError mensaje={errorGeneral(error)} />
        <div className="alert alert-light border small">
          Después de enviar el comentario, entrega la herramienta en bodega: el bodeguero escaneará su código para recibirla.
        </div>

        <fieldset className="mb-3">
          <legend className="form-label small text-secondary fs-6">Estado general</legend>
          <div className="row g-2">
            {opciones.map((o, idx) => (
              <div className="col-4" key={o.valor}>
                <input type="radio" className="btn-check" name="estado" id={`e${idx}`}
                  checked={estado === o.valor} onChange={() => setEstado(o.valor)} />
                <label className={`btn btn-outline-${o.color} w-100`} htmlFor={`e${idx}`}>{o.valor}</label>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="mb-4">
          <label htmlFor="com" className="form-label small text-secondary">Comentario</label>
          <textarea id="com" rows="5" maxLength={2500}
            className={`form-control ${errorCampo(error, 'comentario') ? 'is-invalid' : ''}`}
            placeholder="Describe cómo funcionó la herramienta (mínimo 2 caracteres)"
            value={comentario} onChange={(e) => setComentario(e.target.value)}></textarea>
          <div className="invalid-feedback">{errorCampo(error, 'comentario')}</div>
          <div className="form-text">{comentario.length}/2500 caracteres · mínimo 2</div>
        </div>

        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-accent flex-fill py-2" disabled={comentario.length < 2}>Enviar comentario</button>
          <button type="button" className="btn btn-outline-secondary flex-fill py-2" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
