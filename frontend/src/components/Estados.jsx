// Componentes pequeños reutilizables

const colores = {
  'Disponible': 'success',
  'Bueno': 'success',
  'Despachada': 'success',
  'Stock bajo': 'warning',
  'Regular': 'warning',
  'Crítico': 'danger',
  'Con falla': 'danger',
  'Pendiente': 'primary',
  'En préstamo': 'primary',
  'Sin stock': 'secondary',
  'Prestada': 'primary',
  'Por recibir': 'info',
  'De baja': 'secondary',
  'Cancelada': 'danger',
  'Anulado': 'secondary',
}

// Badge de colores para los estados
export function EstadoBadge({ estado }) {
  const c = colores[estado] || 'secondary'
  return <span className={`badge bg-${c}-subtle text-${c}-emphasis`}>{estado}</span>
}

// Mensaje mientras se cargan los datos
export function Cargando() {
  return <div className="text-secondary py-4">Cargando...</div>
}

// Cuadro rojo con el error general
export function AlertaError({ mensaje }) {
  if (!mensaje) return null
  return <div className="alert alert-danger py-2 small">{mensaje}</div>
}
