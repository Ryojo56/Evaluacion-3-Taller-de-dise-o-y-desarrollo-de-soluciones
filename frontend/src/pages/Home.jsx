import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { CCard, CCardBody, CCol, CRow } from '@coreui/react'
import { useAuth } from '../context/AuthContext.jsx'
import { useApi } from '../useApi.js'
import { Cargando } from '../components/Estados.jsx'

// Gráficos de CoreUI: solo para admin y bodeguero, cargados aparte (Chart.js es pesado)
const DashboardGraficos = lazy(() => import('../components/DashboardGraficos.jsx'))

export default function Home() {
  const { usuario } = useAuth()
  const { data } = useApi('/resumen/') // GET /api/resumen/
  const esTrabajador = usuario.rol === 'trabajador'
  const esRRHH = usuario.rol === 'rrhh'
  const gestor = ['admin', 'bodeguero'].includes(usuario.rol)

  // Accesos rápidos según el rol
  const accesos = {
    admin: [
      { to: '/reportes?tipo=items', texto: 'Reporte de inventario' },
      { to: '/solicitudes', texto: `Solicitudes por entregar${data?.solicitudes_pendientes ? ` (${data.solicitudes_pendientes})` : ''}` },
      { to: '/usuarios/nuevo', texto: 'Crear usuario' },
      { to: '/catalogo-trabajador', texto: 'Solicitar materiales' },
      { to: '/movimientos', texto: 'Registro de movimientos' },
      { to: '/reportes?tipo=usuarios', texto: 'Reporte de personal' },
    ],
    bodeguero: [
      { to: '/catalogo', texto: 'Inventario' },
      { to: '/movimientos', texto: 'Registro de movimientos' },
      { to: '/solicitudes', texto: `Solicitudes${data?.solicitudes_pendientes ? ` (${data.solicitudes_pendientes})` : ''}` },
    ],
    rrhh: [
      { to: '/usuarios/nuevo', texto: 'Crear usuario' },
      { to: '/reportes?tipo=usuarios', texto: 'Reporte de personal' },
      { to: '/reportes?tipo=prestamos&estado=vencidos', texto: 'Préstamos vencidos' },
    ],
    trabajador: [
      { to: '/catalogo-trabajador', texto: 'Solicitar materiales' },
      { to: '/mis-prestamos', texto: 'Mis préstamos' },
      { to: '/mis-prestamos?vista=pendientes', texto: `Mis solicitudes${data?.mis_solicitudes_pendientes ? ` (${data.mis_solicitudes_pendientes})` : ''}` },
    ],
  }[usuario.rol]

  // [Colores] Cada tarjeta tiene su color de estado y lleva a la lista correspondiente
  const deBodega = [
    { titulo: 'Bodegas', valor: data?.bodegas, color: 'info', to: gestor ? '/bodegas' : null },
    { titulo: 'Sin stock o en stock crítico', valor: data?.criticos, color: 'danger', to: gestor ? '/catalogo?estado=alerta' : null },
    gestor && { titulo: 'Con stock bajo', valor: data?.stock_bajo, color: 'warning', to: '/catalogo?estado=Stock%20bajo' },
    { titulo: esTrabajador ? 'Mis herramientas por devolver' : 'Préstamos activos', valor: data?.prestamos_activos,
      color: 'primary', to: esTrabajador ? '/mis-prestamos' : gestor ? '/prestamos' : null },
  ].filter(Boolean)
  const dePersonas = [
    { titulo: 'Usuarios activos', valor: data?.usuarios_activos, color: 'success', to: '/usuarios' },
    { titulo: 'Con clave temporal', valor: data?.claves_temporales, color: 'warning', to: '/usuarios' },
    { titulo: 'Préstamos vencidos', valor: data?.prestamos_vencidos, color: 'danger', to: '/reportes?tipo=prestamos&estado=vencidos' },
  ]
  const tarjetas = esRRHH ? dePersonas : usuario.rol === 'admin' ? [...deBodega, ...dePersonas] : deBodega

  return (
    <>
      <h1 className="h3 fw-bold mb-1">Hola, {usuario.nombre}</h1>
      <div className="mb-4" />

      <CRow className="g-3 mb-4">
        {tarjetas.map((t) => {
          const contenido = (
            <CCard className={`h-100 border-start border-start-4 border-start-${t.color} stat`}>
              <CCardBody>
                <div className="text-body-secondary small text-uppercase fw-semibold">{t.titulo}</div>
                <div className={`fs-2 fw-bold text-${t.color}`}>{t.valor ?? '–'}</div>
              </CCardBody>
            </CCard>
          )
          return (
            <CCol xs={6} md={4} xl={tarjetas.length > 4 ? 2 : 3} key={t.titulo}>
              {t.to ? <Link to={t.to} className="text-decoration-none">{contenido}</Link> : contenido}
            </CCol>
          )
        })}
      </CRow>

      {gestor && (
        <Suspense fallback={<Cargando />}>
          <DashboardGraficos />
        </Suspense>
      )}

      <h2 className="h5 text-body-secondary mb-3">Accesos rápidos</h2>
      <CRow className="g-3">
        {accesos.map((l) => (
          <CCol xs={12} md={4} key={l.to}>
            <Link to={l.to} className="btn btn-outline-primary w-100 py-3">{l.texto}</Link>
          </CCol>
        ))}
      </CRow>
    </>
  )
}
