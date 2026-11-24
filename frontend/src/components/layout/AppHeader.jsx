import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  CAvatar, CBadge, CContainer, CDropdown, CDropdownDivider, CDropdownHeader, CDropdownItem, CDropdownMenu,
  CButton, CDropdownToggle, CHeader, CHeaderNav, useColorModes,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilAccountLogout, cilContrast, cilList, cilMoon, cilSun, cilUser } from '@coreui/icons'
import { useAuth } from '../../context/AuthContext.jsx'
import Notificaciones from '../Notificaciones.jsx'
import EscanerGlobal from './EscanerGlobal.jsx'
import { ROLES, tituloDe } from './navegacion.js'
import { CLAVE_TEMA } from '../../tema.js'

const COLOR_ROL = { admin: 'primary', bodeguero: 'info', trabajador: 'secondary', rrhh: 'success' }

// Encabezado de CoreUI (basado en AppHeader del template)
export default function AppHeader({ escritorio, onMenu }) {
  const { usuario, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const encabezado = useRef(null)
  const { colorMode, setColorMode } = useColorModes(CLAVE_TEMA)

  useEffect(() => {
    const alDesplazar = () => encabezado.current?.classList.toggle('shadow-sm', document.documentElement.scrollTop > 0)
    document.addEventListener('scroll', alDesplazar)
    return () => document.removeEventListener('scroll', alDesplazar)
  }, [])

  const iniciales = usuario.nombre.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  const salir = async () => {
    await logout()
    navigate('/login')
  }
  const temas = [['light', cilSun, 'Claro'], ['dark', cilMoon, 'Oscuro'], ['auto', cilContrast, 'Automático']]
  const iconoTema = temas.find(([m]) => m === colorMode)?.[1] || cilContrast

  return (
    <CHeader position="sticky" className="mb-4 p-0 no-imprimir" ref={encabezado}>
      <CContainer className="border-bottom px-3 px-md-4 gap-2 flex-wrap flex-md-nowrap py-2 py-md-0" fluid>
        {/* [Menú] El botón de las 3 rayas se quitó: en computador/tablet el menú lateral está siempre
            a la vista. Solo en celular aparece este botón "Menú" para abrirlo. */}
        {!escritorio && (
          <CButton color="primary" variant="outline" size="sm" onClick={onMenu} aria-label="Abrir menú">
            <CIcon icon={cilList} className="me-1" /> Menú
          </CButton>
        )}
        <span className="fw-semibold text-nowrap d-none d-sm-inline">{tituloDe(location, usuario.rol)}</span>

        <CHeaderNav className="ms-auto align-items-center gap-2 order-md-2">
          <Notificaciones />
          <CDropdown variant="nav-item" placement="bottom-end">
            <CDropdownToggle caret={false} aria-label="Tema de colores">
              <CIcon icon={iconoTema} size="lg" />
            </CDropdownToggle>
            <CDropdownMenu>
              {temas.map(([modo, icono, nombre]) => (
                <CDropdownItem key={modo} active={colorMode === modo} as="button" type="button"
                  className="d-flex align-items-center" onClick={() => setColorMode(modo)}>
                  <CIcon className="me-2" icon={icono} size="lg" /> {nombre}
                </CDropdownItem>
              ))}
            </CDropdownMenu>
          </CDropdown>
          <CDropdown variant="nav-item" placement="bottom-end">
            <CDropdownToggle caret={false} className="py-0 pe-0" aria-label="Menú de usuario">
              {usuario.foto
                ? <CAvatar src={usuario.foto} size="md" className="avatar-con-foto" />
                : <CAvatar color={COLOR_ROL[usuario.rol]} textColor="white" size="md">{iniciales}</CAvatar>}
            </CDropdownToggle>
            <CDropdownMenu className="pt-0">
              <CDropdownHeader className="bg-body-secondary fw-semibold mb-2">
                {usuario.nombre}
                <div><CBadge color={COLOR_ROL[usuario.rol]}>{ROLES[usuario.rol]}</CBadge></div>
              </CDropdownHeader>
              <CDropdownItem as={Link} to="/perfil"><CIcon icon={cilUser} className="me-2" /> Mi perfil</CDropdownItem>
              <CDropdownDivider />
              <CDropdownItem as="button" type="button" onClick={salir}>
                <CIcon icon={cilAccountLogout} className="me-2" /> Cerrar sesión
              </CDropdownItem>
            </CDropdownMenu>
          </CDropdown>
        </CHeaderNav>

        <div className="order-md-1 ms-md-3 flex-grow-1 flex-md-grow-0 w-100 w-md-auto">
          <EscanerGlobal />
        </div>
      </CContainer>
    </CHeader>
  )
}
