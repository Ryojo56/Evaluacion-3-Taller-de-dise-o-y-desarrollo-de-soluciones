import { useEffect, useRef, useState } from 'react'
import Icono from './Iconos.jsx'

export default function MenuAcciones({ acciones, etiqueta = 'Más acciones' }) {
  const [pos, setPos] = useState(null)
  const boton = useRef(null)
  const lista = useRef(null)

  const abrir = () => {
    const r = boton.current.getBoundingClientRect()
    const alto = 46 * acciones.length + 12
    const haciaArriba = r.bottom + alto > window.innerHeight
    setPos({ right: window.innerWidth - r.right, top: haciaArriba ? r.top - alto - 4 : r.bottom + 4 })
  }

  useEffect(() => {
    if (!pos) return
    const cerrar = () => setPos(null)
    const clicFuera = (e) => {
      if (!lista.current?.contains(e.target) && !boton.current?.contains(e.target)) cerrar()
    }
    const tecla = (e) => { if (e.key === 'Escape') { cerrar(); boton.current?.focus() } }
    document.addEventListener('mousedown', clicFuera)
    document.addEventListener('keydown', tecla)
    const alDesplazar = (e) => { if (!lista.current?.contains(e.target)) cerrar() }
    window.addEventListener('scroll', alDesplazar, true)
    window.addEventListener('resize', cerrar)
    lista.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('mousedown', clicFuera)
      document.removeEventListener('keydown', tecla)
      window.removeEventListener('scroll', alDesplazar, true)
      window.removeEventListener('resize', cerrar)
    }
  }, [pos])

  return (
    <div className="menu-acciones">
      <button ref={boton} type="button" className="btn btn-sm btn-light border" aria-haspopup="menu"
        aria-expanded={!!pos} aria-label={etiqueta} title={etiqueta} onClick={() => (pos ? setPos(null) : abrir())}>
        <Icono nombre="puntos" size={16} />
      </button>
      {pos && (
        <div ref={lista} className="menu-acciones-lista" role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}>
          {acciones.map((a) => (
            <button key={a.texto} type="button" role="menuitem" className={a.peligro ? 'peligro' : ''}
              disabled={Boolean(a.deshabilitado)} title={a.deshabilitado || undefined}
              onClick={() => { setPos(null); a.alHacer() }}>
              {a.texto}
              {a.deshabilitado && <div className="small fw-normal">{a.deshabilitado}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
