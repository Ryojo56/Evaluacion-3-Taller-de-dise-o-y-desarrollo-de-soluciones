import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CFormInput } from '@coreui/react'
import { api } from '../../api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../Toasts.jsx'

// ============================================================================
// [UX operario] Buscador/escáner siempre visible en el encabezado.
// - Un lector de códigos USB "escribe" el código y presiona Enter: funciona solo.
// - Atajo de teclado: F2 (o "/") pone el cursor aquí desde cualquier pantalla.
// - Bodeguero/admin: si es el código de una herramienta, abre su ficha de códigos.
// ============================================================================
export default function EscanerGlobal() {
  const { usuario } = useAuth()
  const navigate = useNavigate()
  const avisar = useToast()
  const [texto, setTexto] = useState('')
  const [buscando, setBuscando] = useState(false)
  const campo = useRef(null)
  const gestor = ['admin', 'bodeguero'].includes(usuario.rol)

  useEffect(() => {
    const atajo = (e) => {
      const escribiendo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (e.key === 'F2' || (e.key === '/' && !escribiendo)) {
        e.preventDefault()
        campo.current?.focus()
        campo.current?.select()
      }
    }
    document.addEventListener('keydown', atajo)
    return () => document.removeEventListener('keydown', atajo)
  }, [])

  const destino = usuario.rol === 'rrhh' ? '/usuarios' : gestor ? '/catalogo' : '/catalogo-trabajador'

  const buscar = async (e) => {
    e.preventDefault()
    const valor = texto.trim()
    if (!valor || buscando) return
    // Un código de herramienta tiene la forma SKU-NNN (ej. HRM-0001-003)
    if (gestor && /^[A-Za-z0-9]{1,5}-\d{1,6}-\d{1,4}$/.test(valor)) {
      setBuscando(true)
      try {
        const { unidad } = await api.get(`/unidades/${encodeURIComponent(valor.toUpperCase())}/`)
        const detalle = unidad.prestada_a ? `prestada a ${unidad.prestada_a}` : `${unidad.estado.toLowerCase()} en ${unidad.bodega}`
        avisar(`${unidad.codigo} · ${unidad.item}: ${detalle}`, 'info')
        navigate(`/items/${unidad.sku}/unidades`)
        setTexto('')
        return
      } catch {
        // si no existe como código, se busca como texto en el catálogo
      } finally {
        setBuscando(false)
      }
    }
    navigate(`${destino}?q=${encodeURIComponent(valor)}`)
    setTexto('')
  }

  return (
    <form onSubmit={buscar} className="escaner-global" role="search">
      {/* Buscador simple. Igual acepta códigos de barras: el lector escribe el código y presiona Enter */}
      <CFormInput ref={campo} type="search" size="sm" value={texto} onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar" aria-label="Buscar" autoComplete="off" maxLength={100} />
    </form>
  )
}
