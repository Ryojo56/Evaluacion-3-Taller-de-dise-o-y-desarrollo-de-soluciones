import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../api.js'
import Icono from './Iconos.jsx'

const TODOS = ['admin', 'bodeguero', 'trabajador', 'rrhh']
const GESTION_USUARIOS = ['admin', 'rrhh']
const GESTORES = ['admin', 'bodeguero']

const SECCIONES = [
  {
    id: 'general',
    links: [{ to: '/', texto: 'Inicio', icono: 'inicio', roles: TODOS }],
  },
  {
    id: 'inventario', titulo: 'Inventario', icono: 'caja',
    links: [
      { to: '/catalogo', texto: 'Catálogo y stock', icono: 'lista', roles: GESTORES, activo: ['/items'] },
      { to: '/catalogo-trabajador', texto: 'Catálogo', icono: 'lista', roles: ['trabajador'], activo: ['/solicitar'] },
      { to: '/catalogo-trabajador', texto: 'Solicitar materiales', icono: 'solicitud', roles: ['admin'], activo: ['/solicitar'] },
      { to: '/bodegas', texto: 'Bodegas', icono: 'bodega', roles: GESTORES },
      { to: '/categorias', texto: 'Categorías', icono: 'etiqueta', roles: GESTORES },
    ],
  },
  {
    id: 'operaciones', titulo: 'Operaciones', icono: 'operaciones',
    links: [
      { to: '/solicitudes', texto: 'Solicitudes', icono: 'solicitud', roles: GESTORES, contador: 'solicitudes_pendientes' },
      { to: '/prestamos', texto: 'Préstamos', icono: 'herramienta', roles: GESTORES, activo: ['/devolucion'] },
      { to: '/mis-prestamos', texto: 'Mis préstamos', icono: 'herramienta', roles: ['trabajador'],
        activo: ['/devolucion', '/prestamos'], vista: '' },
      { to: '/mis-prestamos?vista=pendientes', texto: 'Mis solicitudes', icono: 'solicitud', roles: ['trabajador'],
        activo: ['/prestamos'], vista: 'pendientes', contador: 'mis_solicitudes_pendientes' },
      { to: '/mis-prestamos', texto: 'Mis préstamos', icono: 'herramienta', roles: ['admin'], vista: '' },
      { to: '/mis-prestamos?vista=pendientes', texto: 'Mis solicitudes', icono: 'solicitud', roles: ['admin'],
        vista: 'pendientes', contador: 'mis_solicitudes_pendientes' },
    ],
  },
  {
    id: 'administracion', titulo: 'Administración', icono: 'admin',
    links: [
      { to: '/usuarios', texto: 'Usuarios', icono: 'usuarios', roles: GESTION_USUARIOS },
      { to: '/reportes', texto: 'Reportes', icono: 'reporte', roles: GESTION_USUARIOS },
    ],
  },
]

const ROLES = { admin: 'Administrador', bodeguero: 'Bodeguero', trabajador: 'Trabajador', rrhh: 'Recursos humanos' }

function estaActivo(link, { pathname, search }) {
  const ruta = link.to.split('?')[0]
  if (ruta === '/') return pathname === '/'
  const coincide = [ruta, ...(link.activo || [])].some((r) => pathname === r || pathname.startsWith(r + '/'))
  if (!coincide) return false
  if (link.vista === undefined) return true
  if (pathname.startsWith('/devolucion')) return link.vista === ''
  const vista = new URLSearchParams(search).get('vista') === 'pendientes' ? 'pendientes' : ''
  return vista === link.vista
}

function leerPlegados() {
  try { return JSON.parse(localStorage.getItem('menu-plegado') || '{}') } catch { return {} }
}

export default function Layout() {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [abierto, setAbierto] = useState(false)
  const [plegados, setPlegados] = useState(leerPlegados)
  const [contadores, setContadores] = useState({})

  useEffect(() => {
    api.get('/resumen/').then(setContadores).catch(() => {})
  }, [location.pathname, location.search])

  const cerrarMenu = () => setAbierto(false)

  useEffect(() => {
    if (!abierto) return
    const alPresionar = (e) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('keydown', alPresionar)
    document.body.classList.add('menu-abierto')
    return () => {
      document.removeEventListener('keydown', alPresionar)
      document.body.classList.remove('menu-abierto')
    }
  }, [abierto])

  const plegar = (id) => {
    const nuevo = { ...plegados, [id]: !plegados[id] }
    setPlegados(nuevo)
    try { localStorage.setItem('menu-plegado', JSON.stringify(nuevo)) } catch { }
  }

  const iniciales = usuario.nombre.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()

  const salir = async () => {
    await logout()
    navigate('/login')
  }

  const secciones = SECCIONES
    .map((s) => ({ ...s, links: s.links.filter((l) => l.roles.includes(usuario.rol)) }))
    .filter((s) => s.links.length)

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn btn-icono" onClick={() => setAbierto(true)} aria-label="Abrir menú" aria-expanded={abierto}>
          <Icono nombre="menu" size={22} />
        </button>
        <div className="d-flex align-items-center gap-2 fw-semibold">
          <div className="logo logo-sm"></div> Bodega Central
        </div>
        <Link to="/perfil" className="avatar text-decoration-none" title="Mi perfil" aria-label="Mi perfil">{iniciales}</Link>
      </header>

      {abierto && <div className="sidebar-fondo" onClick={() => setAbierto(false)} />}

      <aside className={`sidebar ${abierto ? 'abierto' : ''}`} aria-label="Menú principal">
        <div className="sb-head d-flex align-items-center gap-3">
          <div className="logo"></div>
          <div className="flex-fill">
            <div className="fw-semibold">Bodega Central</div>
            <span className="badge badge-role">{ROLES[usuario.rol]}</span>
          </div>
          <button className="btn btn-icono text-white d-lg-none" onClick={() => setAbierto(false)} aria-label="Cerrar menú">
            <Icono nombre="cerrar" />
          </button>
        </div>

        <nav className="sb-nav">
          {secciones.map((s) => {
            const contieneActivo = s.links.some((l) => estaActivo(l, location))
            const plegado = s.titulo && plegados[s.id] && !contieneActivo
            return (
              <div key={s.id} className="sb-seccion">
                {s.titulo && (
                  <button className="sb-titulo" onClick={() => plegar(s.id)} aria-expanded={!plegado}>
                    <span>{s.titulo}</span>
                    <Icono nombre="flecha" size={14} className={plegado ? 'girado' : ''} />
                  </button>
                )}
                {!plegado && s.links.map((l) => (
                  <Link key={l.texto} to={l.to} onClick={cerrarMenu} className={`nav-link ${estaActivo(l, location) ? 'active' : ''}`}
                    aria-current={estaActivo(l, location) ? 'page' : undefined}>
                    <Icono nombre={l.icono} />
                    <span className="flex-fill">{l.texto}</span>
                    {l.contador && contadores[l.contador] > 0 && <span className="sb-contador">{contadores[l.contador]}</span>}
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="sb-foot">
          <Link to="/perfil" onClick={cerrarMenu} className={`nav-link ${location.pathname === '/perfil' ? 'active' : ''}`}>
            <span className="avatar avatar-sm">{iniciales}</span>
            <span className="flex-fill text-truncate">
              <span className="d-block small fw-semibold text-truncate">{usuario.nombre}</span>
              <span className="d-block sb-sub">Mi perfil</span>
            </span>
          </Link>
          <button className="nav-link w-100 text-start" onClick={salir}>
            <Icono nombre="salir" /> <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
