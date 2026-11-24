import { Link } from 'react-router-dom'
import { CBadge, CCard, CCardBody, CCardHeader, CCol, CRow } from '@coreui/react'
import { useApi } from '../useApi.js'
import { api, errorGeneral } from '../api.js'
import { AlertaError, Cargando } from '../components/Estados.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'

// ============================================================================
// [CRUD admin] Papelera: lo eliminado (soft delete) se puede revisar y RESTAURAR.
// Nada se borra físicamente, así el historial de préstamos y movimientos no se pierde.
// ============================================================================
const GRUPOS = [
  { tipo: 'bodegas', titulo: 'Bodegas', color: 'info' },
  { tipo: 'categorias', titulo: 'Categorías', color: 'warning' },
  { tipo: 'items', titulo: 'Ítems del catálogo', color: 'primary' },
]

export default function Papelera() {
  const { data, cargando, error, recargar } = useApi('/papelera/')
  const dialogo = useDialogo()
  const avisar = useToast()

  const restaurar = async (tipo, o) => {
    const ok = await dialogo.confirmar({
      titulo: 'Restaurar',
      mensaje: <>¿Restaurar <strong>{o.nombre}</strong>? Volverá a aparecer en el sistema.</>,
      textoBoton: 'Restaurar',
    })
    if (!ok) return
    try {
      await api.post(`/restaurar/${tipo}/${o.id}/`)
      avisar(`${o.nombre} fue restaurado.`)
      recargar()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  // [CRUD admin] Borrado definitivo: solo funciona si el registro no tiene historial
  const borrar = async (tipo, o) => {
    const ok = await dialogo.confirmar({
      titulo: 'Eliminar definitivamente', peligro: true, textoBoton: 'Eliminar para siempre',
      mensaje: <>¿Borrar <strong>{o.nombre}</strong> para siempre? Esto no se puede deshacer.</>,
    })
    if (!ok) return
    try {
      await api.post(`/eliminarDefinitivo/${tipo}/${o.id}/`)
      avisar(`${o.nombre} se eliminó definitivamente.`)
      recargar()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Papelera</h1>
          <p className="text-body-secondary mb-0">Bodegas, categorías e ítems eliminados</p>
        </div>
        <Link to="/usuarios?vista=eliminados" className="btn btn-outline-secondary">Ver usuarios eliminados →</Link>
      </div>
      <CRow className="g-3">
        {GRUPOS.map((g) => (
          <CCol lg={4} key={g.tipo}>
            <CCard className={`h-100 border-top border-top-3 border-top-${g.color}`}>
              <CCardHeader className="bg-transparent fw-semibold d-flex justify-content-between">
                {g.titulo} <CBadge color={g.color}>{data[g.tipo].length}</CBadge>
              </CCardHeader>
              <CCardBody className="p-0">
                {data[g.tipo].length === 0 && <p className="text-body-secondary small p-3 mb-0">Nada en la papelera.</p>}
                <ul className="list-group list-group-flush">
                  {data[g.tipo].map((o) => (
                    <li key={o.id} className="list-group-item d-flex justify-content-between align-items-center gap-2">
                      <div style={{ minWidth: 0 }}>
                        <div className="fw-semibold text-truncate">
                          {o.sku && <span className="sku me-1">{o.sku}</span>}{o.nombre}
                        </div>
                        <div className="small text-body-secondary">Eliminado el {o.eliminado} por {o.eliminado_por}</div>
                      </div>
                      <div className="d-flex gap-1 flex-shrink-0">
                        <button type="button" className="btn btn-sm btn-crear" onClick={() => restaurar(g.tipo, o)}>Restaurar</button>
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => borrar(g.tipo, o)}
                          title="Eliminar definitivamente">Borrar</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CCardBody>
            </CCard>
          </CCol>
        ))}
      </CRow>
    </>
  )
}
