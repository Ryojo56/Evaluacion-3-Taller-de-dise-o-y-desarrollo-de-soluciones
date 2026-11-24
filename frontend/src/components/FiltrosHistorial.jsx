import { CButton, CCol, CFormInput, CFormSelect, CRow } from '@coreui/react'
import { FILTROS_VACIOS, opcionesCategoria, unicos } from '../filtrosHistorial.js'

export default function FiltrosHistorial({ datos, filtros, setFiltros, campos, estados = [], etiquetaFecha = 'Fecha' }) {
  const cambiar = (clave) => (e) => setFiltros({ ...filtros, [clave]: e.target.value })
  const activos = Object.values(filtros).filter(Boolean).length

  const select = (clave, etiqueta, vacio, opciones) => (
    <CCol xs={6} md={4} xl={2} key={clave}>
      <label htmlFor={`f-${clave}`} className="form-label small text-body-secondary mb-1">{etiqueta}</label>
      <CFormSelect id={`f-${clave}`} size="sm" className={filtros[clave] ? 'filtro-activo' : ''} value={filtros[clave]}
        onChange={cambiar(clave)}>
        <option value="">{vacio}</option>
        {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </CFormSelect>
    </CCol>
  )

  return (
    <div className="filtros-card mb-3">
      <CRow className="g-2 align-items-end">
        {campos.includes('trabajador') && select('trabajador', 'Trabajador', 'Todos',
          unicos(datos.map((d) => d.trabajador)).map((v) => [v, v]))}
        {campos.includes('bodega') && select('bodega', 'Bodega', 'Todas',
          unicos(datos.map((d) => d.bodega)).map((v) => [v, v]))}
        {campos.includes('categoria') && select('categoria', 'Categoría', 'Todas', opcionesCategoria(datos.map((d) => d.categoria)))}
        {campos.includes('estado') && select('estado', 'Estado', 'Todos', estados.map((e) => [e, e]))}
        <CCol xs={6} md={4} xl={2}>
          <label htmlFor="f-desde" className="form-label small text-body-secondary mb-1">{etiquetaFecha} desde</label>
          <CFormInput id="f-desde" size="sm" type="date" className={filtros.desde ? 'filtro-activo' : ''}
            value={filtros.desde} max={filtros.hasta || undefined} onChange={cambiar('desde')} />
        </CCol>
        <CCol xs={6} md={4} xl={2}>
          <label htmlFor="f-hasta" className="form-label small text-body-secondary mb-1">{etiquetaFecha} hasta</label>
          <CFormInput id="f-hasta" size="sm" type="date" className={filtros.hasta ? 'filtro-activo' : ''}
            value={filtros.hasta} min={filtros.desde || undefined} onChange={cambiar('hasta')} />
        </CCol>
        {activos > 0 && (
          <CCol xs="auto">
            <CButton size="sm" color="secondary" variant="ghost" onClick={() => setFiltros(FILTROS_VACIOS)}>
              Limpiar filtros ({activos})
            </CButton>
          </CCol>
        )}
      </CRow>
    </div>
  )
}
