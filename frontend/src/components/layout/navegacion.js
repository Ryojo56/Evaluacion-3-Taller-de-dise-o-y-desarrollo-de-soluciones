import {
  cilBuilding, cilChartPie, cilClipboard, cilHistory, cilList, cilPeople, cilSpeedometer, cilSwapHorizontal,
  cilTags, cilBriefcase, cilCart, cilTrash, cilStorage, cilTask, cilShieldAlt, cilInbox, cilSend,
} from '@coreui/icons'

// ============================================================================
// Menú lateral por rol (antes vivía dentro de Layout.jsx).
// Las secciones con título son GRUPOS DESPLEGABLES (se expanden o contraen).
// Cada link indica qué roles lo ven; el servidor IGUAL valida el permiso en
// cada endpoint (ocultar un link no es seguridad, solo comodidad).
// ============================================================================
export const TODOS = ['admin', 'bodeguero', 'trabajador', 'rrhh']
const GESTION_USUARIOS = ['admin', 'rrhh']
const GESTORES = ['admin', 'bodeguero']

export const ROLES = { admin: 'Administrador', bodeguero: 'Bodeguero', trabajador: 'Trabajador', rrhh: 'Recursos humanos' }

export const SECCIONES = [
  {
    id: 'general',
    links: [{ to: '/', texto: 'Inicio', icono: cilSpeedometer, roles: TODOS }],
  },
  {
    id: 'inventario', titulo: 'Inventario', icono: cilStorage,
    links: [
      { to: '/catalogo', texto: 'Catálogo y stock', icono: cilList, roles: GESTORES, activo: ['/items'] },
      { to: '/catalogo-trabajador', texto: 'Catálogo', icono: cilList, roles: ['trabajador'], activo: ['/solicitar'] },
      { to: '/catalogo-trabajador', texto: 'Solicitar materiales', icono: cilCart, roles: ['admin'], activo: ['/solicitar'] },
      { to: '/bodegas', texto: 'Bodegas', icono: cilBuilding, roles: GESTORES },
      { to: '/categorias', texto: 'Categorías', icono: cilTags, roles: GESTORES },
      { to: '/movimientos', texto: 'Registro de movimientos', icono: cilSwapHorizontal, roles: GESTORES },
    ],
  },
  {
    id: 'operaciones', titulo: 'Operaciones', icono: cilTask,
    links: [
      { to: '/solicitudes', texto: 'Solicitudes', icono: cilClipboard, roles: GESTORES, contador: 'solicitudes_pendientes' },
      { to: '/prestamos', texto: 'Préstamos', icono: cilBriefcase, roles: GESTORES, activo: ['/devolucion'] },
      { to: '/pedidos', texto: 'Pedidos recibidos', icono: cilInbox, roles: ['admin'], contador: 'pedidos_pendientes' },
      { to: '/pedidos', texto: 'Pedir al administrador', icono: cilSend, roles: ['bodeguero', 'trabajador', 'rrhh'] },
      { to: '/mis-prestamos', texto: 'Mis préstamos', icono: cilBriefcase, roles: ['trabajador'],
        activo: ['/devolucion', '/prestamos'], vista: '' },
      { to: '/mis-prestamos?vista=pendientes', texto: 'Mis solicitudes', icono: cilClipboard, roles: ['trabajador'],
        activo: ['/prestamos'], vista: 'pendientes', contador: 'mis_solicitudes_pendientes' },
      { to: '/mis-prestamos', texto: 'Mis préstamos', icono: cilBriefcase, roles: ['admin'], vista: '' },
      { to: '/mis-prestamos?vista=pendientes', texto: 'Mis solicitudes', icono: cilClipboard, roles: ['admin'],
        vista: 'pendientes', contador: 'mis_solicitudes_pendientes' },
    ],
  },
  {
    id: 'administracion', titulo: 'Administración', icono: cilShieldAlt,
    links: [
      { to: '/usuarios', texto: 'Usuarios', icono: cilPeople, roles: GESTION_USUARIOS },
      { to: '/reportes', texto: 'Reportes', icono: cilChartPie, roles: GESTION_USUARIOS },
      { to: '/usuarios?vista=eliminados', texto: 'Papelera de usuarios', icono: cilHistory, roles: GESTION_USUARIOS,
        activoExacto: true },
      { to: '/papelera', texto: 'Papelera de inventario', icono: cilTrash, roles: ['admin'] },
    ],
  },
]

export function estaActivo(link, { pathname, search }) {
  const [ruta, consulta] = link.to.split('?')
  if (ruta === '/') return pathname === '/'
  if (link.activoExacto) return pathname === ruta && search === `?${consulta}`
  if (pathname === '/usuarios' && search.includes('vista=eliminados')) return false
  const coincide = [ruta, ...(link.activo || [])].some((r) => pathname === r || pathname.startsWith(r + '/'))
  if (!coincide) return false
  if (link.vista === undefined) return true
  if (pathname.startsWith('/devolucion')) return link.vista === ''
  const vista = new URLSearchParams(search).get('vista') === 'pendientes' ? 'pendientes' : ''
  return vista === link.vista
}

export function seccionesDe(rol) {
  return SECCIONES
    .map((s) => ({ ...s, links: s.links.filter((l) => l.roles.includes(rol)) }))
    .filter((s) => s.links.length)
}

// Título de la página actual (para el encabezado)
export function tituloDe(location, rol) {
  for (const s of seccionesDe(rol)) {
    const link = s.links.find((l) => estaActivo(l, location))
    if (link) return link.texto
  }
  if (location.pathname === '/perfil') return 'Mi perfil'
  return 'Bodega'
}
