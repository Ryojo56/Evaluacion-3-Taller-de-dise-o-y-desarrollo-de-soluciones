import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CToast, CToastBody, CToaster } from '@coreui/react'

// ============================================================================
// [UX] Avisos flotantes (toasts de CoreUI) para confirmar al operario que algo
// se guardó o falló, sin moverlo de la pantalla en la que está trabajando.
// Uso:  const avisar = useToast();  avisar('Ítem guardado')  /  avisar('Error', 'danger')
// ============================================================================
const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const contador = useRef(0)

  const avisar = useCallback((texto, color = 'success') => {
    contador.current += 1
    setToast(
      <CToast key={contador.current} autohide delay={color === 'danger' ? 6000 : 3500} color={color}
        className="text-white align-items-center">
        <div className="d-flex">
          <CToastBody role={color === 'danger' ? 'alert' : 'status'}>{texto}</CToastBody>
        </div>
      </CToast>,
    )
  }, [])

  return (
    <ToastContext.Provider value={avisar}>
      {children}
      <CToaster push={toast} placement="top-end" className="p-3" />
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
