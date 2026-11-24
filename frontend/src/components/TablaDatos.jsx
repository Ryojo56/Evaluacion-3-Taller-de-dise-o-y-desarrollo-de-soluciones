import { useMemo, useRef } from 'react'
import { DataTable, botonesExportar, espanol } from './datatables.js'
import { useToast } from './Toasts.jsx'

// ============================================================================
// TablaDatos: TODAS las tablas de la app usan DataTables (búsqueda, orden,
// paginación, exportar), con el tema de colores de la bodega.
//
//   <TablaDatos datos={filas} titulo="Bodegas" archivo="bodegas" columnas={[
//     { titulo: 'SKU', dato: 'sku', clase: 'sku' },
//     { titulo: 'Nombre', dato: 'nombre', render: (valor, fila) => <b>{valor}</b> },
//     { titulo: 'Total', dato: 'total', clase: 'text-end' },
//     { titulo: 'Acciones', acciones: (fila) => <button>Editar</button> },
//   ]} />
//
// - "render" dibuja la celda con React (badges, barras, botones). Para buscar, ordenar y
//   exportar se usa el valor plano de "dato" o, si se indica, "texto(fila)".
// - La columna "acciones" no se ordena, no se busca y no se exporta (como en datatables.html).
// - Si cambian los datos (recargar), la tabla se actualiza sin perder la página ni la búsqueda.
// ============================================================================
export default function TablaDatos({
  datos, columnas, titulo, archivo, orden = [], porPagina = 10, mensaje, vacio = 'No hay registros', compacta = false,
  busqueda = '',   // texto inicial del buscador (ej. lo que se escaneó en el encabezado)
}) {
  const avisar = useToast()
  // Las funciones de las celdas se leen siempre desde aquí, así usan los datos y
  // callbacks más recientes aunque DataTables se haya creado en el primer render.
  const actuales = useRef(columnas)
  actuales.current = columnas

  const { columns, slots, options } = useMemo(() => {
    const cols = actuales.current
    const columns = cols.map((c) => ({
      title: c.titulo,
      data: c.acciones ? null : (c.dato ?? null),
      className: [c.clase, c.acciones && 'no-export text-end text-nowrap'].filter(Boolean).join(' ') || undefined,
      orderable: c.acciones ? false : c.ordenable !== false,
      searchable: !c.acciones,
      defaultContent: '',
      width: c.ancho,
    }))
    const slots = {}
    cols.forEach((c, i) => {
      if (!c.render && !c.acciones && !c.texto && !c.ordenar) return
      // 3 parámetros = DataTables pide distintas versiones del dato (display, sort, filter, export)
      slots[i] = (dato, tipo, fila) => {
        const col = actuales.current[i]
        if (tipo === 'display') {
          if (col.acciones) return col.acciones(fila)
          if (col.render) return col.render(dato, fila)
        }
        if (col.acciones) return ''
        if (col.ordenar && (tipo === 'sort' || tipo === 'type')) return col.ordenar(fila)
        if (col.texto) return col.texto(fila)
        return dato ?? ''
      }
    })
    const options = {
      language: { ...espanol, emptyTable: vacio, zeroRecords: 'Ningún registro coincide con la búsqueda' },
      pageLength: porPagina,
      lengthMenu: [5, 10, 25, 50, 100],
      order: orden,
      autoWidth: false,
      search: { search: busqueda },
      layout: {
        topStart: {
          buttons: botonesExportar({
            titulo, archivo, mensaje, horizontal: columnas.length > 6,
            alFallarPdf: () => avisar('No se pudo cargar el generador de PDF. Revisa tu conexión.', 'danger'),
          }),
        },
        topEnd: 'search',
        bottomStart: ['pageLength', 'info'],
        bottomEnd: 'paging',
      },
    }
    return { columns, slots, options }
  // La configuración se crea una sola vez: los cambios de datos se aplican sin recrear la tabla
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`tabla-datos ${compacta ? 'tabla-compacta' : ''}`}>
      <DataTable data={datos} columns={columns} slots={slots} options={options}
        className="table table-hover align-middle w-100" />
    </div>
  )
}
