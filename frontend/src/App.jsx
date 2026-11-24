import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import RutaProtegida from './components/RutaProtegida.jsx'

import Login from './pages/Login.jsx'
import CambiarPassword from './pages/CambiarPassword.jsx'
import Home from './pages/Home.jsx'
import CatalogoStock from './pages/CatalogoStock.jsx'
import ItemForm from './pages/ItemForm.jsx'
import UnidadesItem from './pages/UnidadesItem.jsx'
import HistorialPrestamos from './pages/HistorialPrestamos.jsx'
import MisPrestamos from './pages/MisPrestamos.jsx'
import Perfil from './pages/Perfil.jsx'
import Bodegas from './pages/Bodegas.jsx'
import EspaciosBodega from './pages/EspaciosBodega.jsx'
import Categorias from './pages/Categorias.jsx'
import CatalogoTrabajador from './pages/CatalogoTrabajador.jsx'
import Solicitar from './pages/Solicitar.jsx'
import SolicitudesBodeguero from './pages/SolicitudesBodeguero.jsx'
import ComentarDevolucion from './pages/ComentarDevolucion.jsx'
import Usuarios from './pages/Usuarios.jsx'
import UsuarioForm from './pages/UsuarioForm.jsx'
import Pedidos from './pages/Pedidos.jsx'
import { Cargando } from './components/Estados.jsx'

// Reportes trae DataTables + Excel + PDF (pesado): se descarga solo al abrir esa página
const Reportes = lazy(() => import('./pages/Reportes.jsx'))
// Registro de movimientos (nuevo): historial de movimientos de stock
const Movimientos = lazy(() => import('./pages/Movimientos.jsx'))
const Papelera = lazy(() => import('./pages/Papelera.jsx'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Desde aquí hacia abajo: hay que haber iniciado sesión */}
      <Route element={<RutaProtegida />}>
        <Route path="/cambiar-password" element={<CambiarPassword />} />

        {/* [CoreUI] Layout nuevo; las rutas y los permisos por rol no cambian */}
        <Route element={<AppLayout />}>
          {/* Todos los roles */}
          <Route path="/" element={<Home />} />
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/prestamos" element={<HistorialPrestamos />} />
          <Route path="/mis-prestamos" element={<MisPrestamos />} />
          <Route path="/devolucion/:id" element={<ComentarDevolucion />} />
          <Route path="/catalogo-trabajador" element={<CatalogoTrabajador />} />
          <Route path="/solicitar/:sku" element={<Solicitar />} />
          <Route path="/pedidos" element={<Pedidos />} />

          {/* Admin y bodeguero */}
          <Route element={<RutaProtegida roles={['admin', 'bodeguero']} />}>
            <Route path="/catalogo" element={<CatalogoStock />} />
            <Route path="/items/nuevo" element={<ItemForm />} />
            <Route path="/items/:sku/editar" element={<ItemForm />} />
            <Route path="/items/:sku/unidades" element={<UnidadesItem />} />
            <Route path="/solicitudes" element={<SolicitudesBodeguero />} />
            <Route path="/bodegas" element={<Bodegas />} />
            <Route path="/bodegas/:id/espacios" element={<EspaciosBodega />} />
            <Route path="/categorias" element={<Categorias />} />
            <Route path="/movimientos" element={<Suspense fallback={<Cargando />}><Movimientos /></Suspense>} />
          </Route>

          {/* Solo admin: papelera de bodegas, categorías e ítems */}
          <Route element={<RutaProtegida roles={['admin']} />}>
            <Route path="/papelera" element={<Suspense fallback={<Cargando />}><Papelera /></Suspense>} />
          </Route>

          <Route element={<RutaProtegida roles={['admin', 'rrhh']} />}>
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/usuarios/nuevo" element={<UsuarioForm />} />
            <Route path="/usuarios/:id/editar" element={<UsuarioForm />} />
            <Route path="/reportes" element={<Suspense fallback={<Cargando />}><Reportes /></Suspense>} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
