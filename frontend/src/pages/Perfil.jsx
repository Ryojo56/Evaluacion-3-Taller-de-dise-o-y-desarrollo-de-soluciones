import { useRef, useState } from 'react'
import { api, errorCampo, errorGeneral } from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { AlertaError } from '../components/Estados.jsx'
import FormPassword from '../components/FormPassword.jsx'

const LADO_FOTO = 320
const MAX_ARCHIVO = 10 * 1024 * 1024

function recortarFoto(archivo) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo)
    const imagen = new Image()
    imagen.onload = () => {
      const lado = Math.min(imagen.naturalWidth, imagen.naturalHeight)
      const lienzo = document.createElement('canvas')
      lienzo.width = LADO_FOTO
      lienzo.height = LADO_FOTO
      const ctx = lienzo.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO)
      ctx.drawImage(imagen, (imagen.naturalWidth - lado) / 2, (imagen.naturalHeight - lado) / 2, lado, lado,
        0, 0, LADO_FOTO, LADO_FOTO)
      URL.revokeObjectURL(url)
      resolver(lienzo.toDataURL('image/jpeg', 0.85))
    }
    imagen.onerror = () => {
      URL.revokeObjectURL(url)
      rechazar(new Error('No se pudo leer la imagen. Prueba con una foto JPG o PNG.'))
    }
    imagen.src = url
  })
}

function FotoPerfil({ usuario, setUsuario }) {
  const entrada = useRef(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)
  const iniciales = usuario.nombre.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()

  const elegir = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setError('')
    setOk('')
    if (!archivo.type.startsWith('image/')) return setError('El archivo debe ser una imagen (JPG, PNG o WebP).')
    if (archivo.size > MAX_ARCHIVO) return setError('La imagen pesa más de 10 MB. Elige una más liviana.')
    setEnviando(true)
    try {
      const foto = await recortarFoto(archivo)
      const data = await api.post('/perfil/foto/', { foto })
      setUsuario(data.usuario)
      setOk('Foto actualizada.')
    } catch (err) {
      setError(err?.message && !err.status ? err.message : (errorCampo(err, 'foto') || errorGeneral(err)))
    } finally {
      setEnviando(false)
    }
  }

  const quitar = async () => {
    setError('')
    setOk('')
    setEnviando(true)
    try {
      const data = await api.post('/perfil/quitarFoto/')
      setUsuario(data.usuario)
      setOk('Foto eliminada.')
    } catch (err) {
      setError(errorGeneral(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="card p-4 mb-4">
      <h2 className="h6 fw-bold mb-3">Foto de perfil</h2>
      {ok && <div className="alert alert-success py-2 small">{ok}</div>}
      <AlertaError mensaje={error} />
      <div className="d-flex flex-wrap align-items-center gap-4">
        {usuario.foto
          ? <img src={usuario.foto} alt={`Foto de ${usuario.nombre}`} className="foto-perfil-grande" />
          : <span className={`foto-perfil-grande sin-foto avatar-rol-${usuario.rol}`} aria-label="Sin foto">{iniciales}</span>}
        <div>
          <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="d-none"
            onChange={elegir} aria-label="Elegir foto de perfil" />
          <div className="d-flex flex-wrap gap-2 mb-2">
            <button type="button" className="btn btn-accent" disabled={enviando} onClick={() => entrada.current?.click()}>
              {enviando ? 'Guardando...' : usuario.foto ? 'Cambiar foto' : 'Subir foto'}
            </button>
            {usuario.foto && (
              <button type="button" className="btn btn-outline-danger" disabled={enviando} onClick={quitar}>Quitar foto</button>
            )}
          </div>
          <div className="form-text">JPG, PNG o WebP. Se recorta al centro en forma cuadrada.</div>
        </div>
      </div>
    </div>
  )
}

export default function Perfil() {
  const { usuario, setUsuario } = useAuth()
  const [form, setForm] = useState({
    first_name: usuario.first_name,
    last_name: usuario.last_name,
    telefono: usuario.telefono,
    email: usuario.correo,
    password: '',
  })
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)
  const [okPassword, setOkPassword] = useState(false)
  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setOk(false)
    try {
      const data = await api.post('/perfil/', form) // POST /api/perfil/
      setUsuario(data.usuario)                       // actualiza el nombre del menú
      setForm({ ...form, password: '', telefono: data.usuario.telefono })
      setError(null)
      setOk(true)
    } catch (err) {
      setError(err)
    }
  }

  const campo = (name, label, type = 'text') => (
    <div className="mb-3">
      <label htmlFor={name} className="form-label small text-secondary">{label}</label>
      <input id={name} name={name} type={type} value={form[name]} onChange={cambiar}
        className={`form-control ${errorCampo(error, name) ? 'is-invalid' : ''}`} />
      <div className="invalid-feedback">{errorCampo(error, name)}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="h3 fw-bold mb-0">Mi perfil</h1>
      <p className="text-secondary">Actualiza tu foto, tus datos de contacto y tu contraseña</p>

      <FotoPerfil usuario={usuario} setUsuario={setUsuario} />

      {/* ---- Datos de contacto ---- */}
      <form className="card p-4 mb-4" onSubmit={handleSubmit}>
        <h2 className="h6 fw-bold mb-3">Datos de contacto</h2>
        {ok && <div className="alert alert-success py-2 small">Cambios guardados.</div>}
        <AlertaError mensaje={errorGeneral(error)} />
        <div className="row g-3">
          <div className="col-md-6">{campo('first_name', 'Nombre')}</div>
          <div className="col-md-6">{campo('last_name', 'Apellido')}</div>
        </div>
        {campo('telefono', 'Teléfono', 'tel')}
        {campo('email', 'Correo electrónico', 'email')}
        <div className="mb-4">
          <label htmlFor="password" className="form-label small text-secondary">Confirma tu contraseña actual para guardar</label>
          <input id="password" name="password" type="password" autoComplete="current-password"
            className={`form-control ${errorCampo(error, 'password') ? 'is-invalid' : ''}`}
            value={form.password} onChange={cambiar} />
          <div className="invalid-feedback">{errorCampo(error, 'password')}</div>
        </div>
        <button type="submit" className="btn btn-accent w-100 py-2" disabled={!form.password}>Guardar cambios</button>
      </form>

      {/* ---- Cambiar contraseña ---- */}
      <div className="card p-4" id="cambiar-password">
        <h2 className="h6 fw-bold mb-3">Actualizar contraseña</h2>
        {okPassword && <div className="alert alert-success py-2 small">Contraseña actualizada.</div>}
        <FormPassword textoBoton="Actualizar contraseña" alGuardar={() => setOkPassword(true)} />
      </div>
    </div>
  )
}
