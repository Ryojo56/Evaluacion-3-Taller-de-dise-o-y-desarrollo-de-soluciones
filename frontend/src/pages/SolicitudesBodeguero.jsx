import { useMemo, useState } from 'react'
import { CButton } from '@coreui/react'
import TablaDatos from '../components/TablaDatos.jsx'
import { Link } from 'react-router-dom'
import AvisoHistorial from '../components/AvisoHistorial.jsx'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { fechaCL } from '../utils.js'
import { EstadoBadge, Cargando, AlertaError } from '../components/Estados.jsx'
import EntregaHerramienta from '../components/EntregaHerramienta.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'

export default function SolicitudesBodeguero() {
  const { data, cargando, error, recargar } = useApi('/solicitudes/') // GET /api/solicitudes/
  const [vista, setVista] = useState('pendientes')
  const [errorAccion, setErrorAccion] = useState(null)
  const [entregando, setEntregando] = useState(null)
  const { usuario } = useAuth()
  const esAdmin = usuario.rol === 'admin'
  const dialogo = useDialogo()
  const avisar = useToast()
  // Listas para crear una solicitud (solo el admin las necesita)
  const { data: dataItems } = useApi(esAdmin ? '/items/' : null)
  const { data: dataUsu } = useApi(esAdmin ? '/usuarios/' : null)

  // [CRUD admin] Registrar una solicitud a nombre de un trabajador
  const nueva = () => dialogo.formulario({
    titulo: 'Nueva solicitud',
    campos: [
      { name: 'trabajador', label: 'Trabajador', tipo: 'select',
        opciones: (dataUsu?.usuarios || []).filter((u) => u.activo).map((u) => [u.id, u.nombre]) },
      { name: 'sku', label: 'Ítem', tipo: 'select',
        opciones: (dataItems?.items || []).map((i) => [i.sku, `${i.nombre} (${i.sku}) — ${i.stock_total} disponibles`]) },
      { name: 'cantidad', label: 'Cantidad', tipo: 'number', min: 1, valor: 1, columna: 'col-4' },
      { name: 'motivo', label: 'Motivo', tipo: 'textarea', columna: 'col-8', maxLength: 2000 },
    ],
    textoBoton: 'Crear solicitud',
    alGuardar: async (v) => {
      await api.post('/addSolicitud/', { ...v, trabajador: Number(v.trabajador), cantidad: Number(v.cantidad) })
      avisar('Solicitud creada.')
      recargar()
    },
  })

  // [CRUD admin] Corregir cantidad o motivo de una solicitud pendiente
  const editar = (s) =>
    dialogo.formulario({
      titulo: `Editar solicitud de ${s.trabajador}`,
      campos: [
        { name: 'cantidad', label: `Cantidad de ${s.producto}`, valor: s.cantidad, tipo: 'number', min: 1 },
        { name: 'motivo', label: 'Motivo', valor: s.motivo, tipo: 'textarea', maxLength: 2000 },
      ],
      textoBoton: 'Guardar cambios',
      alGuardar: async (v) => {
        await api.post(`/editarSolicitud/${s.id}/`, { cantidad: Number(v.cantidad), motivo: v.motivo })
        avisar('Solicitud actualizada.')
        recargar()
      },
    })

  // [CRUD admin] Cancelar (no se borra: queda en el historial como "Cancelada")
  const cancelar = async (s) => {
    const ok = await dialogo.confirmar({
      titulo: 'Cancelar solicitud',
      mensaje: <>¿Cancelar la solicitud de <strong>{s.trabajador}</strong> ({s.cantidad} × {s.producto})?</>,
      textoBoton: 'Cancelar solicitud', peligro: true,
    })
    if (!ok) return
    try {
      await api.post(`/cancelarSolicitud/${s.id}/`)
      avisar('Solicitud cancelada.')
      recargar()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  const entregar = async (s) => {
    if (s.tipo === 'herramienta') {
      setEntregando(s)
      return
    }
    const id = s.id
    try {
      await api.post(`/entregarSolicitud/${id}/`) // POST /api/entregarSolicitud/<id>/
      setErrorAccion(null)
      avisar(`Entregado: ${s.cantidad} × ${s.producto} a ${s.trabajador}.`)
      recargar()
    } catch (err) {
      setErrorAccion(err)
    }
  }

  const todas = useMemo(() => data?.solicitudes || [], [data])
  const pendientes = useMemo(() => todas.filter((s) => s.estado === 'Pendiente'), [todas])
  const sobreStock = useMemo(() => pendientes.filter((s) => s.faltan > 0), [pendientes])
  const visibles = { pendientes, sobre_stock: sobreStock, todas }[vista]

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const VISTAS = [
    { id: 'pendientes', texto: 'Pendientes', n: pendientes.length },
    { id: 'sobre_stock', texto: 'Esperan reposición', n: sobreStock.length },
    { id: 'todas', texto: 'Todas', n: todas.length },
  ]

  const columnas = [
    { titulo: 'Trabajador', dato: 'trabajador', render: (v, s) => <span className={s.estado === 'Pendiente' ? 'fw-semibold' : ''}>{v}</span> },
    { titulo: 'Producto', dato: 'producto', texto: (s) => `${s.producto} ${s.sku}`,
      render: (v, s) => <>{v} <span className="sku small text-body-secondary">· {s.sku}</span></> },
    { titulo: 'Cantidad', dato: 'cantidad', clase: 'text-end', render: (v, s) => (
      <div>
        <span className="fw-semibold">{v}</span> <span className="small text-body-secondary">{s.unidad}</span>
        {s.excede_stock && <span className="badge bg-danger-subtle text-danger-emphasis ms-2"
          title={`Al pedir había ${s.stock_al_solicitar} disponibles`}>Supera el stock</span>}
        {s.estado === 'Pendiente' && s.faltan > 0 && <div className="small text-danger">Faltan {s.faltan}</div>}
      </div>
    ) },
    { titulo: 'Motivo', dato: 'motivo', render: (v) => <span className="small">{v || '—'}</span> },
    { titulo: 'Fecha', dato: 'fecha', clase: 'text-nowrap', render: (v) => <span className="sku">{fechaCL(v)}</span> },
    { titulo: 'Estado', dato: 'estado', render: (v) => <EstadoBadge estado={v} /> },
    { titulo: 'Acciones', acciones: (s) => s.estado === 'Pendiente' ? (
      <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
        <CButton size="sm" className="btn-accent" onClick={() => entregar(s)} disabled={s.faltan > 0}
          title={s.faltan > 0 ? `Faltan ${s.faltan} unidades en bodega` : 'Entregar al trabajador'}>Entregar</CButton>
        {esAdmin && <CButton size="sm" color="primary" variant="outline" onClick={() => editar(s)}>Editar</CButton>}
        {esAdmin && <CButton size="sm" color="danger" variant="outline" onClick={() => cancelar(s)}>Cancelar</CButton>}
      </div>
    ) : s.estado === 'Cancelada'
      ? <span className="small text-danger">Cancelada</span>
      : <span className="small">Entregada{s.entregado_por ? ` por ${s.entregado_por}` : ''}</span> },
  ]

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Solicitudes de materiales</h1>
          <p className="text-body-secondary mb-0">Pedidos de los trabajadores</p>
        </div>
        {esAdmin && <button className="btn btn-crear boton-movil-ancho" onClick={nueva}>+ Nueva solicitud</button>}
      </div>
      <AvisoHistorial data={data} que="solicitudes" />

      <div className="pills-filtro mb-3">
        {VISTAS.map((v) => (
          <button key={v.id} className={`btn ${vista === v.id ? 'active' : ''}`} onClick={() => setVista(v.id)}>
            {v.texto} <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis ms-1">{v.n}</span>
          </button>
        ))}
      </div>

      {sobreStock.length > 0 && vista !== 'sobre_stock' && (
        <div className="alert alert-warning py-2 small">
          {sobreStock.length} solicitud(es) piden más de lo que hay en bodega. Repón stock desde{' '}
          <Link to="/catalogo">Catálogo y stock</Link> para poder entregarlas.
        </div>
      )}
      <AlertaError mensaje={errorAccion && errorGeneral(errorAccion)} />

      <TablaDatos datos={visibles} columnas={columnas} titulo="Solicitudes" archivo="solicitudes"
        orden={[[4, 'desc']]} vacio="Sin solicitudes" />

      {entregando && (
        <EntregaHerramienta solicitud={entregando} onCerrar={() => setEntregando(null)}
          onEntregada={() => { setEntregando(null); setErrorAccion(null); recargar() }} />
      )}
    </>
  )
}
