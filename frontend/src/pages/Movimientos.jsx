import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CBadge, CButton, CCol, CFormInput, CFormLabel, CFormSelect, CRow } from '@coreui/react'
import { useApi } from '../useApi.js'
import { api, errorGeneral } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'
import { AlertaError, Cargando } from '../components/Estados.jsx'
import TablaDatos from '../components/TablaDatos.jsx'

// ============================================================================
// [Registro de movimientos] Historial de TODOS los movimientos de stock: quién,
// cuándo, cuánto, dónde (bodega y estante/área), por qué y con qué saldo quedó.
// Los filtros de arriba consultan a Django; la tabla (DataTables) busca, ordena,
// pagina y exporta los últimos 2.000 movimientos que cumplen esos filtros.
// ============================================================================
const TIPOS = {
  ingreso: ['Ingreso', 'success'], ajuste: ['Ajuste manual', 'warning'], entrega: ['Entrega', 'primary'],
  devolucion: ['Devolución', 'info'], baja: ['Baja', 'danger'], reactivacion: ['Reactivación', 'success'],
  traslado: ['Traslado', 'secondary'], salida: ['Salida manual', 'danger'],
}

export default function Movimientos() {
  const [params, setParams] = useSearchParams()
  const [sku, setSku] = useState(params.get('sku') || '')
  const { data: dataBod } = useApi('/bodegas/')
  const consulta = new URLSearchParams(params)
  consulta.set('page', '1')
  consulta.set('page_size', '2000')
  const { data, cargando, error, recargar } = useApi(`/movimientos/?${consulta}`)
  const movimientos = useMemo(() => data?.movimientos || [], [data])
  const { usuario } = useAuth()
  const esAdmin = usuario.rol === 'admin'
  const dialogo = useDialogo()
  const avisar = useToast()
  const { data: dataItems } = useApi(esAdmin ? '/items/' : null)
  const { data: dataEsp } = useApi(esAdmin ? '/espacios/' : null)

  // [CRUD admin] Movimiento manual de un material: ingreso, salida o ajuste por inventario
  const nuevo = () => {
    const espacios = {}
    for (const e of dataEsp?.espacios || []) (espacios[e.bodega] ||= []).push([e.id, `${e.nombre} (${e.disponible} libres)`])
    dialogo.formulario({
      titulo: 'Nuevo movimiento',
      campos: [
        { name: 'tipo', label: 'Tipo', tipo: 'select', columna: 'col-md-4',
          opciones: [['ingreso', 'Ingreso (llegó mercadería)'], ['salida', 'Salida (consumo, merma)'], ['ajuste', 'Ajuste (conteo físico)']] },
        { name: 'sku', label: 'Material', tipo: 'select', columna: 'col-md-8',
          opciones: (dataItems?.items || []).filter((i) => i.tipo === 'material').map((i) => [i.sku, `${i.nombre} (${i.sku})`]) },
        { name: 'espacio', label: 'Bodega y lugar', tipo: 'select', opciones: espacios, columna: 'col-md-8' },
        { name: 'cantidad', label: 'Cantidad', tipo: 'number', min: 0, columna: 'col-md-4',
          ayuda: 'En un ajuste, la cantidad que quedó contada.' },
        { name: 'motivo', label: 'Motivo', tipo: 'textarea', maxLength: 200, placeholder: 'Ej. Factura 1234, merma, inventario de fin de mes' },
      ],
      textoBoton: 'Registrar',
      alGuardar: async (v) => {
        await api.post('/addMovimiento/', { ...v, espacio: Number(v.espacio), cantidad: Number(v.cantidad) })
        avisar('Movimiento registrado.')
        recargar()
      },
    })
  }

  // [CRUD admin] Revertir: crea el movimiento contrario (el registro original no se borra)
  const revertir = async (m) => {
    const ok = await dialogo.confirmar({
      titulo: 'Revertir movimiento', peligro: true, textoBoton: 'Revertir',
      mensaje: <>Se registrará un movimiento de <strong>{-m.cantidad > 0 ? `+${-m.cantidad}` : -m.cantidad}</strong> de {m.item} en
        {' '}{m.bodega} · {m.espacio} para deshacer este. El movimiento original queda en el registro.</>,
    })
    if (!ok) return
    try {
      await api.post(`/revertirMovimiento/${m.id}/`)
      avisar('Movimiento revertido.')
      recargar()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  const cambiar = (clave, valor) => {
    const nuevos = new URLSearchParams(params)
    if (valor) nuevos.set(clave, valor)
    else nuevos.delete(clave)
    setParams(nuevos)
  }

  const columnas = [
    { titulo: 'Fecha', dato: 'fecha', clase: 'text-nowrap', render: (v) => <span className="sku">{v}</span> },
    { titulo: 'Tipo', dato: 'tipo_texto', render: (_, m) => {
      const [texto, color] = TIPOS[m.tipo] || [m.tipo_texto, 'secondary']
      return <CBadge color={color}>{texto}</CBadge>
    } },
    { titulo: 'Ítem', dato: 'item', texto: (m) => `${m.sku} ${m.item}`,
      render: (v, m) => <><span className="sku small me-1">{m.sku}</span>{v}</> },
    { titulo: 'Bodega', dato: 'bodega' },
    { titulo: 'Lugar', dato: 'espacio' },
    { titulo: 'Cantidad', dato: 'cantidad', clase: 'text-end', render: (v) => (
      <span className={`fw-semibold ${v < 0 ? 'text-danger' : 'text-success'}`}>{v > 0 ? `+${v}` : v}</span>
    ) },
    { titulo: 'Saldo', dato: 'saldo', clase: 'text-end' },
    { titulo: 'Responsable', dato: 'usuario' },
    { titulo: 'Motivo', dato: 'motivo', render: (v) => <span className="small text-body-secondary">{v || '—'}</span> },
    ...(esAdmin ? [{ titulo: 'Acciones', acciones: (m) => (
      m.revertible
        ? <CButton size="sm" color="danger" variant="outline" onClick={() => revertir(m)}>Revertir</CButton>
        : <span className="small text-body-secondary">{m.revertido ? 'Revertido' : m.es_reversion ? 'Reversión' : ''}</span>
    ) }] : []),
  ]

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Registro de movimientos</h1>
          <p className="text-body-secondary mb-0">Entradas, salidas, traslados y ajustes de stock</p>
        </div>
        {esAdmin && <button className="btn btn-crear boton-movil-ancho" onClick={nuevo}>+ Nuevo movimiento</button>}
      </div>

      <div className="filtros-card mb-3">
        <CRow className="g-2">
          <CCol xs={12} md={3}>
            <CFormLabel htmlFor="f-sku">SKU</CFormLabel>
            <form onSubmit={(e) => { e.preventDefault(); cambiar('sku', sku.trim().toUpperCase()) }}>
              <CFormInput id="f-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="HRM-0001 + Enter"
                className={`sku ${params.get('sku') ? 'filtro-activo' : ''}`} maxLength={10} />
            </form>
          </CCol>
          <CCol xs={6} md={3}>
            <CFormLabel htmlFor="f-bod">Bodega</CFormLabel>
            <CFormSelect id="f-bod" className={params.get('bodega') ? 'filtro-activo' : ''} value={params.get('bodega') || ''}
              onChange={(e) => cambiar('bodega', e.target.value)}>
              <option value="">Todas</option>
              {dataBod?.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </CFormSelect>
          </CCol>
          <CCol xs={6} md={2}>
            <CFormLabel htmlFor="f-tipo">Tipo</CFormLabel>
            <CFormSelect id="f-tipo" className={params.get('tipo') ? 'filtro-activo' : ''} value={params.get('tipo') || ''}
              onChange={(e) => cambiar('tipo', e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(TIPOS).map(([v, [t]]) => <option key={v} value={v}>{t}</option>)}
            </CFormSelect>
          </CCol>
          <CCol xs={6} md={2}>
            <CFormLabel htmlFor="f-desde">Desde</CFormLabel>
            <CFormInput id="f-desde" type="date" value={params.get('desde') || ''} onChange={(e) => cambiar('desde', e.target.value)} />
          </CCol>
          <CCol xs={6} md={2}>
            <CFormLabel htmlFor="f-hasta">Hasta</CFormLabel>
            <CFormInput id="f-hasta" type="date" value={params.get('hasta') || ''} onChange={(e) => cambiar('hasta', e.target.value)} />
          </CCol>
        </CRow>
      </div>

      <AlertaError mensaje={error && errorGeneral(error)} />
      {cargando && !data ? <Cargando /> : (
        <>
          {data?.total > movimientos.length && (
            <div className="alert alert-info py-2 small">
              Se muestran los {movimientos.length} movimientos más recientes de {data.total}. Usa los filtros para acotar.
            </div>
          )}
          <TablaDatos datos={movimientos} columnas={columnas} titulo="Registro de movimientos" archivo="registro-movimientos"
            vacio="Sin movimientos con estos filtros" compacta />
        </>
      )}
    </>
  )
}
