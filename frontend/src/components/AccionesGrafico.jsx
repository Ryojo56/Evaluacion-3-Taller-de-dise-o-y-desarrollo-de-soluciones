import { useState } from 'react'
import { CButton } from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilCloudDownload, cilCopy } from '@coreui/icons'
import { useToast } from './Toasts.jsx'
import { copiarImagen, crearImagenGrafico, descargarImagen, puedeCopiarImagenes } from '../imagenGrafico.js'

export default function AccionesGrafico({ titulo, contenedor, barras }) {
  const avisar = useToast()
  const [ocupado, setOcupado] = useState(false)

  const copiar = async () => {
    setOcupado(true)
    const imagen = crearImagenGrafico(contenedor.current, titulo, barras)
    try {
      if (!puedeCopiarImagenes()) throw new Error('sin-portapapeles')
      await copiarImagen(imagen)
      avisar('Gráfico copiado. Pégalo en tu informe con Ctrl+V.')
    } catch {
      try {
        descargarImagen(await imagen, titulo)
        avisar('Este navegador no deja copiar imágenes: el gráfico se descargó como PNG.', 'info')
      } catch {
        avisar('No se pudo copiar el gráfico.', 'danger')
      }
    } finally {
      setOcupado(false)
    }
  }

  const descargar = async () => {
    setOcupado(true)
    try {
      descargarImagen(await crearImagenGrafico(contenedor.current, titulo, barras), titulo)
    } catch {
      avisar('No se pudo descargar el gráfico.', 'danger')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="d-inline-flex gap-1 ms-auto acciones-grafico">
      <CButton size="sm" color="secondary" variant="ghost" disabled={ocupado} onClick={copiar}
        title="Copiar el gráfico como imagen para pegarlo en un informe" aria-label={`Copiar gráfico: ${titulo}`}>
        <CIcon icon={cilCopy} size="sm" className="me-1" />Copiar
      </CButton>
      <CButton size="sm" color="secondary" variant="ghost" disabled={ocupado} onClick={descargar}
        title="Descargar el gráfico como imagen PNG" aria-label={`Descargar gráfico: ${titulo}`}>
        <CIcon icon={cilCloudDownload} size="sm" />
      </CButton>
    </div>
  )
}
