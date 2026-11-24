import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CBadge, CButton, CCol, CFormSelect, CRow } from '@coreui/react'
import { useApi } from '../useApi.js'
import { api, errorGeneral } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'
import { EstadoBadge, Cargando, AlertaError } from '../components/Estados.jsx'
import TablaDatos from '../components/TablaDatos.jsx'
import DetalleItem from '../components/DetalleItem.jsx'

// ============================================================================
// Catálogo y stock.
// - Los ítems con el MISMO NOMBRE se juntan en una sola fila (con "Ver detalle").
// - Columnas: código, nombre, tipo, categoría, cantidad y estado. Dónde está cada
//   unidad (bodega y estante/área) se ve en "Ver detalle".
// - La tabla es DataTables (búsqueda, orden, paginación y exportar).
// ============================================================================
const ESTADOS = [
  { valor: 'Disponible', color: 'success' },
  { valor: 'Stock bajo', color: 'warning' },
  { valor: 'Crítico', color: 'danger' },
  { valor: 'Sin stock', color: 'secondary' },
]
const ORDEN_ESTADO = { 'Sin stock': 0, 'Crítico': 1, 'Stock bajo': 2, 'Disponible': 3 }

// Misma regla que Django (models.estado_stock)
function estadoStock(total, minimo) {
  if (total <= 0) return 'Sin stock'
  if (total <= minimo) return 'Crítico'
  if (total <= minimo * 2) return 'Stock bajo'
  return 'Disponible'
}

const normalizar = (t) => t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

// Junta los ítems que se llaman igual (aunque estén escritos con otra mayúscula o tilde)
function agrupar(items) {
  const grupos = new Map()
  for (const i of items) {
    const clave = normalizar(i.nombre)
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(i)
  }
  return [...grupos.values()].map((lista) => {
    const total = lista.reduce((t, i) => t + i.stock_total, 0)
    const minimo = lista.reduce((t, i) => t + i.stock_minimo, 0)
    const porBodega = {}
    let espacios = 0
    for (const i of lista) {
      for (const u of i.ubicaciones) {
        porBodega[u.bodega] = (porBodega[u.bodega] || 0) + u.cantidad
        espacios++
      }
    }
    return {
      clave: lista[0].sku,
      nombre: lista[0].nombre,
      items: lista,
      skus: lista.map((i) => i.sku).join(', '),
      categoria: [...new Set(lista.map((i) => i.categoria))].join(' / '),
      categoria_ids: lista.map((i) => String(i.categoria_id)),
      tipo: lista[0].tipo,
      unidad: lista[0].unidad,
      total,
      estado: lista.length === 1 ? lista[0].estado : estadoStock(total, minimo),
      bodegas: Object.entries(porBodega).sort((a, b) => b[1] - a[1]),
      espacios,
    }
  })
}

export default function CatalogoStock() {
  const { usuario } = useAuth()
  const esAdmin = usuario.rol === 'admin'
  const dialogo = useDialogo()
  const avisar = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [detalle, setDetalle] = useState(null)

  const { data, cargando, error, recargar } = useApi('/items/')
  const { data: dataBodegas } = useApi('/bodegas/')
  const { data: dataCat } = useApi('/categorias/')

  const filtro = (clave) => params.get(clave) || ''
  const cambiar = (clave, valor) => {
    const nuevos = new URLSearchParams(params)
    if (valor) nuevos.set(clave, valor)
    else nuevos.delete(clave)
    setParams(nuevos, { replace: true })
  }

  const grupos = useMemo(() => (data ? agrupar(data.items) : []), [data])
  const categoriaElegida = params.get('categoria') || ''
  const idsCategoria = useMemo(() => (categoriaElegida
    ? [categoriaElegida, ...(dataCat?.categorias || []).filter((c) => String(c.padre_id) === categoriaElegida).map((c) => String(c.id))]
    : []), [categoriaElegida, dataCat])
  const nombreBodega = dataBodegas?.bodegas.find((b) => String(b.id) === filtro('bodega'))?.nombre
  const q = filtro('q').trim().toLowerCase()
  // Filtros rápidos (los de arriba); la búsqueda libre la hace el buscador de la tabla
  const visibles = useMemo(() => grupos.filter((g) =>
    (!filtro('estado') || (filtro('estado') === 'alerta' ? ['Sin stock', 'Crítico'].includes(g.estado) : g.estado === filtro('estado')))
    && (!filtro('categoria') || g.categoria_ids.some((id) => idsCategoria.includes(id)))
    && (!filtro('tipo') || g.tipo === filtro('tipo'))
    && (!nombreBodega || g.bodegas.some(([b]) => b === nombreBodega))
    // Búsqueda que viene del escáner del encabezado (nombre, SKU o código de herramienta)
    && (!q || g.nombre.toLowerCase().includes(q) || g.items.some((i) => q.startsWith(i.sku.toLowerCase())))
  ), [grupos, params, nombreBodega, idsCategoria]) // eslint-disable-line react-hooks/exhaustive-deps

  const conteo = Object.fromEntries(ESTADOS.map((e) => [e.valor, grupos.filter((g) => g.estado === e.valor).length]))
  const detalleActual = detalle && grupos.find((g) => g.clave === detalle)

  const eliminar = async (i) => {
    const ok = await dialogo.confirmar({
      titulo: 'Eliminar ítem',
      mensaje: <>¿Eliminar <strong>{i.nombre}</strong> ({i.sku}) del catálogo? Debe tener stock 0. Su historial se
        conserva y se puede restaurar desde la Papelera.</>,
      textoBoton: 'Eliminar', peligro: true,
    })
    if (!ok) return
    try {
      await api.post(`/deleteItem/${i.sku}/`)
      avisar(`${i.nombre} se movió a la papelera.`)
      recargar()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  const columnas = [
    { titulo: 'Código', dato: 'skus', clase: 'text-nowrap', render: (v) => <span className="sku">{v}</span> },
    {
      titulo: 'Nombre', dato: 'nombre',
      render: (v, g) => (
        <>
          <span className="fw-semibold">{v}</span>
          {g.items.length > 1 && <CBadge color="warning" className="ms-2">{g.items.length} registros</CBadge>}
        </>
      ),
    },
    {
      titulo: 'Tipo', dato: 'tipo', texto: (g) => (g.tipo === 'herramienta' ? 'Herramienta' : 'Material'),
      render: (v) => (
        <CBadge color={v === 'herramienta' ? 'info' : 'primary'} shape="rounded-pill">
          {v === 'herramienta' ? 'Herramienta' : 'Material'}
        </CBadge>
      ),
    },
    { titulo: 'Categoría', dato: 'categoria' },
    {
      titulo: 'Cantidad', dato: 'total', clase: 'text-end text-nowrap',
      render: (v, g) => (
        <><span className={`fw-bold ${v ? '' : 'text-body-secondary'}`}>{v.toLocaleString('es-CL')}</span>{' '}
          <span className="small text-body-secondary">{g.unidad}</span></>
      ),
    },
    {
      titulo: 'Por bodega', dato: 'bodegas', ordenable: false,
      texto: (g) => g.bodegas.map(([b, n]) => `${b}: ${n}`).join(' | '),
      render: (v) => (v.length ? (
        <div className="d-flex flex-wrap gap-1">
          {v.slice(0, 3).map(([b, n]) => (
            <span key={b} className={`chip-bodega ${nombreBodega && b !== nombreBodega ? 'vacia' : ''}`}>{b} · <b>{n}</b></span>
          ))}
          {v.length > 3 && <span className="chip-bodega vacia">+{v.length - 3}</span>}
        </div>
      ) : <span className="small text-body-secondary">Sin stock</span>),
    },
    {
      titulo: 'Estado', dato: 'estado',
      texto: (g) => g.estado, ordenar: (g) => ORDEN_ESTADO[g.estado],
      render: (v) => <EstadoBadge estado={v} />,
    },
    {
      titulo: 'Acciones',
      acciones: (g) => (
        <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
          <CButton size="sm" color="primary" onClick={() => setDetalle(g.clave)}>Ver detalle</CButton>
          {g.items.length === 1 && (
            <CButton size="sm" color="secondary" variant="outline" onClick={() => navigate(`/items/${g.clave}/editar`)}>Editar</CButton>
          )}
          {!esAdmin && ['Sin stock', 'Crítico', 'Stock bajo'].includes(g.estado) && (
            <CButton size="sm" color="warning" variant="outline" onClick={() => navigate(`/pedidos?nuevo=${g.clave}`)}>
              Pedir al admin
            </CButton>
          )}
          {esAdmin && g.items.length === 1 && (
            <CButton size="sm" color="danger" variant="outline" disabled={g.total > 0}
              title={g.total > 0 ? 'Solo se elimina con stock 0' : 'Eliminar'} onClick={() => eliminar(g.items[0])}>
              Eliminar
            </CButton>
          )}
        </div>
      ),
    },
  ]

  if (error) return <AlertaError mensaje={errorGeneral(error)} />
  const hayFiltros = ['estado', 'categoria', 'bodega', 'tipo', 'q'].some((k) => filtro(k))
  const alerta = filtro('estado') === 'alerta'

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Catálogo y stock</h1>
          <p className="text-body-secondary mb-0">
            {grupos.length} productos en {dataBodegas?.bodegas.length ?? '–'} bodegas
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {!esAdmin && <Link to="/pedidos?nuevo=1" className="btn btn-outline-warning boton-movil-ancho">Pedir al administrador</Link>}
          <Link to="/items/nuevo" className="btn btn-crear boton-movil-ancho">+ Registrar ítem</Link>
        </div>
      </div>

      <CRow className="g-2 mb-3" role="group" aria-label="Filtrar por estado de stock">
        {ESTADOS.map((e) => {
          const activo = filtro('estado') === e.valor
          return (
            <CCol xs={6} md={3} key={e.valor}>
              <button type="button" aria-pressed={activo}
                className={`card w-100 text-start p-3 border-start border-start-4 border-start-${e.color} ${activo ? `bg-${e.color}-subtle` : ''}`}
                onClick={() => cambiar('estado', activo ? '' : e.valor)}>
                <span className="small text-body-secondary fw-semibold text-uppercase">{e.valor}</span>
                <span className={`fs-4 fw-bold text-${e.color}`}>{data ? conteo[e.valor] : '–'}</span>
              </button>
            </CCol>
          )
        })}
      </CRow>

      <div className="filtros-card mb-3">
        <CRow className="g-2 align-items-center">
          <CCol xs={6} lg={3}>
            <CFormSelect className={filtro('categoria') ? 'filtro-activo' : ''} value={filtro('categoria')}
              onChange={(e) => cambiar('categoria', e.target.value)} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {dataCat?.categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.padre_id ? `\u00A0\u00A0\u00A0└ ${c.nombre}` : c.nombre}</option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs={6} lg={3}>
            <CFormSelect className={filtro('bodega') ? 'filtro-activo' : ''} value={filtro('bodega')}
              onChange={(e) => cambiar('bodega', e.target.value)} aria-label="Bodega">
              <option value="">Todas las bodegas</option>
              {dataBodegas?.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </CFormSelect>
          </CCol>
          <CCol xs={6} lg={3}>
            <CFormSelect className={filtro('tipo') ? 'filtro-activo' : ''} value={filtro('tipo')}
              onChange={(e) => cambiar('tipo', e.target.value)} aria-label="Tipo">
              <option value="">Herramientas y materiales</option>
              <option value="herramienta">Solo herramientas</option>
              <option value="material">Solo materiales</option>
            </CFormSelect>
          </CCol>
          <CCol xs={6} lg={3} className="d-flex gap-2">
            <CButton color="danger" variant={alerta ? undefined : 'outline'} className="flex-fill"
              onClick={() => cambiar('estado', alerta ? '' : 'alerta')}>
              Requieren reposición
            </CButton>
            {hayFiltros && <CButton color="secondary" variant="ghost" onClick={() => setParams({}, { replace: true })}>Limpiar</CButton>}
          </CCol>
        </CRow>
        {filtro('q') && <div className="small mt-2">Buscando: <span className="filtro-chip">{filtro('q')}</span></div>}
      </div>

      {cargando && !data ? <Cargando /> : (
        <TablaDatos datos={visibles} columnas={columnas} titulo="Catálogo y stock" archivo="catalogo-stock"
          orden={[[1, 'asc']]} vacio="No hay ítems con estos filtros" />
      )}

      {detalleActual && (
        <DetalleItem grupo={detalleActual} esAdmin={esAdmin} onCerrar={() => setDetalle(null)} onCambio={recargar}
          onEliminar={(i) => { setDetalle(null); eliminar(i) }} />
      )}
    </>
  )
}
