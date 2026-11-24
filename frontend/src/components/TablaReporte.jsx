// ============================================================================
// TablaReporte: tabla DataTables con búsqueda, orden, paginación y botones
// para exportar (Copiar, Excel, CSV, PDF, Columnas, Imprimir).
// Es lo mismo que el script de empleados.html, pero como componente de React.
// ============================================================================
import { useDialogo } from './Dialogo.jsx'
// Configuración compartida de DataTables (idioma, exportar, PDF bajo demanda, anti-fórmulas)
import { DataTable, DT, cargarPdfMake, espanol, sinFormula } from './datatables.js'

// Colores de la columna "Estado" (solo en pantalla; al exportar va el texto)
const COLORES = {
  'Disponible': 'success', 'Stock bajo': 'warning', 'Crítico': 'danger', 'Sin stock': 'secondary',
  'Activo': 'success', 'Inactivo': 'secondary', 'Pendiente': 'primary', 'Despachada': 'success',
  'En préstamo': 'primary', 'Vencido': 'danger', 'Sí': 'danger', 'No': 'secondary',
}
const colorDe = (texto) => {
  if (COLORES[texto]) return COLORES[texto]
  if (texto.startsWith('Devuelto')) return texto.includes('falla') ? 'warning' : 'success'
  return 'secondary'
}
const badge = (texto) => {
  const c = colorDe(String(texto))
  return `<span class="badge bg-${c}-subtle text-${c}-emphasis">${texto}</span>`
}
const CON_BADGE = ['Estado', 'Supera stock']

// Columnas que no deben partirse en dos líneas
const SIN_CORTE = ['Correo', 'Teléfono', 'Creado', 'Último acceso', 'Entrega', 'Fecha límite', 'Devolución', 'Fecha']

export default function TablaReporte({ titulo, columnas, filas, generado, archivo, filtros = [] }) {
  const dialogo = useDialogo()
  // Las columnas vienen de Django como una lista de títulos
  const columns = columnas.map((t) => ({
    title: t,
    className: t === 'SKU' ? 'sku' : SIN_CORTE.includes(t) ? 'text-nowrap' : undefined,
    render: CON_BADGE.includes(t) ? (dato, tipo) => (tipo === 'display' ? badge(dato) : dato) : undefined,
  }))

  const muchasColumnas = columnas.length > 7
  const comun = {
    title: `${titulo} · Bodega Central`,
    messageTop: `Generado el ${generado}` + (filtros.length ? ` · Filtros: ${filtros.join(' · ')}` : ' · Sin filtros'),
    filename: `reporte-${archivo}-${generado.slice(0, 10)}`,
    exportOptions: {
      columns: ':visible', // si ocultas columnas, tampoco se exportan
      // [Seguridad] Evita la "inyección de fórmulas": si un nombre o motivo empieza con = + - @,
      // Excel lo ejecutaría como fórmula al abrir el archivo. Se antepone un apóstrofo.
      format: { body: (dato) => sinFormula(dato) },
    },
  }

  const options = {
    language: espanol,
    pageLength: 10,
    order: [], // respeta el orden que manda Django
    layout: {
      topStart: {
        buttons: [
          { extend: 'copyHtml5', text: 'Copiar', ...comun },
          { extend: 'excelHtml5', text: 'Excel', ...comun },
          { extend: 'csvHtml5', text: 'CSV', ...comun },
          {
            // Botón PDF propio: primero carga pdfmake y después usa el PDF normal de DataTables
            text: 'PDF',
            className: 'buttons-pdf buttons-html5',
            async: 100, // muestra el botón "procesando" mientras carga
            action: async function (e, dt, boton, config, listo) {
              try {
                await cargarPdfMake()
              } catch {
                dialogo.avisar({ titulo: 'No se pudo generar el PDF', tipo: 'danger',
                  mensaje: 'No se pudo cargar el generador de PDF. Revisa tu conexión e inténtalo de nuevo.' })
                return listo()
              }
              const pdf = DT.ext.buttons.pdfHtml5
              const configPdf = { ...pdf, ...comun, orientation: muchasColumnas ? 'landscape' : 'portrait' }
              pdf.action.call(this, e, dt, boton, configPdf, listo)
            },
          },
          { extend: 'colvis', text: 'Columnas' },
          { extend: 'print', text: 'Imprimir', ...comun },
        ],
      },
      topEnd: 'search',
      bottomStart: ['pageLength', 'info'],
      bottomEnd: 'paging',
    },
  }

  return (
    <DataTable
      data={filas}
      columns={columns}
      options={options}
      className="table table-striped table-hover align-middle w-100"
    />
  )
}
