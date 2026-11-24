import { Link } from 'react-router-dom'

export default function AvisoHistorial({ data, que }) {
  if (!data || !(data.total_historial > data.limite_historial)) return null
  return (
    <p className="small text-body-secondary mb-2">
      Se muestran todos los pendientes y las {data.limite_historial.toLocaleString('es-CL')} {que} cerradas más recientes
      (de {data.total_historial.toLocaleString('es-CL')}). El historial completo está en <Link to="/reportes">Reportes</Link>.
    </p>
  )
}
