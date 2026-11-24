import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CBadge, CButton, CCol, CFormInput, CFormLabel, CFormSelect, CModal, CModalBody, CModalFooter, CModalHeader,
  CModalTitle, CRow,
} from '@coreui/react'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { EstadoBadge } from './Estados.jsx'
import { useToast } from './Toasts.jsx'

// ============================================================================
// Ventana "Ver detalle" del catálogo: nombre, cantidad total, bodegas y
// estantes/áreas donde está cada SKU, y traslado entre espacios.
// Si hay varios ítems con el mismo nombre (grupo), se muestran todos juntos.
// ============================================================================
export const TIPO_ESPACIO = { estante: 'Estante', area: 'Área libre' }

export default function DetalleItem({ grupo, onCerrar, onCambio, esAdmin, onEliminar }) {
  const [trasladando, setTrasladando] = useState(null)   // sku del ítem que se traslada
  return (
    <CModal visible size="lg" onClose={onCerrar} aria-labelledby="detalle-item-titulo" scrollable>
      <CModalHeader>
        <CModalTitle id="detalle-item-titulo">{grupo.nombre}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <CRow className="g-2 mb-3">
          {[
            ['Cantidad total', grupo.total, 'primary'],
            ['Bodegas', grupo.bodegas.length, 'info'],
            ['Estantes / áreas', grupo.espacios, 'success'],
            ['Registros (SKU)', grupo.items.length, 'warning'],
          ].map(([t, v, c]) => (
            <CCol xs={6} md={3} key={t}>
              <div className={`kpi border-top-0 border-start border-4 border-${c}`}>
                <div className="kpi-titulo">{t}</div><div className={`kpi-valor text-${c}`}>{v}</div>
              </div>
            </CCol>
          ))}
        </CRow>
        {grupo.bodegas.length > 0 && (
          <div className="mb-3">
            <div className="small fw-semibold text-body-secondary text-uppercase mb-1">Stock por bodega</div>
            {grupo.bodegas.map(([b, n]) => (
              <div key={b} className="d-flex align-items-center gap-2 mb-1 small">
                <span className="text-truncate" style={{ width: 170 }}>{b}</span>
                <div className="progress flex-grow-1" style={{ height: 8 }} role="progressbar" aria-label={`${b}: ${n}`}
                  aria-valuenow={n} aria-valuemin={0} aria-valuemax={grupo.total}>
                  <div className="progress-bar bg-warning" style={{ width: `${grupo.total ? (n * 100) / grupo.total : 0}%` }} />
                </div>
                <span className="fw-semibold text-end" style={{ width: 90 }}>{n.toLocaleString('es-CL')} {grupo.unidad}</span>
              </div>
            ))}
          </div>
        )}
        {grupo.items.length > 1 && (
          <div className="alert alert-warning py-2 small">
            Este producto está registrado {grupo.items.length} veces. Lo ideal es dejar el stock en uno solo.
          </div>
        )}

        {grupo.items.map((i) => (
          <section key={i.sku} className="border rounded-3 p-3 mb-3">
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
              <div>
                <span className="sku me-2">{i.sku}</span>
                <CBadge color={i.tipo === 'herramienta' ? 'info' : 'primary'} shape="rounded-pill">{i.tipo}</CBadge>
                <div className="small text-body-secondary mt-1">
                  {i.categoria} · stock mínimo {i.stock_minimo} {i.unidad} · total <strong>{i.stock_total}</strong> {i.unidad}
                </div>
              </div>
              <EstadoBadge estado={i.estado} />
            </div>
            {i.ubicaciones.length ? (
              <table className="table table-sm align-middle mb-2">
                <thead><tr><th>Bodega</th><th>Lugar</th><th className="text-end">Cantidad</th></tr></thead>
                <tbody>
                  {i.ubicaciones.map((u) => (
                    <tr key={u.espacio_id}>
                      <td>{u.bodega}</td>
                      <td>
                        <span className={`chip-ubicacion ${u.tipo_espacio}`}>{TIPO_ESPACIO[u.tipo_espacio]}</span>{' '}
                        {u.espacio}
                      </td>
                      <td className="text-end fw-semibold">{u.cantidad} <span className="small fw-normal text-body-secondary">{i.unidad}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="small text-body-secondary mb-2">No hay stock de este ítem en ninguna bodega.</p>}
            <div className="d-flex flex-wrap gap-2">
              <Link to={`/items/${i.sku}/editar`} className="btn btn-sm btn-outline-primary">Editar / ajustar stock</Link>
              {i.ubicaciones.length > 0 && (
                <CButton size="sm" color="success" variant="outline" onClick={() => setTrasladando(trasladando === i.sku ? null : i.sku)}>
                  Trasladar
                </CButton>
              )}
              {i.tipo === 'herramienta' && <Link to={`/items/${i.sku}/unidades`} className="btn btn-sm btn-outline-info">Códigos</Link>}
              <Link to={`/movimientos?sku=${i.sku}`} className="btn btn-sm btn-outline-secondary">Registro de movimientos</Link>
              {esAdmin && (
                <CButton size="sm" color="danger" variant="outline" disabled={i.stock_total > 0}
                  title={i.stock_total > 0 ? 'Solo se elimina con stock 0' : 'Eliminar'} onClick={() => onEliminar(i)}>
                  Eliminar
                </CButton>
              )}
            </div>
            {trasladando === i.sku && <FormTraslado item={i} onListo={() => { setTrasladando(null); onCambio() }} />}
          </section>
        ))}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" onClick={onCerrar}>Cerrar</CButton>
      </CModalFooter>
    </CModal>
  )
}

// Mover stock de un estante/área a otro (también a otra bodega)
function FormTraslado({ item, onListo }) {
  const { data } = useApi('/espacios/')
  const avisar = useToast()
  const [origen, setOrigen] = useState(String(item.ubicaciones[0].espacio_id))
  const [destino, setDestino] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)
  const max = item.ubicaciones.find((u) => String(u.espacio_id) === origen)?.cantidad || 0

  const enviar = async (e) => {
    e.preventDefault()
    setEnviando(true)
    try {
      await api.post(`/trasladarStock/${item.sku}/`, { origen: Number(origen), destino: Number(destino), cantidad: Number(cantidad) })
      avisar(`Se trasladaron ${cantidad} unidad(es) de ${item.nombre}.`)
      onListo()
    } catch (err) {
      setError(err)
      setEnviando(false)
    }
  }

  const porBodega = {}
  for (const e of data?.espacios || []) (porBodega[e.bodega] ||= []).push(e)

  return (
    <form onSubmit={enviar} className="filtros-card mt-3">
      <CRow className="g-2 align-items-end">
        <CCol md={4}>
          <CFormLabel htmlFor={`o-${item.sku}`}>Desde</CFormLabel>
          <CFormSelect id={`o-${item.sku}`} value={origen} onChange={(e) => setOrigen(e.target.value)}>
            {item.ubicaciones.map((u) => (
              <option key={u.espacio_id} value={u.espacio_id}>{u.bodega} · {u.espacio} ({u.cantidad})</option>
            ))}
          </CFormSelect>
        </CCol>
        <CCol md={4}>
          <CFormLabel htmlFor={`d-${item.sku}`}>Hacia</CFormLabel>
          <CFormSelect id={`d-${item.sku}`} value={destino} onChange={(e) => setDestino(e.target.value)} required>
            <option value="">Elige estante o área...</option>
            {Object.entries(porBodega).map(([bodega, lista]) => (
              <optgroup key={bodega} label={bodega}>
                {lista.filter((x) => String(x.id) !== origen).map((x) => (
                  <option key={x.id} value={x.id}>{TIPO_ESPACIO[x.tipo]} · {x.nombre} — {x.disponible} libres</option>
                ))}
              </optgroup>
            ))}
          </CFormSelect>
        </CCol>
        <CCol xs={6} md={2}>
          <CFormLabel htmlFor={`c-${item.sku}`}>Cantidad</CFormLabel>
          <CFormInput id={`c-${item.sku}`} type="number" min={1} max={max} value={cantidad}
            onChange={(e) => setCantidad(e.target.value)} />
        </CCol>
        <CCol xs={6} md={2}>
          <CButton type="submit" className="btn-crear w-100" disabled={enviando || !destino || !(cantidad >= 1)}>
            {enviando ? 'Moviendo...' : 'Mover'}
          </CButton>
        </CCol>
      </CRow>
      {error && <div className="text-danger small mt-2">{error.errores ? Object.values(error.errores).flat().join(' ') : errorGeneral(error)}</div>}
    </form>
  )
}
