import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CBadge, CButton } from '@coreui/react'
import TablaDatos from '../components/TablaDatos.jsx'
import { useApi } from '../useApi.js'
import { api, errorGeneral } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'
import { Cargando, AlertaError } from '../components/Estados.jsx'

const ESTADOS = ['Pendiente', 'Aprobado', 'Rechazado', 'Cancelado']
const COLOR_ESTADO = { Pendiente: 'warning', Aprobado: 'success', Rechazado: 'danger', Cancelado: 'secondary' }
const COLOR_TIPO = { reposicion: 'info', nuevo: 'primary', otro: 'dark' }

export default function Pedidos() {
  const { usuario } = useAuth()
  const esAdmin = usuario.rol === 'admin'
  const dialogo = useDialogo()
  const avisar = useToast()
  const [params, setParams] = useSearchParams()
  const { data, cargando, error, recargar } = useApi('/pedidos/')
  const { data: dataItems } = useApi(esAdmin ? null : '/items/')
  const { data: dataBod } = useApi(esAdmin ? null : '/bodegas/')
  const estado = ESTADOS.includes(params.get('estado')) ? params.get('estado') : ''

  const pedidos = useMemo(() => data?.pedidos || [], [data])
  const visibles = useMemo(() => pedidos.filter((p) => !estado || p.estado === estado), [pedidos, estado])

  const elegirEstado = (e) => {
    const nuevos = new URLSearchParams(params)
    if (e) nuevos.set('estado', e)
    else nuevos.delete('estado')
    setParams(nuevos, { replace: true })
  }

  const nuevo = useCallback((sku = '') => {
    const productos = {}
    for (const i of dataItems?.items || []) {
      const grupo = i.categoria.split(' › ')[0]
      if (!productos[grupo]) productos[grupo] = []
      productos[grupo].push([i.sku, `${i.nombre} · ${i.sku} (hay ${i.stock_total} ${i.unidad})`])
    }
    return dialogo.formulario({
      titulo: 'Nuevo pedido al administrador',
      campos: [
        { name: 'tipo', label: 'Qué necesitas', tipo: 'select', valor: 'reposicion',
          placeholder: 'Selecciona...', columna: 'col-sm-6',
          opciones: [['reposicion', 'Reponer un producto del catálogo'], ['nuevo', 'Un producto que no está en el catálogo'],
            ['otro', 'Otra cosa (mantención, servicio...)']] },
        { name: 'prioridad', label: 'Prioridad', tipo: 'select', valor: 'normal', placeholder: 'Normal', columna: 'col-sm-6',
          opciones: [['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']] },
        { name: 'sku', label: 'Producto a reponer', tipo: 'select', valor: sku, placeholder: 'Elige un producto...',
          opciones: productos, ayuda: 'Solo si pides reponer un producto del catálogo.' },
        { name: 'descripcion', label: 'Descripción', maxLength: 150, placeholder: 'Ej. Arnés de seguridad talla L',
          ayuda: 'Obligatoria si es un producto nuevo u otra cosa.' },
        { name: 'cantidad', label: 'Cantidad', tipo: 'number', min: 1, valor: 1, columna: 'col-sm-5' },
        { name: 'bodega', label: 'Para qué bodega', tipo: 'select', placeholder: 'Cualquiera', columna: 'col-sm-7',
          opciones: (dataBod?.bodegas || []).map((b) => [b.id, b.nombre]) },
        { name: 'motivo', label: 'Motivo', tipo: 'textarea', filas: 3, maxLength: 1000,
          placeholder: 'Explica para qué se necesita y desde cuándo', ayuda: 'Mínimo 10 caracteres.' },
      ],
      textoBoton: 'Enviar pedido',
      alGuardar: async (v) => {
        await api.post('/addPedido/', {
          ...v, sku: v.tipo === 'reposicion' ? v.sku : '', bodega: v.bodega || null, cantidad: Number(v.cantidad),
        })
        avisar('Pedido enviado al administrador.')
        recargar()
      },
    })
  }, [dataItems, dataBod, dialogo, avisar, recargar])

  const abierto = useRef(null)
  useEffect(() => {
    const pedido = params.get('nuevo')
    if (!pedido) {
      abierto.current = null
      return
    }
    if (esAdmin || !dataItems || !dataBod || abierto.current === pedido) return
    abierto.current = pedido
    const nuevos = new URLSearchParams(params)
    nuevos.delete('nuevo')
    setParams(nuevos, { replace: true })
    nuevo(pedido === '1' ? '' : pedido)
  }, [params, dataItems, dataBod, esAdmin, nuevo, setParams])

  const responder = (p, aprobar) => dialogo.formulario({
    titulo: `${aprobar ? 'Aprobar' : 'Rechazar'} pedido de ${p.solicitante}`,
    campos: [{ name: 'respuesta', label: aprobar ? 'Mensaje para el solicitante (opcional)' : 'Motivo del rechazo',
      tipo: 'textarea', filas: 3, maxLength: 1000,
      placeholder: aprobar ? 'Ej. La compra llega el jueves' : 'Ej. No hay presupuesto este mes',
      ayuda: `${p.producto} × ${p.cantidad} ${p.unidad || ''}`.trim() }],
    textoBoton: aprobar ? 'Aprobar' : 'Rechazar',
    alGuardar: async (v) => {
      await api.post(`/responderPedido/${p.id}/`, { estado: aprobar ? 'Aprobado' : 'Rechazado', respuesta: v.respuesta })
      avisar(aprobar ? 'Pedido aprobado.' : 'Pedido rechazado.')
      recargar()
    },
  })

  const cancelar = async (p) => {
    const ok = await dialogo.confirmar({
      titulo: 'Cancelar pedido', peligro: true, textoBoton: 'Cancelar pedido',
      mensaje: <>¿Cancelar tu pedido de <strong>{p.cantidad} × {p.producto}</strong>?</>,
    })
    if (!ok) return
    try {
      await api.post(`/cancelarPedido/${p.id}/`)
      avisar('Pedido cancelado.')
      recargar()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const columnas = [
    { titulo: 'Fecha', dato: 'fecha', clase: 'text-nowrap', render: (v) => <span className="sku small">{v}</span> },
    ...(esAdmin ? [{ titulo: 'Solicitante', dato: 'solicitante', texto: (p) => `${p.solicitante} ${p.rol_solicitante}`,
      render: (v, p) => <div><span className="fw-semibold">{v}</span><div className="small text-body-secondary">{p.rol_solicitante}</div></div> }] : []),
    { titulo: 'Pedido', dato: 'producto', texto: (p) => `${p.tipo_texto} ${p.producto} ${p.sku || ''}`,
      render: (v, p) => (
        <div>
          <CBadge color={COLOR_TIPO[p.tipo]} shape="rounded-pill" className="me-1">{p.tipo_texto}</CBadge>
          <span className="fw-semibold">{v}</span>{p.sku && <span className="sku small text-body-secondary"> · {p.sku}</span>}
          {p.stock_actual !== null && <div className="small text-body-secondary">Stock actual: {p.stock_actual} {p.unidad}</div>}
        </div>
      ) },
    { titulo: 'Cantidad', dato: 'cantidad', clase: 'text-end text-nowrap',
      render: (v, p) => <><span className="fw-bold">{v}</span> <span className="small text-body-secondary">{p.unidad}</span></> },
    { titulo: 'Bodega', dato: 'bodega', texto: (p) => p.bodega || 'Cualquiera', render: (v) => (v ? <span className="chip-bodega">{v}</span> : <span className="small text-body-secondary">Cualquiera</span>) },
    { titulo: 'Prioridad', dato: 'prioridad_texto', render: (v, p) => <span className={`prioridad-${p.prioridad}`}>{v}</span> },
    { titulo: 'Motivo', dato: 'motivo', render: (v) => <span className="small">{v}</span> },
    { titulo: 'Estado', dato: 'estado', texto: (p) => (p.respuesta ? `${p.estado} (${p.respuesta})` : p.estado),
      render: (v, p) => (
        <div>
          <CBadge color={COLOR_ESTADO[v]}>{v}</CBadge>
          {p.respuesta && <div className="small text-body-secondary mt-1">“{p.respuesta}”</div>}
          {p.atendido_por && <div className="small text-body-secondary">{p.atendido_por} · {p.fecha_respuesta}</div>}
        </div>
      ) },
    { titulo: 'Acciones', acciones: (p) => (
      <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
        {esAdmin && p.estado === 'Pendiente' && <>
          <CButton size="sm" color="success" onClick={() => responder(p, true)}>Aprobar</CButton>
          <CButton size="sm" color="danger" variant="outline" onClick={() => responder(p, false)}>Rechazar</CButton>
        </>}
        {esAdmin && p.estado === 'Aprobado' && p.sku && (
          <Link className="btn btn-sm btn-outline-primary" to={`/items/${p.sku}/editar`}>Reponer stock</Link>
        )}
        {!esAdmin && p.estado === 'Pendiente' && (
          <CButton size="sm" color="danger" variant="outline" onClick={() => cancelar(p)}>Cancelar</CButton>
        )}
      </div>
    ) },
  ]

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-start mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">{esAdmin ? 'Pedidos recibidos' : 'Pedidos al administrador'}</h1>
          <p className="text-body-secondary mb-0">
            {esAdmin
              ? 'Reposiciones, productos nuevos y otros pedidos que llegan de bodegueros y trabajadores'
              : 'Pide al administrador que reponga stock, compre un producto nuevo u otra cosa que necesites'}
          </p>
        </div>
        {!esAdmin && <button className="btn btn-crear boton-movil-ancho" onClick={() => nuevo()}>+ Nuevo pedido</button>}
      </div>

      <div className="pills-filtro mb-3">
        {['', ...ESTADOS].map((e) => (
          <button key={e || 'todos'} className={`btn ${estado === e ? 'active' : ''}`} onClick={() => elegirEstado(e)}>
            {e || 'Todos'} <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis ms-1">
              {e ? pedidos.filter((p) => p.estado === e).length : pedidos.length}
            </span>
          </button>
        ))}
      </div>

      <TablaDatos key={estado} datos={visibles} columnas={columnas} titulo="Pedidos al administrador" archivo="pedidos"
        orden={[[0, 'desc']]} vacio={esAdmin ? 'No hay pedidos en este estado' : 'Aún no has hecho pedidos'} />
    </>
  )
}
