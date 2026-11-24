import { useState } from 'react'
import { api, errorCampo, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { AlertaError } from '../components/Estados.jsx'

// Contraseña temporal aleatoria que cumple los requisitos (mayúscula, número y símbolo)
function generarPassword() {
  const azar = (s) => s[Math.floor(Math.random() * s.length)]
  const todos = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#$%&*'
  let p = azar('ABCDEFGHJKLMNPQRSTUVWXYZ') + azar('23456789') + azar('#$%&*')
  while (p.length < 10) p += azar(todos)
  return p.split('').sort(() => Math.random() - 0.5).join('')
}

const VACIO = { first_name: '', last_name: '', email: '', telefono: '', rol: '' }

export default function CrearUsuario() {
  const { data: dataRoles } = useApi('/roles/') // GET /api/roles/
  const [form, setForm] = useState({ ...VACIO, password: generarPassword() })
  const [error, setError] = useState(null)
  const [creado, setCreado] = useState(null)
  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const data = await api.post('/addUsuario/', form) // POST /api/addUsuario/
      setCreado({ ...data.usuario, password: form.password })
      setForm({ ...VACIO, password: generarPassword() })
      setError(null)
    } catch (err) {
      setError(err)
      setCreado(null)
    }
  }

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
      <h1 className="h4 fw-bold mb-4">Crear cuenta de usuario</h1>
      {creado && (
        <div className="alert alert-success small">
          Cuenta creada para <strong>{creado.nombre}</strong> ({creado.correo}).<br />
          Contraseña temporal: <span className="sku">{creado.password}</span>. Deberá cambiarla al entrar.
        </div>
      )}
      <AlertaError mensaje={errorGeneral(error)} />
      <form onSubmit={handleSubmit}>
        <div className="row g-3 mb-3">
          <div className="col-md-6">{campo('first_name', 'Nombre', { placeholder: 'Nombre' })}</div>
          <div className="col-md-6">{campo('last_name', 'Apellido', { placeholder: 'Apellido' })}</div>
        </div>
        <div className="mb-3">{campo('email', 'Correo', { type: 'email' })}</div>
        <div className="mb-3">{campo('telefono', 'Número de teléfono', { type: 'tel', placeholder: '+56 9 1234 5678' })}</div>
        <div className="mb-3">
          <label htmlFor="rol" className="form-label small text-secondary">Rol asignado</label>
          <select id="rol" name="rol" value={form.rol} onChange={cambiar}
            className={`form-select ${errorCampo(error, 'rol') ? 'is-invalid' : ''}`}>
            <option value="" disabled>Selecciona un rol</option>
            {dataRoles?.roles.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
          </select>
          <div className="invalid-feedback">{errorCampo(error, 'rol')}</div>
        </div>
        <div className="mb-4">
          <label htmlFor="tmp" className="form-label small text-secondary">Contraseña temporal</label>
          <div className="input-group">
            <input id="tmp" className="form-control sku bg-light" value={form.password} readOnly />
            <button type="button" className="btn btn-outline-secondary"
              onClick={() => setForm({ ...form, password: generarPassword() })}>↻ Generar</button>
          </div>
        </div>
        <button type="submit" className="btn btn-accent w-100 py-2">Crear cuenta</button>
      </form>
    </div>
  )
}
