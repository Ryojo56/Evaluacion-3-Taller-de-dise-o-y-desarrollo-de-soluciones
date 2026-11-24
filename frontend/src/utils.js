// Funciones pequeñas que usan varias páginas

// 2026-09-06 -> 06-09-2026
export const fechaCL = (iso) => (iso ? iso.split('-').reverse().join('-') : '')

// { 'Bodega Central': 2, 'Bodega Norte': 1 } -> "Bodega Central: 2 · Bodega Norte: 1"
export const stockTexto = (stock) => {
  const partes = Object.entries(stock || {}).map(([b, n]) => `${b}: ${n}`)
  return partes.length ? partes.join(' · ') : 'Sin stock'
}
