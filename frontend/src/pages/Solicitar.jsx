import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorCampo, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { AlertaError, Cargando } from '../components/Estados.jsx'

export default function Solicitar() {
  const { sku } = useParams()
  const { usuario } = useAuth()
  const { data, cargando, error: errorCarga } = useApi(`/items/${sku}/`) // GET /api/items/<sku>/
  const navigate = useNavigate()
  const [cantidad, setCantidad] = useState(1)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState(null)
  const [enviada, setEnviada] = useState(false)
  // [Doble envío] evita crear dos solicitudes iguales con un doble clic
  const [enviando, setEnviando] = useState(false)

  if (cargando) return <Cargando />
  if (errorCarga) return <p>Ítem no encontrado. <Link to="/catalogo-trabajador">Volver</Link></p>

  const item = data.item
  const hoy = new Date().toLocaleDateString('es-CL').replaceAll('/', '-')
  const MIN_MOTIVO = 10
  const excede = Number(cantidad) > item.stock_total
  const motivoCorto = excede && motivo.trim().length < MIN_MOTIVO
  const cantidadInvalida = !(Number(cantidad) >= 1)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (enviando) return
    setEnviando(true)
    try {
      await api.post('/addSolicitud/', { sku, cantidad: Number(cantidad), motivo: motivo.trim() }) // POST /api/addSolicitud/
      setEnviada(true)
    } catch (err) {
      setError(err)
      setEnviando(false)
    }
  }

  if (enviada) {
    return (
      <div className="card p-4" style={{ maxWidth: 640 }}>
        <h1 className="h5 fw-bold">✓ Solicitud enviada</h1>
        <p className="text-secondary">
          Pediste {cantidad} × {item.nombre}. Quedó <strong>Pendiente</strong> hasta que el bodeguero la entregue.
          {excede && ' Como superaba el stock disponible, se entregará cuando la bodega reponga lo que falta.'}
        </p>
        <div className="d-flex gap-2">
          <Link to="/mis-prestamos?vista=pendientes" className="btn btn-accent flex-fill">Ver mis solicitudes</Link>
          <Link to="/catalogo-trabajador" className="btn btn-outline-secondary flex-fill">Volver al catálogo</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="card-header bg-body d-flex justify-content-between align-items-center p-3">
        <h1 className="h6 fw-bold mb-0">Solicitar herramienta o material</h1>
        <Link to="/catalogo-trabajador" className="small text-secondary text-decoration-none">← Volver al catálogo</Link>
      </div>
      <form className="card-body p-4" onSubmit={handleSubmit}>
        <div className="d-flex justify-content-between align-items-center bg-light rounded-3 p-3 mb-4">
          <div>
            <div className="fw-semibold">{item.nombre}</div>
            <div className="sku">SKU: {item.sku}</div>
            <div className="small text-body-secondary">{item.categoria}</div>
          </div>
          <div className="text-end">
            <span className={`badge ${item.stock_total > 0 ? 'bg-success-subtle text-success-emphasis' : 'bg-secondary-subtle text-secondary-emphasis'}`}>
              Disponible: {item.stock_total} {item.unidad}
            </span>
            {Object.keys(item.stock).length > 0 && (
              <div className="d-flex flex-wrap gap-1 justify-content-end mt-2">
                {Object.entries(item.stock).sort((a, b) => b[1] - a[1]).map(([b, n]) => (
                  <span key={b} className="chip-bodega">{b} · <b>{n}</b></span>
                ))}
              </div>
            )}
          </div>
        </div>
        <AlertaError mensaje={errorGeneral(error)} />
        <div className="mb-3">
          <label htmlFor="cant" className="form-label small text-secondary">Cantidad requerida</label>
          <div className="input-group has-validation">
            <input type="number" id="cant" min="1" max="10000"
              className={`form-control ${errorCampo(error, 'cantidad') || cantidadInvalida ? 'is-invalid' : ''}`}
              value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            <span className="input-group-text">{item.unidad}</span>
            <div className="invalid-feedback">{errorCampo(error, 'cantidad') || 'La cantidad mínima es 1.'}</div>
          </div>
        </div>
        {excede && (
          <div className="alert alert-warning small py-2" role="status">
            <strong>Pides más de lo que hay en bodega</strong> ({cantidad} de {item.stock_total} {item.unidad} disponibles).
            Puedes enviar la solicitud, pero debes explicar el motivo. Se entregará cuando se reponga el stock.
          </div>
        )}
        <div className="mb-3">
          <label htmlFor="mot" className="form-label small text-secondary">
            Motivo / tarea asociada {excede ? <strong className="text-danger">(obligatorio)</strong> : '(opcional)'}
          </label>
          <textarea id="mot" rows="3" maxLength={500}
            className={`form-control ${errorCampo(error, 'motivo') ? 'is-invalid' : ''}`}
            placeholder={excede ? 'Ej. Comienza la obra del galpón 4 y se necesitan para toda la cuadrilla'
                                : 'Ej. Mantención eléctrica taller B'}
            value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-required={excede}></textarea>
          <div className="invalid-feedback">{errorCampo(error, 'motivo')}</div>
          {excede && (
            <div className={`form-text ${motivoCorto ? 'text-danger' : 'text-success'}`}>
              {motivo.trim().length}/{MIN_MOTIVO} caracteres mínimos
            </div>
          )}
        </div>
        <div className="alert alert-light border small">
          La solicitud quedará registrada con tu nombre ({usuario.nombre}) y la fecha de hoy, {hoy}, con estado{' '}
          <strong>Pendiente</strong> hasta ser revisada por el Bodeguero.
        </div>
        <div className="d-flex gap-2 mt-4">
          <button type="submit" className="btn btn-accent flex-fill py-2" disabled={motivoCorto || cantidadInvalida || enviando}>
            {enviando ? 'Enviando...' : excede ? 'Enviar solicitud con motivo' : 'Enviar solicitud'}
          </button>
          <button type="button" className="btn btn-outline-secondary flex-fill py-2" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
