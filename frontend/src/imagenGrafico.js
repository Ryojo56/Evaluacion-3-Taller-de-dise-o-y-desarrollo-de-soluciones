import { Chart } from 'chart.js'

const ESCALA = 2
const MARGEN = 20
const ALTO_TITULO = 34
const TINTA = '#1f2937'
const SUAVE = '#4b5563'
const REJILLA = '#e5e7eb'
const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'

const clonar = (valor) => JSON.parse(JSON.stringify(valor ?? {}))

function dibujarConChartJs(original) {
  const opciones = clonar(original.config.options)
  const conEjes = ['bar', 'line'].includes(original.config.type)
  const horizontal = opciones.indexAxis === 'y'
  const etiquetas = original.config.data?.labels?.length || 0
  const ancho = Math.round(Math.max(original.width, conEjes ? 680 : 0))
  const alto = Math.round(Math.max(original.height, horizontal ? etiquetas * 24 + 60 : 0))
  const leyenda = opciones.plugins?.legend || {}
  opciones.responsive = false
  opciones.maintainAspectRatio = false
  opciones.animation = false
  opciones.devicePixelRatio = ESCALA
  opciones.color = TINTA
  opciones.font = { family: FUENTE }
  opciones.plugins = {
    ...opciones.plugins,
    tooltip: { enabled: false },
    legend: { ...leyenda, labels: { ...leyenda.labels, color: TINTA, font: { family: FUENTE, size: 12 } } },
  }
  for (const id of Object.keys(original.scales)) {
    const escala = opciones.scales?.[id] || {}
    opciones.scales = {
      ...opciones.scales,
      [id]: {
        ...escala,
        ticks: { ...escala.ticks, color: SUAVE, font: { family: FUENTE, size: 12 } },
        grid: { ...escala.grid, color: REJILLA },
        border: { ...escala.border, color: REJILLA },
      },
    }
  }

  const contenedor = document.createElement('div')
  contenedor.style.cssText = `position:fixed;left:-10000px;top:0;width:${ancho}px;height:${alto}px`
  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto
  contenedor.appendChild(lienzo)
  document.body.appendChild(contenedor)
  const copia = new Chart(lienzo, { type: original.config.type, data: clonar(original.config.data), options: opciones })
  copia.draw()
  return {
    lienzo, ancho, alto,
    limpiar: () => { copia.destroy(); contenedor.remove() },
  }
}

function dibujarBarras(filas) {
  const ancho = 460
  const altoFila = 46
  const alto = filas.length * altoFila
  const lienzo = document.createElement('canvas')
  lienzo.width = ancho * ESCALA
  lienzo.height = alto * ESCALA
  const ctx = lienzo.getContext('2d')
  ctx.scale(ESCALA, ESCALA)
  filas.forEach((f, i) => {
    const y = i * altoFila
    ctx.fillStyle = TINTA
    ctx.font = `600 13px ${FUENTE}`
    ctx.textAlign = 'left'
    ctx.fillText(f.etiqueta, 0, y + 16)
    ctx.fillStyle = SUAVE
    ctx.font = `12px ${FUENTE}`
    ctx.textAlign = 'right'
    ctx.fillText(f.texto, ancho, y + 16)
    ctx.fillStyle = REJILLA
    ctx.fillRect(0, y + 24, ancho, 8)
    ctx.fillStyle = f.color
    ctx.fillRect(0, y + 24, Math.max(0, Math.min(1, f.proporcion)) * ancho, 8)
  })
  return { lienzo, ancho, alto, limpiar: () => {} }
}

function componer(titulo, dibujo) {
  const altoTitulo = titulo ? ALTO_TITULO : 0
  const final = document.createElement('canvas')
  final.width = (dibujo.ancho + MARGEN * 2) * ESCALA
  final.height = (dibujo.alto + MARGEN * 2 + altoTitulo) * ESCALA
  const ctx = final.getContext('2d')
  ctx.scale(ESCALA, ESCALA)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, final.width, final.height)
  if (titulo) {
    ctx.fillStyle = TINTA
    ctx.font = `700 16px ${FUENTE}`
    ctx.textBaseline = 'top'
    ctx.fillText(titulo, MARGEN, MARGEN)
  }
  ctx.drawImage(dibujo.lienzo, MARGEN, MARGEN + altoTitulo, dibujo.ancho, dibujo.alto)
  return final
}

export function crearImagenGrafico(contenedor, titulo, barras) {
  return new Promise((resolver, rechazar) => {
    let dibujo
    try {
      const canvas = contenedor?.querySelector('canvas')
      const grafico = canvas && Chart.getChart(canvas)
      if (grafico) dibujo = dibujarConChartJs(grafico)
      else if (barras?.length) dibujo = dibujarBarras(barras)
      else throw new Error('No hay un gráfico para copiar.')
      const final = componer(titulo, dibujo)
      final.toBlob((blob) => (blob ? resolver(blob) : rechazar(new Error('No se pudo crear la imagen.'))), 'image/png')
    } catch (error) {
      rechazar(error)
    } finally {
      dibujo?.limpiar()
    }
  })
}

export function puedeCopiarImagenes() {
  return window.isSecureContext && typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
}

export async function copiarImagen(promesaBlob) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': promesaBlob })])
}

export function descargarImagen(blob, titulo) {
  const nombre = `${(titulo || 'grafico').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'grafico'}.png`
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
