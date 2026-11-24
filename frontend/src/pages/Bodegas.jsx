import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CBadge, CButton, CCol, CRow } from '@coreui/react'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Cargando, AlertaError } from '../components/Estados.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'
import TablaDatos from '../components/TablaDatos.jsx'

// ============================================================================
// Bodegas. [Bodegas reales] Cada bodega tiene superficie en m² y ESPACIOS:
// estantes y áreas libres, cada uno con su capacidad. La capacidad de la bodega
// ya no es un número inventado: es la suma de sus espacios.
// ============================================================================
const numero = (n) => Number(n || 0).toLocaleString('es-CL')
export const colorOcupacion = (p) => (p >= 90 ? 'bg-danger' : p >= 70 ? 'bg-warning' : 'bg-success')

export function BarraOcupacion({ ocupado, capacidad, porcentaje }) {
  return (
    <div style={{ minWidth: 160 }}>
      <div className="d-flex justify-content-between small mb-1 gap-2">
        <span className="fw-semibold">{numero(Math.max(capacidad - ocupado, 0))} libres</span>
        <span className="text-body-secondary">{numero(ocupado)} / {numero(capacidad)} · {porcentaje}%</span>
      </div>
      <div className="barra-ocupacion grande" role="progressbar" aria-valuenow={porcentaje} aria-valuemin="0" aria-valuemax="100">
        <div className={colorOcupacion(porcentaje)} style={{ width: `${Math.min(porcentaje, 100)}%` }} />
      </div>
    </div>
  )
}

const camposNueva = [
  { name: 'nombre', label: 'Nombre de la bodega', placeholder: 'Ej. Bodega Sur', maxLength: 50 },
  { name: 'ubicacion', label: 'Ubicación', placeholder: 'Ej. Galpón 2, Av. Los Robles 123', maxLength: 150, tipo: 'textarea' },
  { name: 'area_m2', label: 'Superficie', tipo: 'number', min: 1, sufijo: 'm²', placeholder: 'Ej. 250' },
  { name: 'estantes', label: 'Estantes', tipo: 'number', min: 0, valor: 2, columna: 'col-6',
    ayuda: 'Se crean como "Estante 1", "Estante 2"...' },
  { name: 'capacidad_estante', label: 'Capacidad de cada estante', tipo: 'number', min: 1, valor: 100,
    sufijo: 'unid.', columna: 'col-6' },
  { name: 'capacidad_area', label: 'Área libre (piso)', tipo: 'number', min: 0, valor: 200, sufijo: 'unid.',
    ayuda: 'Lo que cabe en el piso (pallets, sacos, cajas grandes). 0 = sin área libre. Después puedes agregar más espacios.' },
]
const camposEditar = (b) => [
  { name: 'nombre', label: 'Nombre de la bodega', valor: b.nombre, maxLength: 50 },
  { name: 'ubicacion', label: 'Ubicación', valor: b.ubicacion, maxLength: 150, tipo: 'textarea' },
  { name: 'area_m2', label: 'Superficie', valor: b.area_m2, tipo: 'number', min: 1, sufijo: 'm²',
    ayuda: 'Los estantes y áreas se administran en "Espacios".' },
]
const aNumeros = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) =>
  [k, ['area_m2', 'estantes', 'capacidad_estante', 'capacidad_area'].includes(k) && x !== '' ? Number(x) : x]))

export default function Bodegas() {
  const { usuario } = useAuth()
  const dialogo = useDialogo()
  const avisar = useToast()
  const navigate = useNavigate()
  const esAdmin = usuario.rol === 'admin'
  const { data, cargando, error, recargar } = useApi('/bodegas/')

  const nueva = () => dialogo.formulario({
    titulo: 'Nueva bodega', campos: camposNueva, textoBoton: 'Crear bodega',
    alGuardar: async (v) => { await api.post('/addBodega/', aNumeros(v)); avisar('Bodega creada.'); recargar() },
  })
  const editar = (b) => dialogo.formulario({
    titulo: `Editar ${b.nombre}`, campos: camposEditar(b), textoBoton: 'Guardar cambios',
    alGuardar: async (v) => { await api.post(`/editarBodega/${b.id}/`, aNumeros(v)); avisar('Bodega actualizada.'); recargar() },
  })
  const eliminar = async (b) => {
    const ok = await dialogo.confirmar({
      titulo: 'Eliminar bodega', peligro: true, textoBoton: 'Eliminar',
      mensaje: <>¿Eliminar <strong>{b.nombre}</strong>? Debe estar vacía. Queda en la Papelera y se puede restaurar.</>,
    })
    if (!ok) return
    try {
      await api.post(`/deleteBodega/${b.id}/`)
      avisar(`${b.nombre} se movió a la papelera.`)
      recargar()
    } catch (err) {
      dialogo.avisar({ titulo: 'No se pudo eliminar', mensaje: errorGeneral(err), tipo: 'danger' })
    }
  }

  const bodegas = useMemo(() => data?.bodegas || [], [data])
  const columnas = [
    { titulo: 'Bodega', dato: 'nombre', render: (v) => <span className="fw-semibold">{v}</span> },
    { titulo: 'Ubicación', dato: 'ubicacion', render: (v) => v || <span className="text-warning-emphasis">Sin ubicación</span> },
    { titulo: 'Superficie', dato: 'area_m2', clase: 'text-end text-nowrap', render: (v) => `${numero(v)} m²` },
    {
      titulo: 'Espacios', dato: 'estantes', texto: (b) => `${b.estantes} estantes, ${b.areas} áreas`, ordenar: (b) => b.estantes + b.areas,
      render: (_, b) => (
        <div className="d-flex flex-wrap gap-1">
          <CBadge color="info" shape="rounded-pill">{b.estantes} estante{b.estantes === 1 ? '' : 's'}</CBadge>
          <CBadge color="success" shape="rounded-pill">{b.areas} área{b.areas === 1 ? '' : 's'} libre{b.areas === 1 ? '' : 's'}</CBadge>
        </div>
      ),
    },
    { titulo: 'Ítems', dato: 'items', clase: 'text-end' },
    {
      titulo: 'Ocupación', dato: 'porcentaje', texto: (b) => `${b.porcentaje}% (${b.ocupado}/${b.capacidad})`, ordenar: (b) => b.porcentaje,
      render: (_, b) => <BarraOcupacion ocupado={b.ocupado} capacidad={b.capacidad} porcentaje={b.porcentaje} />,
    },
    {
      titulo: 'Acciones',
      acciones: (b) => (
        <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
          <CButton size="sm" color="primary" onClick={() => navigate(`/bodegas/${b.id}/espacios`)}>Estantes y áreas</CButton>
          {esAdmin && <CButton size="sm" color="secondary" variant="outline" onClick={() => editar(b)}>Editar</CButton>}
          {esAdmin && <CButton size="sm" color="danger" variant="outline" onClick={() => eliminar(b)}>Eliminar</CButton>}
        </div>
      ),
    },
  ]

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const suma = (k) => bodegas.reduce((t, b) => t + (b[k] || 0), 0)
  const capacidad = suma('capacidad')
  const ocupado = suma('ocupado')

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-start mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Bodegas</h1>
          <p className="text-body-secondary mb-0">Bodegas registradas y su espacio disponible</p>
        </div>
        {esAdmin && <button className="btn btn-crear boton-movil-ancho" onClick={nueva}>+ Nueva bodega</button>}
      </div>

      <CRow className="g-2 mb-3">
        {[
          ['Bodegas', bodegas.length, ''],
          ['Superficie total', `${numero(suma('area_m2'))} m²`, ''],
          ['Estantes / áreas', `${suma('estantes')} / ${suma('areas')}`, ''],
          ['Capacidad total', `${numero(capacidad)} unid.`, ''],
          ['Espacio libre', `${numero(Math.max(capacidad - ocupado, 0))} unid.`, 'text-success-emphasis'],
        ].map(([t, v, c]) => (
          <CCol xs={6} md key={t}>
            <div className="kpi"><div className="kpi-titulo">{t}</div><div className={`kpi-valor ${c}`}>{v}</div></div>
          </CCol>
        ))}
      </CRow>

      <TablaDatos datos={bodegas} columnas={columnas} titulo="Bodegas" archivo="bodegas" orden={[[0, 'asc']]}
        vacio="Aún no hay bodegas" />
    </>
  )
}
