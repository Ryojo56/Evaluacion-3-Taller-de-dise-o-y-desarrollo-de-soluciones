import { useMemo, useState } from 'react'
import TablaDatos from '../components/TablaDatos.jsx'
import { Link, useLocation } from 'react-router-dom'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Cargando, AlertaError } from '../components/Estados.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import ClaveTemporal from '../components/ClaveTemporal.jsx'
import MenuAcciones from '../components/MenuAcciones.jsx'

const ROLES = { admin: 'Administrador', bodeguero: 'Bodeguero', trabajador: 'Trabajador', rrhh: 'Recursos humanos' }
const ROLES_PLURAL = { admin: 'Administradores', bodeguero: 'Bodegueros', trabajador: 'Trabajadores', rrhh: 'Recursos humanos' }
const COLOR_ROL = { admin: 'purple', bodeguero: 'primary', trabajador: 'secondary', rrhh: 'teal' }

const ordenFecha = (f) => (f ? f.split('-').reverse().join('-') : '')
const iniciales = (nombre) => nombre.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()


export default function Usuarios() {
  const { usuario: yo } = useAuth()
  const dialogo = useDialogo()
  const location = useLocation()
  // [Soft delete] ?vista=eliminados muestra la papelera (cuentas eliminadas, con su historial intacto)
  const papelera = new URLSearchParams(location.search).get('vista') === 'eliminados'
  const { data, cargando, error, recargar } = useApi(papelera ? '/usuarios/?eliminados=1' : '/usuarios/')
  const buscar = new URLSearchParams(location.search).get('q') || ''
  const [rol, setRol] = useState('')
  const [estado, setEstado] = useState('')
  const [aviso, setAviso] = useState(location.state?.aviso || null) // viene del formulario
  const [errorAccion, setErrorAccion] = useState(null)

  // Ejecuta una acción, muestra el resultado y recarga la tabla
  const accion = async (promesa, mensajeOk) => {
    setErrorAccion(null)
    try {
      const r = await promesa
      setAviso(typeof mensajeOk === 'function' ? mensajeOk(r) : mensajeOk)
      recargar()
      return r
    } catch (err) {
      setAviso(null)
      setErrorAccion(err)
      return null
    }
  }

  const cambiarEstado = async (u) => {
    const desactivar = u.activo
    const ok = await dialogo.confirmar({
      titulo: desactivar ? 'Desactivar usuario' : 'Activar usuario',
      mensaje: desactivar
        ? <>¿Desactivar a <strong>{u.nombre}</strong>? No podrá iniciar sesión hasta que lo actives de nuevo. Su historial se conserva.</>
        : <>¿Activar a <strong>{u.nombre}</strong>? Podrá volver a iniciar sesión.</>,
      textoBoton: desactivar ? 'Desactivar' : 'Activar',
      peligro: desactivar,
    })
    if (!ok) return
    accion(
      api.post(`/editarUsuario/${u.id}/`, {
        first_name: u.first_name, last_name: u.last_name, email: u.correo,
        telefono: u.telefono, rol: u.rol, is_active: !u.activo,
      }),
      { tipo: 'success', texto: `${u.nombre} quedó ${u.activo ? 'desactivado: ya no puede iniciar sesión' : 'activo'}.` }
    )
  }

  // Nueva clave: modal de confirmación -> Django genera la clave -> modal con la clave y botón Copiar
  const restablecer = async (u) => {
    const ok = await dialogo.confirmar({
      titulo: 'Generar nueva clave',
      mensaje: <>Se creará una contraseña temporal para <strong>{u.nombre}</strong>. Su contraseña actual
        dejará de funcionar y deberá crear una nueva al iniciar sesión.</>,
      textoBoton: 'Generar clave',
    })
    if (!ok) return
    const r = await accion(api.post(`/resetPassword/${u.id}/`), null) // POST /api/resetPassword/<id>/
    if (r) {
      dialogo.avisar({
        titulo: 'Nueva clave generada',
        contenido: <ClaveTemporal nombre={u.nombre} correo={u.correo} clave={r.password_temporal} />,
      })
    }
  }

  const eliminar = async (u) => {
    const ok = await dialogo.confirmar({
      titulo: 'Eliminar usuario',
      mensaje: <>¿Eliminar a <strong>{u.nombre}</strong>? La cuenta dejará de aparecer y no podrá iniciar sesión.
        Sus solicitudes y préstamos se conservan, y se puede restaurar desde la papelera.</>,
      textoBoton: 'Eliminar',
      peligro: true,
    })
    if (!ok) return
    accion(api.post(`/deleteUsuario/${u.id}/`), { tipo: 'success', texto: `${u.nombre} se movió a la papelera.` })
  }

  const restaurar = async (u) => {
    const ok = await dialogo.confirmar({
      titulo: 'Restaurar usuario',
      mensaje: <>¿Restaurar la cuenta de <strong>{u.nombre}</strong>? Volverá a la lista como <strong>inactiva</strong>;
        actívala cuando corresponda.</>,
      textoBoton: 'Restaurar',
    })
    if (!ok) return
    accion(api.post(`/restaurarUsuario/${u.id}/`), { tipo: 'success', texto: `${u.nombre} fue restaurado (inactivo).` })
  }

  const todos = useMemo(() => data?.usuarios || [], [data])
  const porEstado = useMemo(() => todos.filter((u) => !estado || (estado === 'activo' ? u.activo : !u.activo)), [todos, estado])
  const visibles = useMemo(() => porEstado.filter((u) => !rol || u.rol === rol), [porEstado, rol])

  const borrar = async (u) => {
    const ok = await dialogo.confirmar({
      titulo: 'Eliminar definitivamente', peligro: true, textoBoton: 'Eliminar para siempre',
      mensaje: <>¿Borrar la cuenta de <strong>{u.nombre}</strong> para siempre? Solo se puede si nunca pidió ni
        entregó nada.</>,
    })
    if (!ok) return
    accion(api.post(`/eliminarDefinitivo/usuarios/${u.id}/`), { tipo: 'success', texto: `${u.nombre} se eliminó definitivamente.` })
  }

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const resumen = [
    { titulo: 'Usuarios', valor: todos.length },
    { titulo: 'Activos', valor: todos.filter((u) => u.activo).length, clase: 'text-success' },
    { titulo: 'Inactivos', valor: todos.filter((u) => !u.activo).length, clase: 'text-secondary' },
    { titulo: 'Con clave temporal', valor: todos.filter((u) => u.activo && u.debe_cambiar_password).length, clase: 'text-warning-emphasis' },
  ]

  const accionesDe = (u, soyYo) => [
    { texto: 'Generar nueva clave', alHacer: () => restablecer(u) },
    soyYo
      ? { texto: 'Desactivar', alHacer: () => {}, deshabilitado: 'No puedes desactivarte a ti mismo' }
      : { texto: u.activo ? 'Desactivar' : 'Activar', alHacer: () => cambiarEstado(u), peligro: u.activo },
    {
      texto: 'Eliminar', alHacer: () => eliminar(u), peligro: true,
      deshabilitado: u.puede_eliminar ? null
        : soyYo ? 'No puedes eliminar tu propia cuenta' : 'Tiene herramientas sin devolver',
    },
  ]

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">{papelera ? 'Papelera de usuarios' : 'Usuarios'}</h1>
          <p className="text-secondary mb-0">
            {papelera ? 'Cuentas eliminadas: no pueden entrar, pero su historial se conserva'
              : 'Cuentas con acceso al sistema y sus permisos'}
          </p>
        </div>
        {papelera
          ? <Link to="/usuarios" className="btn btn-outline-secondary boton-movil-ancho">← Volver a usuarios</Link>
          : <Link to="/usuarios/nuevo" className="btn btn-crear boton-movil-ancho">+ Nuevo usuario</Link>}
      </div>

      <div className="row g-2 mb-3">
        {resumen.map((r) => (
          <div className="col-6 col-md-3" key={r.titulo}>
            <div className="kpi">
              <div className="kpi-titulo">{r.titulo}</div>
              <div className={`kpi-valor ${r.clase || ''}`}>{r.valor}</div>
            </div>
          </div>
        ))}
      </div>

      {aviso && (
        <div className={`alert alert-${aviso.tipo} py-2 small d-flex justify-content-between align-items-center`}>
          <span>{aviso.texto}</span>
          <button type="button" className="btn-close btn-sm" aria-label="Cerrar" onClick={() => setAviso(null)}></button>
        </div>
      )}
      <AlertaError mensaje={errorAccion && errorGeneral(errorAccion)} />

      <div className="pills-filtro mb-2" role="group" aria-label="Filtrar por rol">
        {[['', 'Todos'], ...Object.entries(ROLES_PLURAL)].map(([v, t]) => (
          <button key={v || 'todos'} className={`btn ${rol === v ? 'active' : ''}`} onClick={() => setRol(v)} aria-pressed={rol === v}>
            {t} <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis ms-1">
              {porEstado.filter((u) => !v || u.rol === v).length}
            </span>
          </button>
        ))}
      </div>

      <div className="d-flex justify-content-end mb-2">
        <select className={`form-select ${estado ? 'filtro-activo' : ''}`} style={{ maxWidth: 220 }} value={estado}
          onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          <option value="activo">Solo activos</option>
          <option value="inactivo">Solo inactivos</option>
        </select>
      </div>

      <TablaDatos datos={visibles} titulo={papelera ? 'Usuarios eliminados' : 'Usuarios'} archivo="usuarios"
        busqueda={buscar} orden={[[0, 'asc']]} vacio="Ningún usuario coincide con los filtros" columnas={[
          { titulo: 'Usuario', dato: 'nombre', texto: (u) => `${u.nombre} ${u.correo}`, render: (v, u) => (
            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
              {u.foto
                ? <img src={u.foto} alt="" className="avatar avatar-foto" loading="lazy" />
                : <span className={`avatar avatar-rol-${u.rol}`}>{iniciales(v)}</span>}
              <div style={{ minWidth: 0 }}>
                <div className="fw-semibold text-truncate">
                  {v} {u.id === yo.id && <span className="badge bg-secondary-subtle text-secondary-emphasis ms-1">Tú</span>}
                </div>
                <div className="small text-body-secondary text-truncate">{u.correo}</div>
              </div>
            </div>
          ) },
          { titulo: 'Teléfono', dato: 'telefono', clase: 'text-nowrap small', render: (v) => v || <span className="text-body-secondary">Sin teléfono</span> },
          { titulo: 'Rol', dato: 'rol', texto: (u) => ROLES[u.rol],
            render: (v) => <span className={`badge rounded-pill bg-${COLOR_ROL[v]}-subtle text-${COLOR_ROL[v]}-emphasis`}>{ROLES[v]}</span> },
          { titulo: 'Estado', dato: 'activo', texto: (u) => (u.activo ? 'Activo' : 'Inactivo'), render: (v, u) => (
            <div className="d-flex flex-wrap gap-1">
              {v ? <span className="badge bg-success-subtle text-success-emphasis">Activo</span>
                : <span className="badge bg-secondary-subtle text-secondary-emphasis">Inactivo</span>}
              {v && u.debe_cambiar_password && <span className="badge bg-warning-subtle text-warning-emphasis">Clave temporal</span>}
            </div>
          ) },
          { titulo: 'Último acceso', dato: 'ultimo_acceso', clase: 'text-nowrap', texto: (u) => ordenFecha(u.ultimo_acceso) || 'Nunca',
            render: (v) => <span className="sku">{v || 'Nunca'}</span> },
          { titulo: 'Acciones', acciones: (u) => papelera ? (
            <div className="d-inline-flex gap-1">
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => restaurar(u)}>Restaurar</button>
              {yo.rol === 'admin' && (
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => borrar(u)}>Borrar</button>
              )}
            </div>
          ) : u.puede_editar ? (
            <div className="d-inline-flex align-items-center gap-2">
              <Link to={`/usuarios/${u.id}/editar`} className="btn btn-sm btn-outline-secondary">Editar</Link>
              <MenuAcciones etiqueta={`Más acciones para ${u.nombre}`} acciones={accionesDe(u, u.id === yo.id)} />
            </div>
          ) : <span className="small text-body-secondary" title="Solo un administrador puede modificar esta cuenta">Solo lectura</span> },
        ]} />
      <p className="small text-secondary mt-2">
        Eliminar una cuenta no borra su historial:
        queda en la <Link to="/usuarios?vista=eliminados">papelera</Link> y se puede restaurar.
        {yo.rol === 'rrhh' && ' Las cuentas de administrador solo las puede modificar un administrador.'}
      </p>
    </>
  )
}
