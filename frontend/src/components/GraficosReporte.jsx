import { useRef } from 'react'
import { CCard, CCardBody, CCardHeader, CCol, CRow } from '@coreui/react'
import { CChartBar, CChartDoughnut, CChartLine } from '@coreui/react-chartjs'
import AccionesGrafico from './AccionesGrafico.jsx'

// ============================================================================
// [Reportes] Gráficos de cada reporte (inventario, bodegas, préstamos, solicitudes,
// usuarios). Django los calcula con las MISMAS filas filtradas de la tabla, así
// que al cambiar un filtro cambian también los gráficos.
// ============================================================================
const COLOR = { primario: '#f26522', info: '#0d8bd1', exito: '#16a34a' }
const PALETA = ['#f26522', '#0d8bd1', '#16a34a', '#f59e0b', '#7c3aed', '#14b8a6', '#dc2626', '#64748b', '#ec4899', '#84cc16']

// Colores con significado: el mismo estado siempre se ve del mismo color
const SEMANTICO = {
  Disponible: '#16a34a', 'Stock bajo': '#f59e0b', Crítico: '#dc2626', 'Sin stock': '#94a3b8',
  Activo: '#16a34a', Inactivo: '#94a3b8',
  Despachada: '#16a34a', Pendiente: '#0d8bd1', Cancelada: '#dc2626',
  'En préstamo': '#0d8bd1', Vencido: '#dc2626', Devuelto: '#16a34a', 'Por recibir': '#f59e0b',
  Administrador: '#7c3aed', Bodeguero: '#0d8bd1', Trabajador: '#64748b', 'Recursos humanos': '#14b8a6',
}
const colores = (etiquetas) => etiquetas.map((e, i) => SEMANTICO[e] || PALETA[i % PALETA.length])

function Grafico({ g }) {
  const enteros = { beginAtZero: true, ticks: { precision: 0 } }
  if (g.tipo === 'doughnut') {
    return (
      <CChartDoughnut style={{ height: 230 }}
        data={{ labels: g.etiquetas, datasets: [{ data: g.datos, backgroundColor: colores(g.etiquetas) }] }}
        options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />
    )
  }
  const color = COLOR[g.color] || COLOR.primario
  if (g.tipo === 'line') {
    return (
      <CChartLine style={{ height: 230 }}
        data={{ labels: g.etiquetas, datasets: [{ label: g.etiqueta, data: g.datos, borderColor: color,
          backgroundColor: `${color}22`, fill: true, tension: .3, pointRadius: 3 }] }}
        options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: enteros } }} />
    )
  }
  const horizontal = g.etiquetas.length > 5
  return (
    <CChartBar style={{ height: 230 }}
      data={{ labels: g.etiquetas, datasets: [{ label: g.etiqueta, data: g.datos,
        backgroundColor: g.etiquetas.length > 1 ? colores(g.etiquetas) : color, borderRadius: 6 }] }}
      options={{ maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false } },
        scales: horizontal ? { x: enteros } : { y: enteros } }} />
  )
}

function TarjetaGrafico({ g }) {
  const contenido = useRef(null)
  return (
    <CCard className="h-100">
      <CCardHeader className="bg-transparent fw-semibold small d-flex align-items-center gap-2">
        <span>{g.titulo}</span>
        {g.datos.length > 0 && <AccionesGrafico titulo={g.titulo} contenedor={contenido} />}
      </CCardHeader>
      <CCardBody>
        <div ref={contenido}>
          {g.datos.length ? <Grafico g={g} /> : <p className="text-body-secondary small mb-0">Sin datos con estos filtros.</p>}
        </div>
      </CCardBody>
    </CCard>
  )
}

export default function GraficosReporte({ graficos }) {
  if (!graficos?.length) return null
  return (
    <CRow className="g-3 mb-3">
      {graficos.map((g) => (
        <CCol key={g.titulo} md={6} xl={graficos.length === 4 ? 3 : 4}>
          <TarjetaGrafico g={g} />
        </CCol>
      ))}
    </CRow>
  )
}
