import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

// Hook para CARGAR datos al abrir una página.
// Uso:  const { data, cargando, error, recargar } = useApi('/items/')
//
// [Rendimiento / carreras] Si la URL cambia rápido (ej. al escribir en un filtro), la
// petición anterior se CANCELA con AbortController. Antes una respuesta vieja que llegaba
// tarde podía pisar a la nueva y mostrar resultados que no correspondían al filtro.
export function useApi(url) {
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const actual = useRef(null)

  const recargar = useCallback(async () => {
    if (!url) return
    actual.current?.abort()
    const control = new AbortController()
    actual.current = control
    setCargando(true)
    try {
      const respuesta = await api.get(url, { signal: control.signal })
      if (control.signal.aborted) return
      setData(respuesta)
      setError(null)
    } catch (e) {
      if (control.signal.aborted || e?.name === 'AbortError') return
      setError(e)
    } finally {
      if (!control.signal.aborted) setCargando(false)
    }
  }, [url])

  useEffect(() => {
    recargar()
    return () => actual.current?.abort()
  }, [recargar])

  return { data, cargando, error, recargar }
}
