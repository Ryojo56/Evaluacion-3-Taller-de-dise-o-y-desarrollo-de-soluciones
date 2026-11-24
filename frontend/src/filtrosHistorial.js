export const FILTROS_VACIOS = { trabajador: '', bodega: '', categoria: '', estado: '', desde: '', hasta: '' }

export const unicos = (lista) => [...new Set(lista.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

export function opcionesCategoria(rutas) {
  const todas = unicos(rutas)
  const principales = unicos(todas.map((r) => r.split(' › ')[0]))
  return principales.flatMap((p) => [
    [p, p],
    ...todas.filter((r) => r.startsWith(`${p} › `)).map((r) => [r, `   └ ${r.split(' › ')[1]}`]),
  ])
}

export function filtrarHistorial(lista, f, campoFecha) {
  return lista.filter((x) =>
    (!f.trabajador || x.trabajador === f.trabajador)
    && (!f.bodega || x.bodega === f.bodega)
    && (!f.categoria || x.categoria === f.categoria || (x.categoria || '').startsWith(`${f.categoria} › `))
    && (!f.estado || x.estado === f.estado)
    && (!f.desde || (x[campoFecha] || '') >= f.desde)
    && (!f.hasta || (x[campoFecha] || '') <= f.hasta))
}
