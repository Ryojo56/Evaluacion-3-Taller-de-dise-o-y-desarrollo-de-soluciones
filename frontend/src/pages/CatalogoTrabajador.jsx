import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CButton, CButtonGroup, CCol, CFormInput, CFormSelect, CRow } from '@coreui/react'
import { useApi } from '../useApi.js'
import { errorGeneral } from '../api.js'
import { EstadoBadge, Cargando, AlertaError } from '../components/Estados.jsx'
import TablaDatos from '../components/TablaDatos.jsx'

// ============================================================================
// Catálogo de materiales y herramientas (vista del trabajador).
// [UX] Antes eran 2 tarjetas grandes por fila: con muchos ítems costaba encontrar algo.
// Ahora: tarjetas compactas (4-5 por fila), filtros por categoría/tipo/disponibilidad,
// orden, paginación, y una vista de TABLA (DataTables) para buscar rápido.
// ============================================================================
const COLOR_ESTADO = { Disponible: '#16a34a', 'Stock bajo': '#f59e0b', 'Sin stock': '#94a3b8' }
const POR_PAGINA = 20
// En la vista del trabajador "Crítico" se muestra como "Stock bajo"
const estadoTrabajador = (e) => (e === 'Crítico' ? 'Stock bajo' : e)

export default function CatalogoTrabajador() {
  const { data, cargando, error } = useApi('/items/')
  const [params] = useSearchParams()
  const [buscar, setBuscar] = useState(params.get('q') || '')
  const [categoria, setCategoria] = useState('')
  const [tipo, setTipo] = useState('')
  const [bodega, setBodega] = useState('')
  const [soloDisponibles, setSoloDisponibles] = useState(false)
  const [orden, setOrden] = useState('nombre')
  const [vista, setVista] = useState('tarjetas')
  const [pagina, setPagina] = useState(1)
  const navigate = useNavigate()

  const items = useMemo(() => data?.items || [], [data])
  const categorias = useMemo(() => {
    const rutas = [...new Set(items.map((i) => i.categoria))]
    const principales = [...new Set(rutas.map((r) => r.split(' › ')[0]))].sort((a, b) => a.localeCompare(b, 'es'))
    return principales.flatMap((p) => [
      { valor: p, texto: p },
      ...rutas.filter((r) => r.startsWith(`${p} › `)).sort((a, b) => a.localeCompare(b, 'es'))
        .map((r) => ({ valor: r, texto: `\u00A0\u00A0\u00A0└ ${r.split(' › ')[1]}` })),
    ])
  }, [items])
  const bodegas = useMemo(() => [...new Set(items.flatMap((i) => Object.keys(i.stock)))].sort((a, b) => a.localeCompare(b, 'es')), [items])
  const visibles = useMemo(() => {
    const texto = buscar.trim().toLowerCase()
    return items
      .filter((i) => !texto || (i.nombre + ' ' + i.categoria + ' ' + i.sku).toLowerCase().includes(texto))
      .filter((i) => !categoria || i.categoria === categoria || i.categoria.startsWith(`${categoria} › `))
      .filter((i) => !bodega || (i.stock[bodega] || 0) > 0)
      .filter((i) => !tipo || i.tipo === tipo)
      .filter((i) => !soloDisponibles || i.stock_total > 0)
      .sort(orden === 'stock' ? (a, b) => b.stock_total - a.stock_total : (a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [items, buscar, categoria, tipo, bodega, soloDisponibles, orden])

  if (cargando) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA))
  const actual = Math.min(pagina, paginas)
  const enPagina = visibles.slice((actual - 1) * POR_PAGINA, actual * POR_PAGINA)
  const filtrar = (fn) => (e) => { fn(e.target.value); setPagina(1) }
  const porBodega = (i) => Object.entries(i.stock).sort((a, b) => b[1] - a[1])
  const chipsBodega = (i, maximo = 3) => {
    const lista = porBodega(i)
    if (!lista.length) return <span className="small text-body-secondary">Sin stock en ninguna bodega</span>
    return (
      <div className="d-flex flex-wrap gap-1">
        {lista.slice(0, maximo).map(([b, n]) => (
          <span key={b} className={`chip-bodega ${bodega && b !== bodega ? 'vacia' : ''}`} title={`${n} ${i.unidad} en ${b}`}>
            {b} · <b>{n}</b>
          </span>
        ))}
        {lista.length > maximo && (
          <span className="chip-bodega vacia" title={lista.slice(maximo).map(([b, n]) => `${b}: ${n}`).join('\n')}>
            +{lista.length - maximo}
          </span>
        )}
      </div>
    )
  }

  const solicitar = (i) => (
    <CButton size="sm" className={i.stock_total > 0 ? 'btn-accent w-100' : 'w-100'} color={i.stock_total > 0 ? undefined : 'secondary'}
      variant={i.stock_total > 0 ? undefined : 'outline'} onClick={() => navigate(`/solicitar/${i.sku}`)}
      title={i.stock_total > 0 ? 'Solicitar' : 'No hay stock: podrás pedirlo indicando el motivo'}>
      {i.stock_total > 0 ? 'Solicitar' : 'Pedir sin stock'}
    </CButton>
  )

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Catálogo de materiales y herramientas</h1>
          <p className="text-body-secondary mb-0">
            {visibles.length} de {items.length} ítems · ¿No encuentras algo? <Link to="/pedidos?nuevo=1">Pídelo al administrador</Link>
          </p>
        </div>
        <CButtonGroup role="group" aria-label="Forma de ver el catálogo">
          {[['tarjetas', 'Tarjetas'], ['tabla', 'Tabla']].map(([v, t]) => (
            <CButton key={v} className={vista === v ? 'btn-accent' : ''} color={vista === v ? undefined : 'secondary'}
              variant={vista === v ? undefined : 'outline'} onClick={() => setVista(v)}>{t}</CButton>
          ))}
        </CButtonGroup>
      </div>

      <div className="filtros-card mb-3">
        <CRow className="g-2 align-items-center">
          {vista === 'tarjetas' && (
            <CCol xs={12} lg={2}>
              <CFormInput type="search" placeholder="Buscar" value={buscar}
                onChange={filtrar(setBuscar)} aria-label="Buscar ítem" />
            </CCol>
          )}
          <CCol xs={6} lg={vista === 'tarjetas' ? 2 : 3}>
            <CFormSelect className={categoria ? 'filtro-activo' : ''} value={categoria} onChange={filtrar(setCategoria)} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.valor} value={c.valor}>{c.texto}</option>)}
            </CFormSelect>
          </CCol>
          <CCol xs={6} lg={vista === 'tarjetas' ? 2 : 3}>
            <CFormSelect className={bodega ? 'filtro-activo' : ''} value={bodega} onChange={filtrar(setBodega)} aria-label="Bodega">
              <option value="">Todas las bodegas</option>
              {bodegas.map((b) => <option key={b} value={b}>{b}</option>)}
            </CFormSelect>
          </CCol>
          <CCol xs={6} lg={2}>
            <CFormSelect className={tipo ? 'filtro-activo' : ''} value={tipo} onChange={filtrar(setTipo)} aria-label="Tipo">
              <option value="">Herramientas y materiales</option>
              <option value="herramienta">Herramientas (préstamo)</option>
              <option value="material">Materiales</option>
            </CFormSelect>
          </CCol>
          <CCol xs={6} lg={2}>
            <CFormSelect value={orden} onChange={filtrar(setOrden)} aria-label="Ordenar">
              <option value="nombre">Nombre A-Z</option>
              <option value="stock">Más disponibles</option>
            </CFormSelect>
          </CCol>
          <CCol xs={6} lg={2}>
            <CButton color="success" variant={soloDisponibles ? undefined : 'outline'} className="w-100"
              onClick={() => { setSoloDisponibles(!soloDisponibles); setPagina(1) }}>
              {soloDisponibles ? '✓ ' : ''}Con stock
            </CButton>
          </CCol>
        </CRow>
      </div>

      {vista === 'tabla' ? (
        <TablaDatos datos={visibles} titulo="Catálogo" archivo="catalogo" compacta vacio="No hay resultados" columnas={[
          { titulo: 'Ítem', dato: 'nombre', texto: (i) => `${i.nombre} ${i.sku}`,
            render: (v, i) => <><span className="fw-semibold">{v}</span> <span className="sku small text-body-secondary">{i.sku}</span></> },
          { titulo: 'Categoría', dato: 'categoria' },
          { titulo: 'Tipo', dato: 'tipo', texto: (i) => (i.tipo === 'herramienta' ? 'Herramienta' : 'Material') },
          { titulo: 'Disponibles', dato: 'stock_total', clase: 'text-end text-nowrap',
            render: (v, i) => <><span className="fw-semibold">{v}</span> <span className="small text-body-secondary">{i.unidad}</span></> },
          { titulo: 'Por bodega', dato: 'stock', ordenable: false,
            texto: (i) => porBodega(i).map(([b, n]) => `${b}: ${n}`).join(' | '), render: (_, i) => chipsBodega(i, 4) },
          { titulo: 'Estado', dato: 'estado', texto: (i) => estadoTrabajador(i.estado),
            render: (v) => <EstadoBadge estado={estadoTrabajador(v)} /> },
          { titulo: 'Acciones', acciones: (i) => <div style={{ minWidth: 130 }}>{solicitar(i)}</div> },
        ]} />
      ) : (
        <>
          {/* 2 por fila en celular, 3 en tablet, 4 en notebook y 5 en pantallas grandes */}
          <CRow className="g-3 row-cols-2 row-cols-md-3 row-cols-lg-4 row-cols-xxl-5">
            {enPagina.map((i) => {
              const estado = estadoTrabajador(i.estado)
              return (
                <CCol key={i.sku}>
                  <div className="card tarjeta-item h-100 p-2 p-md-3 d-flex flex-column"
                    style={{ '--color-estado': COLOR_ESTADO[estado] || '#16a34a' }}>
                    <div className="d-flex justify-content-between align-items-center gap-1 mb-1">
                      <span className="sku small text-body-secondary text-truncate">{i.sku}</span>
                      <EstadoBadge estado={estado} />
                    </div>
                    <div className="nombre-item" title={i.nombre}>{i.nombre}</div>
                    <div className="small text-body-secondary text-truncate mb-2">
                      {i.categoria} · {i.tipo === 'herramienta' ? 'préstamo' : 'material'}
                    </div>
                    <div className="d-flex align-items-baseline gap-1 mb-1">
                      <span className="fs-5 fw-bold">{bodega ? (i.stock[bodega] || 0) : i.stock_total}</span>
                      <span className="small text-body-secondary">{i.unidad} disponibles{bodega ? ` en ${bodega}` : ''}</span>
                    </div>
                    <div className="mb-2">{chipsBodega(i)}</div>
                    <div className="mt-auto">{solicitar(i)}</div>
                  </div>
                </CCol>
              )
            })}
          </CRow>
          {visibles.length === 0 && <p className="text-body-secondary mt-3">No hay resultados.</p>}
          {paginas > 1 && (
            <nav className="d-flex justify-content-center align-items-center gap-2 mt-4" aria-label="Páginas del catálogo">
              <CButton color="secondary" variant="outline" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}>Anterior</CButton>
              <span className="small text-body-secondary">Página {actual} de {paginas}</span>
              <CButton color="secondary" variant="outline" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>Siguiente</CButton>
            </nav>
          )}
        </>
      )}
    </>
  )
}
