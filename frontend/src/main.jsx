import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

// [CoreUI] Estilos de CoreUI 5 (incluyen todo Bootstrap 5.3, por eso ya no se importa
// bootstrap.min.css: tenerlos ambos producía estilos duplicados y en conflicto).
import './scss/style.scss'
// Estilos propios de las páginas (el layout antiguo se eliminó de este archivo)
import './styles/bodega.css'

import App from './App.jsx'
import { iniciarTema } from './tema.js'
import { AuthProvider } from './context/AuthContext.jsx'
import { DialogoProvider } from './components/Dialogo.jsx'
import { ToastProvider } from './components/Toasts.jsx'

iniciarTema()   // tema claro por defecto, también en la pantalla de login

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* DialogoProvider: permite abrir modales desde cualquier página con useDialogo() */}
        <DialogoProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </DialogoProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
