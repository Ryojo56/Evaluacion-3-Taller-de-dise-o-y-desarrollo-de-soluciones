// ============================================================================
// Configuración común de DataTables (equivalente a templates/menus/datatables.html):
// idioma español, botones Copiar / Excel / CSV / PDF / Imprimir / Columnas, y la
// columna "Acciones" (clase .no-export) no se exporta ni se ordena.
// La usan TablaDatos (todas las tablas) y TablaReporte (Reportes).
// ============================================================================
import DataTable from 'datatables.net-react'
import DT from 'datatables.net-bs5'
import 'datatables.net-buttons-bs5'
import 'datatables.net-buttons/js/buttons.html5.mjs'
import 'datatables.net-buttons/js/buttons.colVis.mjs'
import 'datatables.net-buttons/js/buttons.print.mjs'
import jszip from 'jszip'                       // necesario para Excel
import espanol from 'datatables.net-plugins/i18n/es-ES.mjs'

import 'datatables.net-bs5/css/dataTables.bootstrap5.css'
import 'datatables.net-buttons-bs5/css/buttons.bootstrap5.css'

// Conectar las librerías de exportación con DataTables (una sola vez)
DT.Buttons.jszip(jszip)
// DataTable.use no es un Hook de React (es el registro del plugin): falso positivo del linter
// eslint-disable-next-line react-hooks/rules-of-hooks
DataTable.use(DT)

export { DataTable, DT, espanol }

// [Optimizado] pdfmake y sus fuentes pesan mucho: se descargan la PRIMERA vez que alguien
// presiona el botón PDF, no al abrir la página.
let pdfListo = null
export function cargarPdfMake() {
  if (!pdfListo) {
    pdfListo = Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
      .then(([modPdf, modFuentes]) => {
        const pdfMake = modPdf.default || modPdf
        pdfMake.addVirtualFileSystem(modFuentes.default || modFuentes)
        DT.Buttons.pdfMake(pdfMake)
      })
      .catch((e) => { pdfListo = null; throw e })
  }
  return pdfListo
}

// [Seguridad] Evita la "inyección de fórmulas": si un texto exportado empieza con = + - @,
// Excel lo ejecutaría como fórmula al abrir el archivo. Se antepone un apóstrofo.
export function sinFormula(dato) {
  const texto = String(dato ?? '').replace(/<[^>]*>/g, '').trim()
  return /^[=+\-@\t\r]/.test(texto) && !/^[+-]?\d[\d\s.,]*$/.test(texto) ? `'${texto}` : texto
}

/**
 * Botones de exportación.
 * @param {object} o  titulo, archivo, mensaje (texto bajo el título), horizontal (PDF apaisado),
 *                    alFallarPdf (callback si no carga pdfmake)
 */
export function botonesExportar({ titulo, archivo, mensaje = '', horizontal = false, alFallarPdf }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const comun = {
    title: `${titulo} · Bodega Central`,
    messageTop: mensaje || `Generado el ${new Date().toLocaleString('es-CL')}`,
    filename: `${archivo}-${hoy}`,
    exportOptions: {
      columns: ':not(.no-export):visible',   // la columna "Acciones" no se exporta
      orthogonal: 'export',
      format: { body: (dato) => sinFormula(dato) },
    },
  }
  return [
    { extend: 'copyHtml5', text: 'Copiar', ...comun },
    { extend: 'excelHtml5', text: 'Excel', ...comun },
    { extend: 'csvHtml5', text: 'CSV', ...comun },
    {
      // PDF propio: primero carga pdfmake y después usa el PDF normal de DataTables
      text: 'PDF',
      className: 'buttons-pdf buttons-html5',
      async: 100,
      action: async function (e, dt, boton, config, listo) {
        try {
          await cargarPdfMake()
        } catch {
          alFallarPdf?.()
          return listo()
        }
        const pdf = DT.ext.buttons.pdfHtml5
        pdf.action.call(this, e, dt, boton, { ...pdf, ...comun, orientation: horizontal ? 'landscape' : 'portrait' }, listo)
      },
    },
    { extend: 'print', text: 'Imprimir', ...comun },
    { extend: 'colvis', text: 'Columnas', columns: ':not(.no-export)' },
  ]
}
