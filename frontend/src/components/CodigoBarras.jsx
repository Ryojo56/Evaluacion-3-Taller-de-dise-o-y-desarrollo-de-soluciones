import { codificarCode128 } from '../codigoBarras.js'

export default function CodigoBarras({ valor, alto = 50, modulo: moduloPedido = 2, mostrarTexto = true, className = '' }) {
  const modulo = Math.max(1, Math.round(moduloPedido))
  const bits = codificarCode128(valor)
  if (!bits) return <span className="sku text-danger">{valor} (código no imprimible)</span>

  const margen = 10
  const barras = []
  let inicio = null
  for (let i = 0; i <= bits.length; i++) {
    if (bits[i] === '1' && inicio === null) inicio = i
    if (bits[i] !== '1' && inicio !== null) {
      barras.push([inicio, i - inicio])
      inicio = null
    }
  }
  const ancho = (bits.length + margen * 2) * modulo
  const altoTexto = mostrarTexto ? 16 : 0

  return (
    <svg className={`codigo-barras ${className}`} width={ancho} height={alto + altoTexto} viewBox={`0 0 ${ancho} ${alto + altoTexto}`}
      shapeRendering="crispEdges" role="img" aria-label={`Código de barras ${valor}`} xmlns="http://www.w3.org/2000/svg">
      <rect width={ancho} height={alto + altoTexto} fill="#fff" />
      {barras.map(([x, w]) => (
        <rect key={x} x={(x + margen) * modulo} y="0" width={w * modulo} height={alto} fill="#000" />
      ))}
      {mostrarTexto && (
        <text x={ancho / 2} y={alto + 13} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="12" fill="#000">
          {valor}
        </text>
      )}
    </svg>
  )
}
