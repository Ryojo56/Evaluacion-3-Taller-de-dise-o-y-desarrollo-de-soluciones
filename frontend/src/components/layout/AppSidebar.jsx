import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import SimpleBar from 'simplebar-react'
import 'simplebar-react/dist/simplebar.min.css'
import {
  CBadge, CCloseButton, CNavItem, CNavLink, CSidebar, CSidebarBrand, CSidebarFooter, CSidebarHeader, CSidebarNav,
  CSidebarToggler,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilChevronBottom } from '@coreui/icons'
import { useAuth } from '../../context/AuthContext.jsx'
import { ROLES, estaActivo, seccionesDe } from './navegacion.js'

// ============================================================================
// Menú lateral (CoreUI), filtrado por rol y ordenado en GRUPOS DESPLEGABLES:
// Inventario, Operaciones y Administración. Cada grupo se expande o contrae con
// un clic; lo que el usuario dejó abierto o cerrado se recuerda. Al entrar a una
// página, su grupo se abre solo (pero se puede volver a contraer).
// Barra lateral COLAPSABLE: el botón de abajo la reduce a solo íconos (y la vuelve
// a expandir). Al pasar el mouse por un ícono se ve el nombre de la página.
// ============================================================================
const CLAVE = 'menu-grupos-cerrados'

function leerCerrados() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || {} } catch { return {} }
}

export default function AppSidebar({ visible, setVisible, escritorio, colapsada, setColapsada, contadores }) {
  const { usuario } = useAuth()
  const location = useLocation()
  const [cerrados, setCerrados] = useState(leerCerrados)
  const cerrarEnMovil = () => !escritorio && setVisible(false)

  const guardar = (nuevo) => {
    setCerrados(nuevo)
    try { localStorage.setItem(CLAVE, JSON.stringify(nuevo)) } catch { /* sin almacenamiento */ }
  }
  const alternar = (id) => guardar({ ...cerrados, [id]: !cerrados[id] })

  // Al cambiar de página, se abre el grupo que la contiene (si estaba contraído)
  useEffect(() => {
    const grupo = seccionesDe(usuario.rol).find((s) => s.titulo && s.links.some((l) => estaActivo(l, location)))
    if (grupo && cerrados[grupo.id]) guardar({ ...cerrados, [grupo.id]: false })
  }, [location.pathname, location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  const angosta = escritorio && colapsada   // en celular el menú siempre se abre completo

  const enlace = (l) => {
    const activo = estaActivo(l, location)
    const cantidad = l.contador ? contadores[l.contador] : 0
    return (
      <CNavItem key={l.texto}>
        <CNavLink as={Link} to={l.to} active={activo} aria-current={activo ? 'page' : undefined} onClick={cerrarEnMovil}
          title={angosta ? l.texto : undefined}>
          <CIcon customClassName="nav-icon" icon={l.icono} />
          {l.texto}
          {cantidad > 0 && <CBadge color="primary" className="ms-auto">{cantidad}</CBadge>}
        </CNavLink>
      </CNavItem>
    )
  }

  return (
    // En escritorio el menú está SIEMPRE visible (no se puede ocultar); en celular se abre con "Menú"
    <CSidebar className="border-end" colorScheme="dark" position="fixed" visible={escritorio || visible} narrow={angosta}
      onVisibleChange={(v) => !escritorio && setVisible(v)} aria-label="Menú principal">
      <CSidebarHeader className="border-bottom">
        <CSidebarBrand as={Link} to="/" className="text-decoration-none d-flex align-items-center gap-2">
          <span className="marca-bodega">B</span>
          <span className="sidebar-brand-full">
            <span className="d-block fw-semibold text-white lh-1">Bodega Central</span>
            <small className="text-white-50">{ROLES[usuario.rol]}</small>
          </span>
        </CSidebarBrand>
        {!escritorio && <CCloseButton dark onClick={() => setVisible(false)} aria-label="Cerrar menú" />}
      </CSidebarHeader>

      <CSidebarNav as={SimpleBar}>
        {seccionesDe(usuario.rol).map((s) => {
          if (!s.titulo) return s.links.map(enlace)   // "Inicio" va suelto, arriba
          const abierto = !cerrados[s.id]   // también con el menú contraído (solo íconos)
          const pendientes = s.links.reduce((t, l) => t + (l.contador ? contadores[l.contador] || 0 : 0), 0)
          const idLista = `grupo-${s.id}`
          return (
            <li key={s.id} className={`grupo-menu ${abierto ? 'abierto' : ''}`}>
              <button type="button" className="grupo-menu-titulo" onClick={() => alternar(s.id)}
                aria-expanded={abierto} aria-controls={idLista}
                title={`${angosta ? `${s.titulo}: ` : ''}${abierto ? 'contraer' : 'expandir'}`}>
                <CIcon icon={s.icono} className="grupo-menu-icono" />
                <span className="flex-fill text-start">{s.titulo}</span>
                {!abierto && pendientes > 0 && <CBadge color="primary" shape="rounded-pill">{pendientes}</CBadge>}
                <span className="small text-white-50 ms-1">{s.links.length}</span>
                <CIcon icon={cilChevronBottom} className="grupo-menu-flecha" />
              </button>
              {abierto && <ul id={idLista} className="grupo-menu-items list-unstyled mb-0">{s.links.map(enlace)}</ul>}
            </li>
          )
        })}
      </CSidebarNav>

      {escritorio && (
        <CSidebarFooter className="border-top d-flex">
          <CSidebarToggler onClick={() => setColapsada(!colapsada)}
            aria-label={colapsada ? 'Expandir menú' : 'Contraer menú'} title={colapsada ? 'Expandir menú' : 'Contraer menú'} />
        </CSidebarFooter>
      )}
    </CSidebar>
  )
}
