import { useState } from 'react'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import Modal from './Modal.jsx'
import { AlertaError, Cargando } from './Estados.jsx'

export default function EntregaHerramienta({ solicitud, onCerrar, onEntregada }) {
  const { data, cargando, error } = useApi(`/items/${solicitud.sku}/unidades/?estado=Disponible`)
  const [seleccion, setSeleccion] = useState([])
  const [entrada, setEntrada] = useState('')
  const [mensaje, setMensaje] = useState(null)
  const [errorEnvio, setErrorEnvio] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const disponibles = data?.unidades || []
  const completa = seleccion.length === solicitud.cantidad

  const quitar = (codigo) => {
    setMensaje(null)
    setSeleccion((s) => s.filter((c) => c !== codigo))
  }

  const escanear = async (e) => {
    e.preventDefault()
    const codigo = entrada.trim().toUpperCase()
    setEntrada('')
    if (!codigo) return
    if (seleccion.includes(codigo)) {
      setMensaje({ tipo: 'warning', texto: `${codigo} ya está en la entrega.` })
      return
    }
    if (disponibles.some((u) => u.codigo === codigo)) {
      if (completa) {
        setMensaje({ tipo: 'warning', texto: `Ya elegiste las ${solicitud.cantidad} herramienta(s) de esta solicitud.` })
        return
      }
      setSeleccion((s) => [...s, codigo])
      setMensaje({ tipo: 'success', texto: `${codigo} agregada.` })
      return
    }
    try {
      const { unidad } = await api.get(`/unidades/${encodeURIComponent(codigo)}/`)
      const motivo = unidad.sku !== solicitud.sku
        ? `es un(a) ${unidad.item}, no un(a) ${solicitud.producto}`
        : unidad.estado === 'Prestada' ? `está prestada a ${unidad.prestada_a}` : `está ${unidad.estado.toLowerCase()}`
      setMensaje({ tipo: 'danger', texto: `${codigo} no se puede entregar: ${motivo}.` })
    } catch (err) {
      setMensaje({ tipo: 'danger', texto: errorGeneral(err) })
    }
  }

  const entregar = async () => {
    setEnviando(true)
    try {
      await api.post(`/entregarSolicitud/${solicitud.id}/`, { unidades: seleccion })
      onEntregada()
    } catch (err) {
      setErrorEnvio(err)
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Entregar ${solicitud.producto}`} onCerrar={onCerrar} tamano="lg">
      <div className="modal-body">
        <p className="small text-secondary mb-3">
          {solicitud.trabajador} pidió <strong>{solicitud.cantidad}</strong>. Escanea el código de barras de cada herramienta
          que entregas.
        </p>
        <form onSubmit={escanear} className="mb-2">
          <label htmlFor="escaner" className="form-label small text-secondary">Escanear código de barras</label>
          <div className="input-group">
            <input id="escaner" className="form-control sku" autoComplete="off" placeholder={`${solicitud.sku}-001`}
              value={entrada} onChange={(e) => setEntrada(e.target.value)} data-autofocus="" />
            <button type="submit" className="btn btn-outline-secondary">Agregar</button>
          </div>
        </form>
        {mensaje && <div className={`alert alert-${mensaje.tipo} py-2 small`} role="status">{mensaje.texto}</div>}
        <AlertaError mensaje={errorEnvio && errorGeneral(errorEnvio)} />

        {cargando && !data && <Cargando />}
        <AlertaError mensaje={error && errorGeneral(error)} />
        {data && disponibles.length === 0 && (
          <div className="alert alert-warning py-2 small">No hay unidades disponibles de esta herramienta.</div>
        )}
        <div className="lista-unidades">
          {seleccion.map((codigo) => (
            <div key={codigo} className="unidad-opcion marcada">
              <span className="text-success fw-bold">✓</span>
              <span className="sku fw-semibold text-dark">{codigo}</span>
              <span className="small text-secondary">{disponibles.find((u) => u.codigo === codigo)?.bodega}</span>
              <button type="button" className="btn btn-link btn-sm link-danger p-0 ms-auto" onClick={() => quitar(codigo)}>Quitar</button>
            </div>
          ))}
        </div>
        {data && disponibles.length > 0 && !completa && (
          <p className="small text-secondary mt-2 mb-0">
            Disponibles en bodega: {disponibles.filter((u) => !seleccion.includes(u.codigo)).length} unidad(es).
          </p>
        )}
      </div>
      <div className="modal-footer">
        <span className={`me-auto small ${completa ? 'text-success fw-semibold' : 'text-secondary'}`}>
          {seleccion.length} de {solicitud.cantidad} escaneada(s)
        </span>
        <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-accent" onClick={entregar} disabled={!completa || enviando}>
          {enviando ? 'Entregando...' : 'Confirmar entrega'}
        </button>
      </div>
    </Modal>
  )
}
