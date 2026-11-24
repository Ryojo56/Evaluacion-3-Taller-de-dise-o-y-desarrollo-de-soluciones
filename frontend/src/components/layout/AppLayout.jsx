import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { CContainer, CFooter } from '@coreui/react'
import { api } from '../../api.js'
import AppSidebar from './AppSidebar.jsx'
import AppHeader from './AppHeader.jsx'

// ============================================================================
// [CoreUI] Reemplaza al antiguo Layout.jsx. Misma estructura que DefaultLayout
// del template (sidebar + wrapper con header, contenido y footer), pero el
// contenido es el <Outlet /> de React Router: las rutas y los permisos por rol
// de App.jsx no cambian. El estado del menú vive aquí (no hace falta Redux).
// ============================================================================
// [Menú] Desde 768 px el menú lateral está siempre visible (mismo punto que $mobile-breakpoint en style.scss)
const ESCRITORIO = '(min-width: 768px)'

export default function AppLayout() {
  const location = useLocation()
  const [escritorio, setEscritorio] = useState(() => window.matchMedia(ESCRITORIO).matches)
  const [visible, setVisible] = useState(false)   // solo se usa en celular
  // Barra lateral colapsable (solo íconos): la preferencia se recuerda
  const [colapsada, setColapsadaEstado] = useState(() => {
    try { return localStorage.getItem('menu-colapsado') === '1' } catch { return false }
  })
  const setColapsada = (valor) => {
    setColapsadaEstado(valor)
    try { localStorage.setItem('menu-colapsado', valor ? '1' : '0') } catch { /* sin almacenamiento */ }
  }
  const [contadores, setContadores] = useState({})

  // Contadores del menú (solicitudes pendientes, etc.): se refrescan al cambiar de PÁGINA.
  // [Optimización] Antes también con cada cambio de filtro (?q=, ?estado=...), lo que
  // disparaba una consulta extra al servidor por cada tecla o filtro elegido.
  useEffect(() => {
    api.get('/resumen/').then(setContadores).catch(() => {})
  }, [location.pathname])

  // Si se agranda o achica la ventana, el menú se adapta (antes podía quedar oculto)
  useEffect(() => {
    const mq = window.matchMedia(ESCRITORIO)
    const cambio = (e) => { setEscritorio(e.matches); setVisible(false) }
    mq.addEventListener('change', cambio)
    return () => mq.removeEventListener('change', cambio)
  }, [])

  return (
    <div>
      <AppSidebar visible={visible} setVisible={setVisible} escritorio={escritorio} colapsada={colapsada}
        setColapsada={setColapsada} contadores={contadores} />
      <div className="wrapper d-flex flex-column min-vh-100">
        <AppHeader escritorio={escritorio} onMenu={() => setVisible(!visible)} />
        <main className="body flex-grow-1">
          <CContainer className="px-3 px-md-4 pb-4" fluid>
            <Outlet />
          </CContainer>
        </main>
        <CFooter className="px-4 no-imprimir">
          <span className="text-body-secondary small">Sistema de Gestión de Bodega</span>
        </CFooter>
      </div>
    </div>
  )
}
