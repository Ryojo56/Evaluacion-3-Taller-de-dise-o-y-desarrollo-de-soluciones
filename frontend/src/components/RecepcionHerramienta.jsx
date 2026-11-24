import { useState } from 'react'
import { api, errorCampo, errorGeneral } from '../api.js'
import Modal from './Modal.jsx'
import { AlertaError, EstadoBadge } from './Estados.jsx'

const ESTADOS = [['Bueno', 'success'], ['Regular', 'warning'], ['Con falla', 'danger']]

export default function RecepcionHerramienta({ prestamo, onCerrar, onRecibida }) {
  const [escaneados, setEscaneados] = useState([])
  const [entrada, setEntrada] = useState('')
  const [mensaje, setMensaje] = useState(null)
  const [estado, setEstado] = useState('Bueno')
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const esperados = prestamo.unidades
  const completa = escaneados.length === esperados.length
  const faltaComentario = !prestamo.por_recibir && comentario.trim().length < 2
  const conFalla = (prestamo.por_recibir ? prestamo.estado_devolucion : estado) === 'Con falla'

  const escanear = (e) => {
    e.preventDefault()
    const codigo = entrada.trim().toUpperCase()
    setEntrada('')
    if (!codigo) return
    if (escaneados.includes(codigo)) {
      setMensaje({ tipo: 'warning', texto: `${codigo} ya estaba escaneada.` })
    } else if (esperados.includes(codigo)) {
      setEscaneados((s) => [...s, codigo])
      setMensaje({ tipo: 'success', texto: `${codigo} recibida.` })
    } else {
      setMensaje({ tipo: 'danger', texto: `${codigo} no pertenece a este préstamo.` })
    }
  }

  const recibir = async () => {
    setEnviando(true)
    const datos = { unidades: escaneados }
    if (!prestamo.por_recibir) Object.assign(datos, { estado_devolucion: estado, comentario: comentario.trim() })
    try {
      await api.post(`/recibirPrestamo/${prestamo.id}/`, datos)
      onRecibida()
    } catch (err) {
      setError(err)
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Recibir ${prestamo.herramienta}`} onCerrar={onCerrar} tamano="lg">
      <div className="modal-body">
        <p className="small text-secondary mb-3">
          Devuelve <strong>{prestamo.trabajador}</strong>. Escanea el código de barras de cada herramienta que recibes.
        </p>
        <form onSubmit={escanear} className="mb-2">
          <label htmlFor="escaner-recepcion" className="form-label small text-secondary">Escanear código de barras</label>
          <div className="input-group">
            <input id="escaner-recepcion" className="form-control sku" autoComplete="off" placeholder={esperados[0] || ''}
              value={entrada} onChange={(e) => setEntrada(e.target.value)} data-autofocus="" />
            <button type="submit" className="btn btn-outline-secondary">Agregar</button>
          </div>
        </form>
        {mensaje && <div className={`alert alert-${mensaje.tipo} py-2 small`} role="status">{mensaje.texto}</div>}
        <AlertaError mensaje={errorGeneral(error)} />

        <div className="lista-unidades mb-3">
          {esperados.map((codigo) => {
            const lista = escaneados.includes(codigo)
            return (
              <div key={codigo} className={`unidad-opcion ${lista ? 'marcada' : ''}`}>
                <span className={lista ? 'text-success fw-bold' : 'text-secondary'}>{lista ? '✓' : '○'}</span>
                <span className="sku fw-semibold text-dark">{codigo}</span>
                <span className="small text-secondary ms-auto">{lista ? 'Recibida' : 'Falta escanear'}</span>
              </div>
            )
          })}
        </div>

        {prestamo.por_recibir ? (
          <div className="bg-light rounded-3 p-3 small">
            <div className="mb-1">Comentario del trabajador · <EstadoBadge estado={prestamo.estado_devolucion} /></div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{prestamo.comentario}</div>
          </div>
        ) : (
          <>
            <p className="small text-secondary mb-2">El trabajador no dejó comentario: indica en qué estado llega la herramienta.</p>
            <div className="row g-2 mb-2">
              {ESTADOS.map(([valor, color]) => (
                <div className="col-4" key={valor}>
                  <input type="radio" className="btn-check" name="estado-recepcion" id={`rec-${valor}`}
                    checked={estado === valor} onChange={() => setEstado(valor)} />
                  <label className={`btn btn-outline-${color} btn-sm w-100`} htmlFor={`rec-${valor}`}>{valor}</label>
                </div>
              ))}
            </div>
            <textarea rows="2" maxLength={2500} aria-label="Comentario de la recepción"
              className={`form-control ${errorCampo(error, 'comentario') ? 'is-invalid' : ''}`}
              placeholder="Comentario sobre el estado de la herramienta"
              value={comentario} onChange={(e) => setComentario(e.target.value)}></textarea>
            <div className="invalid-feedback">{errorCampo(error, 'comentario')}</div>
          </>
        )}
        {conFalla && (
          <div className="alert alert-warning py-2 small mt-3 mb-0" role="status">
            Llega con falla: la herramienta quedará <strong>de baja</strong> y no vuelve al stock disponible.
            Cuando esté reparada, reactívala desde sus códigos.
          </div>
        )}
      </div>
      <div className="modal-footer">
        <span className={`me-auto small ${completa ? 'text-success fw-semibold' : 'text-secondary'}`}>
          {escaneados.length} de {esperados.length} escaneada(s)
        </span>
        <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-accent" onClick={recibir} disabled={!completa || faltaComentario || enviando}>
          {enviando ? 'Recibiendo...' : 'Confirmar recepción'}
        </button>
      </div>
    </Modal>
  )
}
