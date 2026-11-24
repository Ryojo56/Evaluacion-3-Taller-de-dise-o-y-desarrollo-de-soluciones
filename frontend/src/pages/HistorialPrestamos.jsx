import { useMemo, useState } from 'react'
import { CButton } from '@coreui/react'
import TablaDatos from '../components/TablaDatos.jsx'
import { useApi } from '../useApi.js'
import { api, errorGeneral } from '../api.js'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'
import { fechaCL } from '../utils.js'
import { EstadoBadge, Cargando, AlertaError } from '../components/Estados.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import MisPrestamos from './MisPrestamos.jsx'
import RecepcionHerramienta from '../components/RecepcionHerramienta.jsx'
import FiltrosHistorial from '../components/FiltrosHistorial.jsx'
import AvisoHistorial from '../components/AvisoHistorial.jsx'
import { FILTROS_VACIOS, filtrarHistorial } from '../filtrosHistorial.js'

// /prestamos: el trabajador ve SU historial; bodeguero y admin ven el historial global
export default function HistorialPrestamos() {
  const { usuario } = useAuth()
  return usuario.rol === 'trabajador' ? <MisPrestamos /> : <PrestamosGlobales />
}

const CONDICION = {
  por_recibir: (p) => p.por_recibir,
  activos: (p) => p.activo && !p.anulado,
  vencidos: (p) => p.vencido,
  devueltos: (p) => !p.activo && !p.anulado,
  anulados: (p) => p.anulado,
}

function PrestamosGlobales() {
  const { data, cargando, error, recargar } = useApi('/prestamos/') // GET /api/prestamos/
  const [modo, setModo] = useState('herramientas')
  const { data: dataS, cargando: cargandoS } = useApi(modo === 'materiales' ? '/solicitudes/' : null)
  const [filtros, setFiltros] = useState(FILTROS_VACIOS)
  const [filtrosM, setFiltrosM] = useState(FILTROS_VACIOS)
  const [vista, setVista] = useState('')
  const [recibiendo, setRecibiendo] = useState(null)
  const { usuario } = useAuth()
  const dialogo = useDialogo()
  const avisar = useToast()

  // [CRUD admin] Extender el plazo o corregir el comentario de un préstamo
  const editar = (p) =>
    dialogo.formulario({
      titulo: `Editar préstamo de ${p.herramienta}`,
      campos: [
        ...(p.activo ? [{ name: 'fecha_limite', label: 'Fecha límite de devolución', valor: p.fecha_limite, tipo: 'date',
          min: p.entrega, ayuda: `Entregada el ${fechaCL(p.entrega)} a ${p.trabajador}.` }] : []),
        { name: 'comentario', label: 'Comentario', valor: p.comentario, tipo: 'textarea', maxLength: 2500 },
      ],
      textoBoton: 'Guardar cambios',
      alGuardar: async (v) => {
        await api.post(`/editarPrestamo/${p.id}/`, v)
        avisar('Préstamo actualizado.')
        recargar()
      },
    })

  // [CRUD admin] Anular un préstamo registrado por error (las herramientas vuelven a la bodega)
  const anular = (p) => dialogo.formulario({
    titulo: `Anular préstamo de ${p.herramienta}`,
    campos: [{ name: 'motivo', label: 'Motivo', tipo: 'textarea', maxLength: 200,
      ayuda: `Las herramientas (${p.unidades.join(', ') || p.cantidad}) vuelven a estar disponibles y el préstamo queda como anulado.` }],
    textoBoton: 'Anular préstamo',
    alGuardar: async (v) => { await api.post(`/anularPrestamo/${p.id}/`, v); avisar('Préstamo anulado.'); recargar() },
  })

  const conFiltros = useMemo(() => filtrarHistorial(data?.prestamos || [], filtros, 'entrega'), [data, filtros])
  const filtrados = useMemo(() => conFiltros.filter((p) => !vista || CONDICION[vista](p)), [conFiltros, vista])
  const entregas = useMemo(() => filtrarHistorial((dataS?.solicitudes || [])
    .filter((s) => s.tipo === 'material' && s.estado === 'Despachada'), filtrosM, 'fecha'), [dataS, filtrosM])
  const todasEntregas = useMemo(() => (dataS?.solicitudes || [])
    .filter((s) => s.tipo === 'material' && s.estado === 'Despachada'), [dataS])

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const VISTAS = [
    ['', 'Todos', conFiltros.length],
    ...[['por_recibir', 'Por recibir'], ['activos', 'En préstamo'], ['vencidos', 'Vencidos'], ['devueltos', 'Devueltos'],
      ['anulados', 'Anulados']].map(([v, t]) => [v, t, conFiltros.filter(CONDICION[v]).length]),
  ]

  // Colores según la devolución (vencido en rojo, por vencer en amarillo)
  const colorDevolucion = (d) => (d === 'Vencido' ? 'text-danger fw-semibold' : d.startsWith('Vence') ? 'text-warning-emphasis fw-semibold' : 'sku')

  const columnas = [
    { titulo: 'Herramienta', dato: 'herramienta', texto: (p) => `${p.herramienta} ${p.sku} ${p.unidades.join(' ')}`,
      render: (v, p) => (
        <div>
          <span className="fw-semibold">{v}</span> <span className="sku small">· {p.sku}</span>
          {p.unidades.length > 0 && <div className="small sku text-body-secondary">{p.unidades.join(', ')}</div>}
        </div>
      ) },
    { titulo: 'Trabajador', dato: 'trabajador' },
    { titulo: 'Bodega', dato: 'bodega', render: (v) => <span className="chip-bodega">{v}</span> },
    { titulo: 'Entrega', dato: 'entrega', clase: 'text-nowrap', render: (v) => <span className="sku">{fechaCL(v)}</span> },
    { titulo: 'Devolución', dato: 'devolucion', clase: 'text-nowrap', render: (v) => <span className={colorDevolucion(v)}>{v}</span> },
    { titulo: 'Responsable', dato: 'responsable' },
    { titulo: 'Estado', dato: 'estado', render: (v) => <EstadoBadge estado={v} /> },
    { titulo: 'Acciones', acciones: (p) => (
      <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
        {p.activo
          ? <CButton size="sm" className="btn-accent" onClick={() => setRecibiendo(p)}>Recibir</CButton>
          : <span className="small text-body-secondary align-self-center">{p.anulado ? 'Anulado' : 'Devuelta'}</span>}
        {usuario.rol === 'admin' && <CButton size="sm" color="primary" variant="outline" onClick={() => editar(p)}>Editar</CButton>}
        {usuario.rol === 'admin' && p.activo && <CButton size="sm" color="danger" variant="outline" onClick={() => anular(p)}>Anular</CButton>}
      </div>
    ) },
  ]

  return (
    <>
      <h1 className="h3 fw-bold mb-0">Historial de préstamos y entregas</h1>
      <p className="text-body-secondary">Herramientas prestadas y materiales entregados a los trabajadores</p>

      <ul className="nav nav-pills reporte-tabs mb-3">
        {[['herramientas', 'Préstamos de herramientas'], ['materiales', 'Entregas de materiales']].map(([m, texto]) => (
          <li className="nav-item" key={m}>
            <button className={`nav-link ${modo === m ? 'active' : ''}`} onClick={() => setModo(m)}>{texto}</button>
          </li>
        ))}
      </ul>

      {modo === 'herramientas' ? (
        <>
          <AvisoHistorial data={data} que="préstamos" />
          <FiltrosHistorial datos={data.prestamos} filtros={filtros} setFiltros={setFiltros}
            campos={['trabajador', 'bodega', 'categoria', 'estado']} etiquetaFecha="Entrega"
            estados={['En préstamo', 'Por recibir', 'Bueno', 'Regular', 'Con falla', 'Anulado']} />
          <div className="pills-filtro mb-3">
            {VISTAS.map(([v, t, n]) => (
              <button key={v || 'todos'} className={`btn ${vista === v ? 'active' : ''}`} onClick={() => setVista(v)}>
                {t} <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis ms-1">{n}</span>
              </button>
            ))}
          </div>
          <TablaDatos key="prestamos" datos={filtrados} columnas={columnas} titulo="Préstamos de herramientas" archivo="prestamos"
            orden={[[3, 'desc']]} vacio="Sin préstamos con estos filtros" />
        </>
      ) : cargandoS && !dataS ? <Cargando /> : (
        <>
          <AvisoHistorial data={dataS} que="solicitudes" />
          <FiltrosHistorial datos={todasEntregas} filtros={filtrosM} setFiltros={setFiltrosM}
            campos={['trabajador', 'categoria']} etiquetaFecha="Fecha" />
          <p className="small text-body-secondary">
            {entregas.length} entregas · {new Set(entregas.map((s) => s.trabajador)).size} trabajadores
          </p>
          <TablaDatos key="entregas" datos={entregas} titulo="Entregas de materiales" archivo="entregas-materiales"
            orden={[[4, 'desc']]} vacio="Sin entregas con estos filtros" columnas={[
              { titulo: 'Material', dato: 'producto', texto: (s) => `${s.producto} ${s.sku}`,
                render: (v, s) => <><span className="fw-semibold">{v}</span> <span className="sku small">· {s.sku}</span></> },
              { titulo: 'Categoría', dato: 'categoria', render: (v) => <span className="small">{v}</span> },
              { titulo: 'Cantidad', dato: 'cantidad', clase: 'text-end text-nowrap',
                render: (v, s) => <><span className="fw-semibold">{v}</span> <span className="small text-body-secondary">{s.unidad}</span></> },
              { titulo: 'Trabajador', dato: 'trabajador' },
              { titulo: 'Fecha', dato: 'fecha', clase: 'text-nowrap', render: (v) => <span className="sku">{fechaCL(v)}</span> },
              { titulo: 'Entregado por', dato: 'entregado_por', render: (v) => v || '—' },
              { titulo: 'Motivo', dato: 'motivo', render: (v) => <span className="small text-body-secondary">{v || '—'}</span> },
            ]} />
        </>
      )}

      {recibiendo && (
        <RecepcionHerramienta prestamo={recibiendo} onCerrar={() => setRecibiendo(null)}
          onRecibida={() => { setRecibiendo(null); recargar() }} />
      )}
    </>
  )
}
