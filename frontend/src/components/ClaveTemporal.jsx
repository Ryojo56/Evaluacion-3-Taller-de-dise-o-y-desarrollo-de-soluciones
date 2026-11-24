import { useState } from 'react'

// Muestra una contraseña temporal con botón "Copiar" (se usa dentro de un modal)
export default function ClaveTemporal({ nombre, correo, clave }) {
  const [copiada, setCopiada] = useState(false)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(clave)
      setCopiada(true)
      setTimeout(() => setCopiada(false), 2000)
    } catch {
      // Si el navegador no deja copiar, al menos seleccionamos el texto
      document.getElementById('clave-temporal')?.select()
    }
  }

  return (
    <>
      <p className="mb-2">
        Contraseña temporal para <strong>{nombre}</strong>
        {correo && <span className="text-secondary"> ({correo})</span>}:
      </p>
      <div className="input-group mb-3">
        <input id="clave-temporal" className="form-control sku fs-5 text-dark bg-light text-center" value={clave} readOnly
          onFocus={(e) => e.target.select()} aria-label="Contraseña temporal" />
        <button type="button" className={`btn ${copiada ? 'btn-success' : 'btn-outline-secondary'}`} onClick={copiar}>
          {copiada ? '✓ Copiada' : 'Copiar'}
        </button>
      </div>
      <div className="alert alert-warning small mb-0">
        Entrégasela al usuario: deberá cambiarla al iniciar sesión.
        Por seguridad, <strong>no se volverá a mostrar</strong>.
      </div>
    </>
  )
}
