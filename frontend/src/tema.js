// ============================================================================
// [Tema] El tema por defecto es el CLARO. CoreUI, si no hay nada guardado, copia
// el tema del sistema operativo (por eso a veces partía oscuro). Aquí se fija
// "light" la primera vez; el usuario puede cambiarlo desde el encabezado.
// ============================================================================
export const CLAVE_TEMA = 'bodega-tema-v2'

export function iniciarTema() {
  try {
    if (!localStorage.getItem(CLAVE_TEMA)) localStorage.setItem(CLAVE_TEMA, 'light')
    const tema = localStorage.getItem(CLAVE_TEMA)
    const oscuro = tema === 'dark' || (tema === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.coreuiTheme = oscuro ? 'dark' : 'light'
  } catch {
    document.documentElement.dataset.coreuiTheme = 'light'
  }
}
