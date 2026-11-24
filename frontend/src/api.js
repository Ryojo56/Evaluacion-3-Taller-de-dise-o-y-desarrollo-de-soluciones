// ============================================================================
// api.js: el ÚNICO lugar donde React habla con Django.
// Uso:  const data = await api.get('/items/')
//       const data = await api.post('/addBodega/', { nombre: 'Bodega Sur' })
// ============================================================================

// Django guarda un token de seguridad en la cookie "csrftoken".
// Hay que devolverlo en cada POST, si no Django responde 403.
function leerCookie(nombre) {
  const fila = document.cookie.split('; ').find((c) => c.startsWith(nombre + '='))
  return fila ? decodeURIComponent(fila.split('=')[1]) : ''
}

async function pedir(url, opciones = {}) {
  const respuesta = await fetch('/api' + url, {
    credentials: 'same-origin', // envía la cookie de sesión
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': leerCookie('csrftoken'),
    },
    ...opciones,
  })

  const data = await respuesta.json().catch(() => ({}))

  if (respuesta.status === 401) {
    // La sesión expiró: avisamos a AuthContext para que mande al login
    window.dispatchEvent(new Event('sesion-expirada'))
  }
  if (!respuesta.ok) {
    // Lanzamos el error con lo que respondió Django: { error } o { errores: {campo: [...]} }
    throw { status: respuesta.status, ...data }
  }
  return data
}

export const api = {
  get: (url, opciones) => pedir(url, opciones),   // opciones.signal permite cancelar (AbortController)
  post: (url, datos) => pedir(url, { method: 'POST', body: JSON.stringify(datos || {}) }),
}

// ---- Ayudantes para mostrar errores -------------------------------------
// Error de un campo específico (para el texto rojo bajo el input)
export function errorCampo(error, campo) {
  return error?.errores?.[campo]?.join(' ') || ''
}

// Errores generales (para el cuadro rojo arriba del formulario)
export function errorGeneral(error) {
  if (!error) return ''
  if (error.error) return error.error
  if (error.errores?.__all__) return error.errores.__all__.join(' ')
  if (error.errores) return 'Revisa los campos marcados.'
  // [Diagnóstico] Si Django SÍ respondió pero no con JSON (ej. 403 de CSRF o 500), se dice
  // el código real en vez de culpar a la conexión.
  if (error.status === 403) return 'El servidor rechazó la solicitud (403). Recarga la página; si sigue, revisa CSRF_TRUSTED_ORIGINS en Django.'
  if (error.status >= 500) return `Error interno del servidor (${error.status}). Revisa la consola donde corre Django.`
  if (error.status) return `El servidor respondió con un error (${error.status}).`
  return 'No se pudo conectar con el servidor. ¿Está corriendo Django?'
}
