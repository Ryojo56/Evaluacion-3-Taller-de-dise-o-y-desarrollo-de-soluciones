import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { CCard, CCardBody, CCardHeader, CCol, CProgress, CRow } from '@coreui/react'
import { CChartBar, CChartDoughnut, CChartLine } from '@coreui/react-chartjs'
import { useApi } from '../useApi.js'
import { AlertaError, Cargando } from './Estados.jsx'
import { errorGeneral } from '../api.js'
import AccionesGrafico from './AccionesGrafico.jsx'

// ============================================================================
// [CoreUI] Dashboard con gráficos (Chart.js vía @coreui/react-chartjs).
// Datos: GET /api/dashboard/ (solo admin y bodeguero). Se carga aparte (lazy)
// para que Chart.js no pese en las demás pantallas.
// ============================================================================
const C = {
  primario: '#f26522', info: '#0d8bd1', exito: '#2eb85c', alerta: '#f9b115', peligro: '#e55353', gris: '#9da5b1',
}
const COLOR_ESTADO = { Disponible: C.exito, 'Stock bajo': C.alerta, Crítico: C.peligro, 'Sin stock': C.gris }
const PALETA = [C.primario, C.info, C.exito, C.alerta, '#6f42c1', '#20c997', C.peligro, C.gris]

const sinLeyenda = { plugins: { legend: { display: false } }, maintainAspectRatio: false }

function Grafico({ titulo, children, pie, barras }) {
  const contenido = useRef(null)
  return (
    <CCard className="h-100">
      <CCardHeader className="fw-semibold bg-transparent d-flex align-items-center gap-2">
        <span>{titulo}</span>
        <AccionesGrafico titulo={titulo} contenedor={contenido} barras={barras} />
      </CCardHeader>
      <CCardBody style={{ minHeight: 260 }}><div ref={contenido}>{children}</div></CCardBody>
      {pie && <div className="px-3 pb-3 small text-body-secondary">{pie}</div>}
    </CCard>
  )
}

export default function DashboardGraficos() {
  const { data, cargando, error } = useApi('/dashboard/')
  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const estados = Object.entries(data.estados_stock)
  return (
    <>
      <CRow className="g-3 mb-3">
        <CCol lg={8}>
          <Grafico titulo="Actividad de los últimos 14 días">
            <CChartLine
              style={{ height: 240 }}
              data={{
                labels: data.dias,
                datasets: [
                  { label: 'Solicitudes', data: data.solicitudes_por_dia, borderColor: C.primario,
                    backgroundColor: 'rgba(242,101,34,.12)', fill: true, tension: .35 },
                  { label: 'Préstamos entregados', data: data.prestamos_por_dia, borderColor: C.info, tension: .35 },
                  { label: 'Devoluciones', data: data.devoluciones_por_dia, borderColor: C.exito, tension: .35 },
                ],
              }}
              options={{ maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }}
            />
          </Grafico>
        </CCol>
        <CCol lg={4}>
          <Grafico titulo="Estado del catálogo"
            pie={<Link to="/catalogo?estado=alerta">Ver ítems que requieren reposición →</Link>}>
            <CChartDoughnut
              style={{ height: 220 }}
              data={{
                labels: estados.map(([e]) => e),
                datasets: [{ data: estados.map(([, n]) => n), backgroundColor: estados.map(([e]) => COLOR_ESTADO[e]) }],
              }}
              options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }}
            />
          </Grafico>
        </CCol>
      </CRow>

      <CRow className="g-3 mb-4">
        <CCol lg={4}>
          <Grafico titulo="Ocupación por bodega" barras={data.bodegas.map((b) => {
            const pct = b.capacidad ? Math.round((b.ocupado * 100) / b.capacidad) : 0
            return {
              etiqueta: b.nombre, proporcion: pct / 100,
              texto: `${b.ocupado.toLocaleString('es-CL')} / ${b.capacidad.toLocaleString('es-CL')} u. (${pct}%)`,
              color: pct >= 90 ? C.peligro : pct >= 75 ? C.alerta : C.exito,
            }
          })}>
            {data.bodegas.map((b) => {
              const pct = b.capacidad ? Math.round((b.ocupado * 100) / b.capacidad) : 0
              return (
                <div key={b.nombre} className="mb-3">
                  <div className="d-flex justify-content-between small">
                    <span className="fw-semibold">{b.nombre}</span>
                    <span className="text-body-secondary">{b.ocupado.toLocaleString('es-CL')} / {b.capacidad.toLocaleString('es-CL')} u.</span>
                  </div>
                  <CProgress thin value={pct} color={pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : 'success'}
                    aria-label={`${b.nombre}: ${pct}% ocupado`} />
                </div>
              )
            })}
          </Grafico>
        </CCol>
        <CCol lg={4}>
          <Grafico titulo="Unidades en stock por categoría">
            <CChartBar
              style={{ height: 240 }}
              data={{
                labels: data.categorias.map((c) => c.nombre),
                datasets: [{ data: data.categorias.map((c) => c.unidades), backgroundColor: PALETA }],
              }}
              options={{ ...sinLeyenda, indexAxis: 'y' }}
            />
          </Grafico>
        </CCol>
        <CCol lg={4}>
          <Grafico titulo="Herramientas más prestadas (90 días)"
            pie={`${data.prestamos.en_plazo} en plazo · ${data.prestamos.vencidos} vencidos · ${data.prestamos.devueltos_30d} devueltos en 30 días`}>
            {data.top_prestados.length ? (
              <CChartBar
                style={{ height: 220 }}
                data={{
                  labels: data.top_prestados.map((t) => t.nombre),
                  datasets: [{ data: data.top_prestados.map((t) => t.prestamos), backgroundColor: C.info }],
                }}
                options={{ ...sinLeyenda, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }}
              />
            ) : <p className="text-body-secondary small">Sin préstamos en los últimos 90 días.</p>}
          </Grafico>
        </CCol>
      </CRow>
    </>
  )
}
