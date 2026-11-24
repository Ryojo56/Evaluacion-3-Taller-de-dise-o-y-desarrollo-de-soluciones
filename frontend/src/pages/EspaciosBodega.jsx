import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CBadge, CButton, CCol, CModal, CModalBody, CModalFooter, CModalHeader, CModalTitle, CRow,
} from '@coreui/react'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { AlertaError, Cargando } from '../components/Estados.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { useToast } from '../components/Toasts.jsx'
import TablaDatos from '../components/TablaDatos.jsx'
import { BarraOcupacion } from './Bodegas.jsx'

// ============================================================================
// Estantes y áreas libres de una bodega: crear, editar, eliminar y ver qué
// hay guardado en cada uno.
// ============================================================================
const campos = (tipo, e = {}) => [
  { name: 'nombre', label: 'Nombre', valor: e.nombre ?? '', maxLength: 50,
    placeholder: tipo === 'estante' ? 'Ej. Estante C' : 'Ej. Área de carga' },
  { name: 'capacidad', label: 'Capacidad', valor: e.capacidad ?? '', tipo: 'number', min: 1, sufijo: 'unid.',
    ayuda: e.id ? `Hoy guarda ${e.ocupado} unidades: la capacidad no puede ser menor.` : 'Cuántas unidades caben.' },
  tipo === 'estante'
    ? { name: 'niveles', label: 'Niveles (repisas)', valor: e.niveles ?? '', tipo: 'number', min: 1 }
    : { name: 'area_m2', label: 'Superficie', valor: e.area_m2 ?? '', tipo: 'number', min: 0, sufijo: 'm²' },
]
const datos = (tipo, v) => ({
  tipo, nombre: v.nombre, capacidad: v.capacidad === '' ? '' : Number(v.capacidad),
  niveles: v.niveles ? Number(v.niveles) : null, area_m2: v.area_m2 === '' || v.area_m2 == null ? null : Number(v.area_m2),
})

export default function EspaciosBodega() {
  const { id } = useParams()
  const { usuario } = useAuth()
  const esAdmin = usuario.rol === 'admin'
  const dialogo = useDialogo()
  const avisar = useToast()
  const { data, cargando, error, recargar } = useApi(`/espacios/?bodega=${id}`)
  const { data: dataBod } = useApi('/bodegas/')
  const [viendo, setViendo] = useState(null)
  const bodega = dataBod?.bodegas.find((b) => String(b.id) === String(id))

  const crear = (tipo) => dialogo.formulario({
    titulo: tipo === 'estante' ? 'Nuevo estante' : 'Nueva área libre', campos: campos(tipo), textoBoton: 'Crear',
    alGuardar: async (v) => { await api.post(`/bodegas/${id}/addEspacio/`, datos(tipo, v)); avisar('Espacio creado.'); recargar() },
  })
  const editar = (e) => dialogo.formulario({
    titulo: `Editar ${e.nombre}`, campos: campos(e.tipo, e), textoBoton: 'Guardar cambios',
    alGuardar: async (v) => { await api.post(`/editarEspacio/${e.id}/`, datos(e.tipo, v)); avisar('Espacio actualizado.'); recargar() },
  })
  const eliminar = async (e) => {
    const ok = await dialogo.confirmar({
      titulo: 'Eliminar espacio', peligro: true, textoBoton: 'Eliminar',
      mensaje: <>¿Eliminar <strong>{e.nombre}</strong>? Debe estar vacío (traslada su stock antes).</>,
    })
    if (!ok) return
    try {
      await api.post(`/deleteEspacio/${e.id}/`)
      avisar(`${e.nombre} eliminado.`)
      recargar()
    } catch (err) {
      avisar(errorGeneral(err), 'danger')
    }
  }

  const espacios = useMemo(() => data?.espacios || [], [data])
  const columnas = [
    {
      titulo: 'Tipo', dato: 'tipo_texto',
      render: (v, e) => <CBadge color={e.tipo === 'estante' ? 'info' : 'success'} shape="rounded-pill">{v}</CBadge>,
    },
    { titulo: 'Nombre', dato: 'nombre', render: (v) => <span className="fw-semibold">{v}</span> },
    {
      titulo: 'Detalle', dato: 'niveles', texto: (e) => (e.tipo === 'estante' ? `${e.niveles || '—'} niveles` : `${e.area_m2 ?? '—'} m²`),
      render: (_, e) => <span className="small text-body-secondary">
        {e.tipo === 'estante' ? (e.niveles ? `${e.niveles} niveles` : '—') : (e.area_m2 != null ? `${e.area_m2} m²` : '—')}
      </span>,
    },
    { titulo: 'Ítems', dato: 'items', clase: 'text-end' },
    {
      titulo: 'Ocupación', dato: 'porcentaje', texto: (e) => `${e.porcentaje}% (${e.ocupado}/${e.capacidad})`, ordenar: (e) => e.porcentaje,
      render: (_, e) => <BarraOcupacion ocupado={e.ocupado} capacidad={e.capacidad} porcentaje={e.porcentaje} />,
    },
    {
      titulo: 'Acciones',
      acciones: (e) => (
        <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
          <CButton size="sm" color="primary" onClick={() => setViendo(e.id)}>Ver contenido</CButton>
          {esAdmin && <CButton size="sm" color="secondary" variant="outline" onClick={() => editar(e)}>Editar</CButton>}
          {esAdmin && <CButton size="sm" color="danger" variant="outline" onClick={() => eliminar(e)}>Eliminar</CButton>}
        </div>
      ),
    },
  ]

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />
  const estantes = espacios.filter((e) => e.tipo === 'estante')
  const areas = espacios.filter((e) => e.tipo === 'area')
  const suma = (lista, k) => lista.reduce((t, e) => t + e[k], 0)

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-start mb-3">
        <div>
          <Link to="/bodegas" className="small">← Bodegas</Link>
          <h1 className="h3 fw-bold mb-0">{bodega?.nombre || 'Bodega'}: estantes y áreas</h1>
          <p className="text-body-secondary mb-0">{bodega?.ubicacion} {bodega ? `· ${bodega.area_m2} m²` : ''}</p>
        </div>
        {esAdmin && (
          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-crear" onClick={() => crear('estante')}>+ Nuevo estante</button>
            <button className="btn btn-crear" onClick={() => crear('area')}>+ Nueva área libre</button>
          </div>
        )}
      </div>

      <CRow className="g-2 mb-3">
        {[
          ['Estantes', estantes.length, `${suma(estantes, 'capacidad')} unid. de capacidad`],
          ['Áreas libres', areas.length, `${suma(areas, 'capacidad')} unid. de capacidad`],
          ['Guardado', suma(espacios, 'ocupado'), 'unidades'],
          ['Libre', suma(espacios, 'disponible'), 'unidades'],
        ].map(([t, v, d]) => (
          <CCol xs={6} md={3} key={t}>
            <div className="kpi"><div className="kpi-titulo">{t}</div><div className="kpi-valor">{v}</div>
              <div className="small text-body-secondary">{d}</div></div>
          </CCol>
        ))}
      </CRow>

      <TablaDatos datos={espacios} columnas={columnas} titulo={`Espacios de ${bodega?.nombre || 'la bodega'}`}
        archivo="espacios" orden={[[0, 'desc'], [1, 'asc']]} vacio="Esta bodega aún no tiene estantes ni áreas" />

      {viendo && <ContenidoEspacio id={viendo} onCerrar={() => setViendo(null)} />}
    </>
  )
}

function ContenidoEspacio({ id, onCerrar }) {
  const { data, cargando } = useApi(`/espacios/${id}/`)
  return (
    <CModal visible onClose={onCerrar} scrollable>
      <CModalHeader><CModalTitle>{data ? `${data.espacio.tipo_texto}: ${data.espacio.nombre}` : 'Cargando...'}</CModalTitle></CModalHeader>
      <CModalBody>
        {cargando && !data ? <Cargando /> : data.contenido.length === 0 ? (
          <p className="text-body-secondary mb-0">Este espacio está vacío.</p>
        ) : (
          <table className="table table-sm align-middle mb-0">
            <thead><tr><th>Ítem</th><th>Categoría</th><th className="text-end">Cantidad</th></tr></thead>
            <tbody>
              {data.contenido.map((c) => (
                <tr key={c.sku}>
                  <td><span className="sku me-2">{c.sku}</span>{c.nombre}</td>
                  <td className="small">{c.categoria}</td>
                  <td className="text-end fw-semibold">{c.cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CModalBody>
      <CModalFooter><CButton color="secondary" variant="outline" onClick={onCerrar}>Cerrar</CButton></CModalFooter>
    </CModal>
  )
}
