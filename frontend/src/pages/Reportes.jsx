import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../useApi.js'
import { errorGeneral } from '../api.js'
import { AlertaError, Cargando } from '../components/Estados.jsx'
import TablaReporte from '../components/TablaReporte.jsx'
import GraficosReporte from '../components/GraficosReporte.jsx'
import Icono from '../components/Iconos.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const TIPOS_ITEM = [['herramienta', 'Herramienta'], ['material', 'Material']]

const FILTROS = {
  q: { param: 'q', label: 'Buscar', tipo: 'texto', placeholder: 'Nombre, SKU, correo...' },
  fechas: { tipo: 'fechas' },
  categoria: { param: 'categoria', label: 'Categoría', tipo: 'select', origen: 'categorias', todos: 'Todas' },
  bodega: { param: 'bodega', label: 'Bodega', tipo: 'select', origen: 'bodegas', todos: 'Todas' },
  trabajador: { param: 'trabajador', label: 'Trabajador', tipo: 'select', origen: 'trabajadores', todos: 'Todos' },
  tipo: { param: 'tipo', label: 'Tipo', tipo: 'select', opciones: TIPOS_ITEM, todos: 'Todos' },
  estadoItem: { param: 'estado', label: 'Estado del stock', tipo: 'select', todos: 'Todos',
    opciones: ['Disponible', 'Stock bajo', 'Crítico', 'Sin stock'].map((e) => [e, e]) },
  ocupacion: { param: 'ocupacion', label: 'Ocupación', tipo: 'select', todos: 'Todas',
    opciones: [['alta', '80 % o más (casi llenas)'], ['con_espacio', 'Menos de 80 % (con espacio)']] },
  estadoPrestamo: { param: 'estado', label: 'Estado', tipo: 'select', todos: 'Todos',
    opciones: [['activos', 'Sin devolver'], ['vencidos', 'Vencidos'], ['devueltos', 'Devueltos']] },
  condicion: { param: 'condicion', label: 'Devuelto en estado', tipo: 'select', todos: 'Cualquiera',
    opciones: [['Bueno', 'Bueno'], ['Regular', 'Regular'], ['Con falla', 'Con falla']] },
  estadoSolicitud: { param: 'estado', label: 'Estado', tipo: 'select', todos: 'Todos',
    opciones: [['Pendiente', 'Pendiente'], ['Despachada', 'Despachada'], ['Cancelada', 'Cancelada']] },
  excede: { param: 'excede', label: 'Stock', tipo: 'select', todos: 'Todas',
    opciones: [['si', 'Solo las que superan el stock']] },
  rol: { param: 'rol', label: 'Rol', tipo: 'select', todos: 'Todos',
    opciones: [['admin', 'Administrador'], ['bodeguero', 'Bodeguero'], ['trabajador', 'Trabajador'], ['rrhh', 'Recursos humanos']] },
  estadoUsuario: { param: 'estado', label: 'Estado', tipo: 'select', todos: 'Solo activos',
    opciones: [['inactivos', 'Solo inactivos'], ['todos', 'Activos e inactivos']] },
}

const SOLO_ADMIN = ['admin']
const PERSONAS = ['admin', 'rrhh']
const REPORTES = [
  { tipo: 'items', texto: 'Inventario', roles: SOLO_ADMIN, filtros: ['q', 'categoria', 'tipo', 'bodega', 'estadoItem'] },
  { tipo: 'bodegas', texto: 'Bodegas', roles: SOLO_ADMIN, filtros: ['q', 'bodega', 'ocupacion'] },
  { tipo: 'prestamos', texto: 'Préstamos', roles: PERSONAS,
    filtros: ['fechas', 'estadoPrestamo', 'condicion', 'trabajador', 'bodega'], etiquetaFechas: 'Fecha de entrega' },
  { tipo: 'solicitudes', texto: 'Solicitudes', roles: PERSONAS,
    filtros: ['fechas', 'estadoSolicitud', 'tipo', 'trabajador', 'excede'], etiquetaFechas: 'Fecha de solicitud' },
  { tipo: 'usuarios', texto: 'Usuarios', roles: PERSONAS,
    filtros: ['q', 'rol', 'estadoUsuario', 'fechas'], etiquetaFechas: 'Fecha de creación' },
]

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const ATAJOS = [
  { texto: 'Hoy', desde: () => iso(new Date()) },
  { texto: '7 días', desde: () => haceDias(6) },
  { texto: '30 días', desde: () => haceDias(29) },
  { texto: 'Este mes', desde: () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)) } },
]

export default function Reportes() {
  const { usuario } = useAuth()
  const [params, setParams] = useSearchParams()
  const disponibles = REPORTES.filter((r) => r.roles.includes(usuario.rol))
  const porDefecto = usuario.rol === 'rrhh' ? disponibles.find((r) => r.tipo === 'usuarios') : disponibles[0]
  const reporte = disponibles.find((r) => r.tipo === params.get('tipo')) || porDefecto

  const permitidos = reporte.filtros.flatMap((f) => (f === 'fechas' ? ['desde', 'hasta'] : [FILTROS[f].param]))
  const consulta = new URLSearchParams()
  permitidos.forEach((p) => params.get(p) && consulta.set(p, params.get(p)))
  const textoConsulta = consulta.toString()

  const { data, cargando, error, recargar } = useApi(`/reportes/${reporte.tipo}/${textoConsulta ? `?${textoConsulta}` : ''}`)

  const usa = (origen) => reporte.filtros.some((f) => FILTROS[f].origen === origen)
  const { data: dBod } = useApi(usa('bodegas') ? '/bodegas/' : null)
  const { data: dCat } = useApi(usa('categorias') ? '/categorias/' : null)
  const { data: dUsu } = useApi(usa('trabajadores') ? '/usuarios/' : null)
  const origenes = {
    bodegas: dBod?.bodegas.map((b) => [String(b.id), b.nombre]) || [],
    categorias: dCat?.categorias.map((c) => [String(c.id), c.nombre]) || [],
    trabajadores: dUsu?.usuarios.filter((u) => u.rol === 'trabajador').map((u) => [String(u.id), u.nombre]) || [],
  }

  const cambiar = (cambios) => {
    const nuevo = new URLSearchParams(params)
    Object.entries(cambios).forEach(([k, v]) => (v ? nuevo.set(k, v) : nuevo.delete(k)))
    setParams(nuevo, { replace: true })
  }
  const elegirReporte = (tipo) => setParams({ tipo })
  const limpiar = () => setParams({ tipo: reporte.tipo })
  const hayFiltros = textoConsulta !== ''

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Reportes</h1>
          <p className="text-secondary mb-0">Inventario, bodegas, préstamos, solicitudes y usuarios</p>
        </div>
        <button className="btn btn-outline-secondary btn-sm" onClick={recargar} disabled={cargando}>↻ Actualizar</button>
      </div>

      <ul className="nav nav-pills reporte-tabs mb-3">
        {disponibles.map((r) => (
          <li className="nav-item" key={r.tipo}>
            <button className={`nav-link ${reporte.tipo === r.tipo ? 'active' : ''}`} onClick={() => elegirReporte(r.tipo)}>
              {r.texto}
            </button>
          </li>
        ))}
      </ul>

      <section className="filtros-card mb-3" aria-label="Filtros del reporte">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h2 className="h6 fw-semibold mb-0 d-flex align-items-center gap-2"><Icono nombre="filtro" size={16} /> Filtros</h2>
          {hayFiltros && <button className="btn btn-link btn-sm p-0 text-decoration-none" onClick={limpiar}>Limpiar filtros</button>}
        </div>
        <div className="row g-2 align-items-end">
          {reporte.filtros.map((f) =>
            f === 'fechas'
              ? <FiltroFechas key={f + reporte.tipo} etiqueta={reporte.etiquetaFechas} params={params} cambiar={cambiar} />
              : <Filtro key={f + reporte.tipo} def={FILTROS[f]} valor={params.get(FILTROS[f].param) || ''}
                  opciones={FILTROS[f].opciones || origenes[FILTROS[f].origen]} cambiar={cambiar} />
          )}
        </div>
      </section>

      {error && <AlertaError mensaje={errorGeneral(error)} />}
      {cargando && !data && <Cargando />}
      {data && !error && (
        <>
          <div className="row g-2 mb-3">
            {data.resumen.map((r) => (
              <div className="col-6 col-md" key={r.titulo}>
                <div className="kpi">
                  <div className="kpi-titulo">{r.titulo}</div>
                  <div className={`kpi-valor ${r.tono ? `text-${r.tono}-emphasis` : ''}`}>
                    {typeof r.valor === 'number' ? r.valor.toLocaleString('es-CL') : r.valor}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className={cargando ? 'opacity-50' : ''}><GraficosReporte graficos={data.graficos} /></div>

          <div className={`card p-3 reporte-card ${cargando ? 'opacity-50' : ''}`}>
            <div className="d-flex flex-wrap justify-content-between align-items-baseline gap-1 mb-2">
              <h2 className="h5 fw-semibold mb-0">{data.titulo}</h2>
              <span className="small text-secondary">{data.filas.length} registros · generado el {data.generado}</span>
            </div>
            {data.filtros.length > 0 && (
              <div className="d-flex flex-wrap gap-1 mb-2">
                {data.filtros.map((t) => <span key={t} className="filtro-chip">{t}</span>)}
              </div>
            )}
            <TablaReporte
              key={reporte.tipo + data.columnas.join('|') + textoConsulta}
              titulo={data.titulo}
              columnas={data.columnas}
              filas={data.filas}
              generado={data.generado}
              filtros={data.filtros}
              archivo={reporte.tipo}
            />
          </div>
        </>
      )}
    </>
  )
}

function Filtro({ def, valor, opciones, cambiar }) {
  const [texto, setTexto] = useState(valor)
  const [anterior, setAnterior] = useState(valor)
  if (valor !== anterior) { setAnterior(valor); setTexto(valor) }
  useEffect(() => {
    if (def.tipo !== 'texto' || texto === valor) return
    const t = setTimeout(() => cambiar({ [def.param]: texto.trim() }), 400)
    return () => clearTimeout(t)
  }, [texto, valor, def.tipo, def.param, cambiar])

  const id = `f-${def.param}`
  return (
    <div className={def.tipo === 'texto' ? 'col-12 col-md-4' : 'col-6 col-md-3 col-xl-2'}>
      <label htmlFor={id} className="form-label">{def.label}</label>
      {def.tipo === 'texto' ? (
        <input id={id} type="search" className="form-control" placeholder={def.placeholder}
          value={texto} onChange={(e) => setTexto(e.target.value)} />
      ) : (
        <select id={id} className={`form-select ${valor ? 'border-warning' : ''}`} value={valor}
          onChange={(e) => cambiar({ [def.param]: e.target.value })}>
          <option value="">{def.todos}</option>
          {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      )}
    </div>
  )
}

function FiltroFechas({ etiqueta, params, cambiar }) {
  const desde = params.get('desde') || ''
  const hasta = params.get('hasta') || ''
  const invertidas = desde && hasta && desde > hasta
  return (
    <div className="col-12 col-lg-6">
      <span className="form-label d-block">{etiqueta}</span>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <input type="date" className={`form-control ${invertidas ? 'is-invalid' : ''}`} style={{ maxWidth: 170 }}
          aria-label={`${etiqueta}: desde`} value={desde} max={hasta || undefined} onChange={(e) => cambiar({ desde: e.target.value })} />
        <span className="text-secondary small">a</span>
        <input type="date" className={`form-control ${invertidas ? 'is-invalid' : ''}`} style={{ maxWidth: 170 }}
          aria-label={`${etiqueta}: hasta`} value={hasta} min={desde || undefined} onChange={(e) => cambiar({ hasta: e.target.value })} />
        <div className="btn-group btn-group-sm" role="group" aria-label="Rangos rápidos">
          {ATAJOS.map((a) => (
            <button key={a.texto} type="button" className="btn btn-outline-secondary"
              onClick={() => cambiar({ desde: a.desde(), hasta: iso(new Date()) })}>{a.texto}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
