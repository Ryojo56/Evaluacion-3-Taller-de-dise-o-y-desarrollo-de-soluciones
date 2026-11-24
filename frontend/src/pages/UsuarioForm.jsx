import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorCampo, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { AlertaError, Cargando } from '../components/Estados.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import ClaveTemporal from '../components/ClaveTemporal.jsx'

// Contraseña temporal aleatoria que cumple los requisitos (mayúscula, número y símbolo)
function generarPassword() {
  const azar = (s) => s[Math.floor(Math.random() * s.length)]
  const todos = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#$%&*'
  let p = azar('ABCDEFGHJKLMNPQRSTUVWXYZ') + azar('23456789') + azar('#$%&*')
  while (p.length < 10) p += azar(todos)
  return p.split('').sort(() => Math.random() - 0.5).join('')
}

const VACIO = { first_name: '', last_name: '', email: '', telefono: '', rol: '', is_active: true }

// Sirve para crear (/usuarios/nuevo) y para editar (/usuarios/5/editar)
export default function UsuarioForm() {
  const { id } = useParams()
  const editando = Boolean(id)
  const { usuario: yo } = useAuth()
  const dialogo = useDialogo()
  const navigate = useNavigate()

  const { data: dataRoles } = useApi('/roles/')                              // GET /api/roles/
  const { data: dataUsuario, cargando } = useApi(editando ? `/usuarios/${id}/` : null) // GET /api/usuarios/<id>/

  const [form, setForm] = useState({ ...VACIO, password: generarPassword() })
  const [error, setError] = useState(null)

  // Al editar: cuando llega el usuario desde Django, llenamos el formulario
  useEffect(() => {
    if (dataUsuario) {
      const u = dataUsuario.usuario
      setForm({ first_name: u.first_name, last_name: u.last_name, email: u.correo,
                telefono: u.telefono, rol: u.rol, is_active: u.activo })
    }
  }, [dataUsuario])

  const cambiar = (e) => {
    const { name, value, type, checked } = e.target
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editando) {
        const data = await api.post(`/editarUsuario/${id}/`, form) // POST /api/editarUsuario/<id>/
        navigate('/usuarios', { state: { aviso: { tipo: 'success', texto: `Cambios guardados para ${data.usuario.nombre}.` } } })
      } else {
        const data = await api.post('/addUsuario/', form)          // POST /api/addUsuario/
        setError(null)
        // Modal con la contraseña temporal (y botón Copiar); al cerrarlo, vuelve al listado
        await dialogo.avisar({
          titulo: 'Cuenta creada',
          contenido: <ClaveTemporal nombre={data.usuario.nombre} correo={data.usuario.correo} clave={form.password} />,
        })
        navigate('/usuarios', { state: { aviso: { tipo: 'success', texto: `Cuenta creada para ${data.usuario.nombre}.` } } })
      }
    } catch (err) {
      setError(err)
    }
  }

  if (editando && cargando) return <Cargando />

  if (editando && dataUsuario && !dataUsuario.usuario.puede_editar) {
    return (
      <div className="card p-4" style={{ maxWidth: 680 }}>
        <h1 className="h5 fw-bold">Cuenta de administrador</h1>
        <p className="text-secondary mb-3">
          Solo un administrador puede modificar la cuenta de <strong>{dataUsuario.usuario.nombre}</strong>.
        </p>
        <Link to="/usuarios" className="btn btn-outline-secondary align-self-start">← Volver a usuarios</Link>
      </div>
    )
  }

  const soyYo = editando && Number(id) === yo.id
  const campo = (name, label, props = {}) => (
    <>
      <label htmlFor={name} className="form-label small text-secondary">{label}</label>
      <input id={name} name={name} value={form[name]} onChange={cambiar} {...props}
        className={`form-control ${errorCampo(error, name) ? 'is-invalid' : ''}`} />
      <div className="invalid-feedback">{errorCampo(error, name)}</div>
    </>
  )

  return (
    <div className="card p-4 p-md-5" style={{ maxWidth: 680 }}>
      <div className="d-flex justify-content-between align-items-start mb-4">
        <h1 className="h4 fw-bold mb-0">{editando ? 'Editar usuario' : 'Crear cuenta de usuario'}</h1>
        <Link to="/usuarios" className="small text-secondary text-decoration-none">← Volver a usuarios</Link>
      </div>
      <AlertaError mensaje={errorGeneral(error)} />
      <form onSubmit={handleSubmit}>
        <div className="row g-3 mb-3">
          <div className="col-md-6">{campo('first_name', 'Nombre', { placeholder: 'Nombre' })}</div>
          <div className="col-md-6">{campo('last_name', 'Apellido', { placeholder: 'Apellido' })}</div>
        </div>
        <div className="mb-3">{campo('email', 'Correo (con él inicia sesión)', { type: 'email' })}</div>
        <div className="mb-3">{campo('telefono', 'Número de teléfono', { type: 'tel', placeholder: '+56 9 1234 5678' })}</div>
        <div className="mb-3">
          <label htmlFor="rol" className="form-label small text-secondary">Rol asignado</label>
          <select id="rol" name="rol" value={form.rol} onChange={cambiar} disabled={soyYo}
            className={`form-select ${errorCampo(error, 'rol') ? 'is-invalid' : ''}`}>
            <option value="" disabled>Selecciona un rol</option>
            {dataRoles?.roles.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
          </select>
          <div className="invalid-feedback">{errorCampo(error, 'rol')}</div>
          {soyYo && <div className="form-text">No puedes cambiar tu propio rol.</div>}
        </div>

        {editando ? (
          <div className="form-check form-switch mb-4">
            <input className="form-check-input" type="checkbox" role="switch" id="is_active" name="is_active"
              checked={form.is_active} onChange={cambiar} disabled={soyYo} />
            <label className="form-check-label" htmlFor="is_active">
              Cuenta activa {!form.is_active && <span className="text-secondary">(no podrá iniciar sesión)</span>}
            </label>
          </div>
        ) : (
          <div className="mb-4">
            <label htmlFor="tmp" className="form-label small text-secondary">Contraseña temporal</label>
            <div className="input-group">
              <input id="tmp" className="form-control sku bg-light" value={form.password} readOnly />
              <button type="button" className="btn btn-outline-secondary"
                onClick={() => setForm({ ...form, password: generarPassword() })}>↻ Generar</button>
            </div>
          </div>
        )}

        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-accent flex-fill py-2">{editando ? 'Guardar cambios' : 'Crear cuenta'}</button>
          <button type="button" className="btn btn-outline-secondary flex-fill py-2" onClick={() => navigate('/usuarios')}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
