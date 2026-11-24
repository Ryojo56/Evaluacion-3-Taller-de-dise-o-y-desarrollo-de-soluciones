import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CIcon from '@coreui/icons-react'
import { cilBell } from '@coreui/icons'
import { useApi } from '../useApi.js'

// ============================================================================
// Campana de notificaciones: muestra cuántas cosas hay pendientes y, al hacer
// clic, abre un panel con lo que el usuario tiene que revisar según su rol.
// Los datos vienen de GET /api/notificaciones/ (Django decide qué ve cada rol).
// ============================================================================
const PUNTO = { danger: 'bg-danger', warning: 'bg-warning', success: 'bg-success', info: 'bg-primary' }

export default function Notificaciones() {
  const { data, cargando, recargar } = useApi('/notificaciones/')
  const [abierto, setAbierto] = useState(false)
  const caja = useRef(null)

  // Cerrar al hacer clic fuera del panel o con la tecla Escape
  useEffect(() => {
    if (!abierto) return
    const clicFuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false) }
    const tecla = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', clicFuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', clicFuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  const alternar = () => {
    if (!abierto) recargar() // al abrir, trae lo más reciente
    setAbierto(!abierto)
  }

  const total = data?.total ?? 0

  return (
    <div className="notif" ref={caja}>
      <button type="button" className="btn btn-link nav-link position-relative px-2" onClick={alternar}
        aria-label={`Notificaciones${total ? `: ${total} pendientes` : ''}`} aria-expanded={abierto} aria-haspopup="dialog">
        <CIcon icon={cilBell} size="lg" />
        {total > 0 && (
          <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {abierto && (
        <div className="notif-panel card" role="dialog" aria-label="Notificaciones">
          <div className="notif-cabecera">
            <span className="fw-bold">Notificaciones</span>
            <span className="small text-secondary">{total ? `${total} por revisar` : ''}</span>
          </div>

          {cargando && !data ? (
            <div className="p-3 small text-secondary">Cargando...</div>
          ) : data?.grupos.length === 0 ? (
            <div className="p-4 text-center">
              <div className="fs-4 text-success">✓</div>
              <div className="fw-semibold">Todo al día</div>
              <div className="small text-secondary">No tienes nada pendiente por revisar.</div>
            </div>
          ) : (
            <div className="notif-lista">
              {data.grupos.map((g) => (
                <div className="notif-grupo" key={g.tipo}>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span className={`notif-punto ${PUNTO[g.nivel] || 'bg-secondary'}`}></span>
                    <span className="fw-semibold small flex-fill">{g.titulo}</span>
                    <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis">{g.cantidad}</span>
                  </div>
                  <ul className="list-unstyled small mb-1 ms-3">
                    {g.items.map((it, i) => (
                      <li key={i} className="d-flex justify-content-between gap-2">
                        <span className="text-truncate">{it.texto}</span>
                        <span className="text-secondary text-nowrap">{it.detalle}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to={g.enlace} className="small ms-3 notif-ver" onClick={() => setAbierto(false)}>
                    {g.cantidad > g.items.length ? `Ver los ${g.cantidad} →` : 'Ver →'}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
