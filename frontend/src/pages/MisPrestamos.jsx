import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CButton } from '@coreui/react'
import { useApi } from '../useApi.js'
import { api, errorGeneral } from '../api.js'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'
import { fechaCL } from '../utils.js'
import { EstadoBadge, Cargando, AlertaError } from '../components/Estados.jsx'
import TablaDatos from '../components/TablaDatos.jsx'
import FiltrosHistorial from '../components/FiltrosHistorial.jsx'
import { FILTROS_VACIOS, filtrarHistorial } from '../filtrosHistorial.js'

// Historial PERSONAL del trabajador, separado en 3 pestañas (cada una es una tabla DataTables).
// Django ya filtra: /api/prestamos/ y /api/solicitudes/ solo devuelven lo suyo.
const VISTAS = [
  { id: 'herramientas', texto: 'Herramientas prestadas' },
  { id: 'materiales', texto: 'Materiales recibidos' },
  { id: 'pendientes', texto: 'Solicitudes pendientes' },
]

const colorDevolucion = (p) => (!p.activo ? 'sku' : p.devolucion === 'Vencido' ? 'text-danger fw-semibold'
  : p.devolucion.startsWith('Vence') ? 'text-warning-emphasis fw-semibold' : 'sku')

export default function MisPrestamos() {
  const { data: dataP, cargando: cargandoP, error: errorP } = useApi('/prestamos/?mias=1')
  const { data: dataS, cargando: cargandoS, error: errorS, recargar: recargarS } = useApi('/solicitudes/?mias=1')
  const [params, setParams] = useSearchParams()
  const dialogo = useDialogo()
  const avisar = useToast()
  const vista = VISTAS.some((v) => v.id === params.get('vista')) ? params.get('vista') : 'herramientas'
  const [filtrosH, setFiltrosH] = useState(FILTROS_VACIOS)
  const [filtrosM, setFiltrosM] = useState(FILTROS_VACIOS)

  // Herramientas: primero las que aún tengo, después las devueltas (más recientes primero)
  const herramientas = useMemo(() => [...(dataP?.prestamos || [])]
    .sort((a, b) => b.activo - a.activo || b.entrega.localeCompare(a.entrega)), [dataP])
  const materiales = useMemo(() => (dataS?.solicitudes || [])
    .filter((s) => s.tipo === 'material' && s.estado === 'Despachada'), [dataS])
  const herramientasFiltradas = useMemo(() => filtrarHistorial(herramientas, filtrosH, 'entrega'), [herramientas, filtrosH])
  const materialesFiltrados = useMemo(() => filtrarHistorial(materiales, filtrosM, 'fecha'), [materiales, filtrosM])
  const pendientes = useMemo(() => (dataS?.solicitudes || []).filter((s) => s.estado === 'Pendiente'), [dataS])

  // [CRUD] El trabajador puede cancelar sus propias solicitudes mientras no se entreguen
  const cancelar = async (s) => {
    const ok = await dialogo.confirmar({
      titulo: 'Cancelar solicitud', peligro: true, textoBoton: 'Cancelar solicitud',
      mensaje: <>¿Cancelar tu solicitud de <strong>{s.cantidad} × {s.producto}</strong>? Quedará registrada como cancelada.</>,
    })
    if (!ok) return
    try {
      await api.post(`/cancelarSolicitud/${s.id}/`)
      avisar('Solicitud cancelada.')
      recargarS()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  if (cargandoP || cargandoS) return <Cargando />
  if (errorP || errorS) return <AlertaError mensaje={errorGeneral(errorP || errorS)} />

  const activas = dataP.prestamos.filter((p) => p.activo).length
  const contador = { herramientas: activas, materiales: materiales.length, pendientes: pendientes.length }
  const producto = { titulo: 'Producto', dato: 'producto', texto: (s) => `${s.producto} ${s.sku}`,
    render: (v, s) => <><span className="fw-semibold">{v}</span> <span className="sku small text-body-secondary">· {s.sku}</span></> }
  const fecha = { titulo: 'Fecha solicitud', dato: 'fecha', clase: 'text-nowrap', render: (v) => <span className="sku">{fechaCL(v)}</span> }

  return (
    <>
      <h1 className="h3 fw-bold mb-0">Mis préstamos</h1>
      <p className="text-body-secondary">
        {activas === 0 ? 'No tienes herramientas por devolver.' : `Tienes ${activas} herramienta(s) por devolver.`}
      </p>

      <ul className="nav nav-pills reporte-tabs mb-3">
        {VISTAS.map((v) => (
          <li className="nav-item" key={v.id}>
            <button className={`nav-link ${vista === v.id ? 'active' : ''}`} onClick={() => setParams({ vista: v.id })}>
              {v.texto} <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis ms-1">{contador[v.id]}</span>
            </button>
          </li>
        ))}
      </ul>

      {/* key: cada pestaña es una tabla distinta (con sus propias columnas) */}
      {vista === 'herramientas' && (
        <>
        <FiltrosHistorial datos={herramientas} filtros={filtrosH} setFiltros={setFiltrosH}
          campos={['bodega', 'categoria', 'estado']} etiquetaFecha="Entrega"
          estados={['En préstamo', 'Por recibir', 'Bueno', 'Regular', 'Con falla', 'Anulado']} />
        <TablaDatos key="h" datos={herramientasFiltradas} titulo="Mis herramientas" archivo="mis-herramientas"
          vacio="No hay herramientas con estos filtros." columnas={[
            { titulo: 'Herramienta', dato: 'herramienta', texto: (p) => `${p.herramienta} ${p.sku} ${p.unidades.join(' ')}`,
              render: (v, p) => (
                <div>
                  <span className="fw-semibold">{v}</span> <span className="sku small">· {p.sku}</span>
                  {p.unidades.length > 0 && <div className="small sku text-body-secondary">{p.unidades.join(', ')}</div>}
                </div>
              ) },
            { titulo: 'Bodega', dato: 'bodega', render: (v) => <span className="chip-bodega">{v}</span> },
            { titulo: 'Entrega', dato: 'entrega', clase: 'text-nowrap', render: (v) => <span className="sku">{fechaCL(v)}</span> },
            { titulo: 'Devolución', dato: 'devolucion', clase: 'text-nowrap', render: (v, p) => <span className={colorDevolucion(p)}>{v}</span> },
            { titulo: 'Entregada por', dato: 'responsable' },
            { titulo: 'Estado', dato: 'estado', render: (v) => <EstadoBadge estado={v} /> },
            { titulo: 'Acciones', acciones: (p) => (!p.activo
              ? <span className="small text-body-secondary">Devuelta</span>
              : p.por_recibir
                ? <span className="small text-body-secondary">Entrégala en bodega</span>
                : <Link to={`/devolucion/${p.id}`} className="btn btn-accent btn-sm">Devolver</Link>) },
          ]} />
        </>
      )}
      {vista === 'materiales' && (
        <>
        <FiltrosHistorial datos={materiales} filtros={filtrosM} setFiltros={setFiltrosM} campos={['categoria']}
          etiquetaFecha="Fecha" />
        <TablaDatos key="m" datos={materialesFiltrados} titulo="Materiales recibidos" archivo="mis-materiales"
          vacio="No hay materiales con estos filtros." columnas={[
            producto,
            { titulo: 'Cantidad', dato: 'cantidad', clase: 'text-end text-nowrap',
              render: (v, s) => <><span className="fw-semibold">{v}</span> <span className="small text-body-secondary">{s.unidad}</span></> },
            fecha,
            { titulo: 'Entregado por', dato: 'entregado_por', render: (v) => v || '—' },
            { titulo: 'Motivo', dato: 'motivo', render: (v) => <span className="small text-body-secondary">{v || '—'}</span> },
          ]} />
        </>
      )}
      {vista === 'pendientes' && (
        <>
          <TablaDatos key="p" datos={pendientes} titulo="Solicitudes pendientes" archivo="mis-solicitudes"
            vacio="No tienes solicitudes pendientes." columnas={[
              producto,
              { titulo: 'Tipo', dato: 'tipo', texto: (s) => (s.tipo === 'herramienta' ? 'Herramienta (préstamo)' : 'Material') },
              { titulo: 'Cantidad', dato: 'cantidad', clase: 'text-end', render: (v, s) => (
                <>{v} <span className="small text-body-secondary">{s.unidad}</span>{s.excede_stock && <span className="badge bg-danger-subtle text-danger-emphasis ms-2">Supera el stock</span>}</>
              ) },
              fecha,
              { titulo: 'Estado', dato: 'estado', render: (v, s) => (
                <>
                  <EstadoBadge estado={v} />
                  {s.faltan > 0 && <div className="small text-body-secondary mt-1">Esperando reposición ({s.faltan} por llegar)</div>}
                </>
              ) },
              { titulo: 'Acciones', acciones: (s) => (
                <CButton size="sm" color="danger" variant="outline" onClick={() => cancelar(s)}>Cancelar</CButton>
              ) },
            ]} />
          <p className="small mt-2"><Link to="/catalogo-trabajador">Solicitar más materiales →</Link></p>
        </>
      )}
      <p className="small text-body-secondary mt-2">
        Las herramientas se prestan y se devuelven; los materiales (tornillos, cemento, EPP…) se entregan y no se devuelven.
      </p>
    </>
  )
}
