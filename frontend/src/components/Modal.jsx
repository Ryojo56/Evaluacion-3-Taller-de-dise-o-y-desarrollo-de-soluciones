import { useEffect, useRef } from 'react'

// ============================================================================
// Modal: ventana con el estilo de Bootstrap, manejada por React.
// (No usa bootstrap.bundle.js: React decide cuándo se muestra.)
//   - Se cierra con la X, con la tecla Escape o haciendo clic fuera.
//   - Mientras está abierto, la página de fondo no se desplaza.
//   - Al abrir enfoca el primer campo o botón; al cerrar devuelve el foco.
// ============================================================================
export default function Modal({ titulo, children, onCerrar, cerrable = true, tamano }) {
  const dialogo = useRef(null)
  const props = useRef({ onCerrar, cerrable })
  props.current = { onCerrar, cerrable } // siempre la versión más reciente

  useEffect(() => {
    const focoAnterior = document.activeElement
    document.body.classList.add('modal-open') // Bootstrap: bloquea el scroll del fondo
    const primero = dialogo.current?.querySelector(
      '[data-autofocus], input:not([readonly]), textarea, select, .modal-footer .btn:last-child'
    )
    primero?.focus()

    const alPresionar = (e) => {
      if (e.key === 'Escape' && props.current.cerrable) props.current.onCerrar()
    }
    document.addEventListener('keydown', alPresionar)
    return () => {
      document.body.classList.remove('modal-open')
      document.removeEventListener('keydown', alPresionar)
      focoAnterior?.focus?.()
    }
  }, [])

  const clicFuera = (e) => {
    if (e.target === e.currentTarget && props.current.cerrable) props.current.onCerrar()
  }

  return (
    <>
      <div className="modal d-block modal-react" tabIndex="-1" role="dialog" aria-modal="true"
        aria-labelledby="modal-titulo" onMouseDown={clicFuera}>
        <div className={`modal-dialog modal-dialog-centered ${tamano ? `modal-${tamano}` : ''}`} ref={dialogo}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5 fw-bold" id="modal-titulo">{titulo}</h2>
              {cerrable && <button type="button" className="btn-close" aria-label="Cerrar" onClick={onCerrar}></button>}
            </div>
            {children /* aquí van .modal-body y .modal-footer */}
          </div>
        </div>
      </div>
      <div className="modal-backdrop show"></div>
    </>
  )
}
