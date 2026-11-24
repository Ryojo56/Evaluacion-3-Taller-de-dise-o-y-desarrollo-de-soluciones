import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import Modal from './Modal.jsx'
import { AlertaError } from './Estados.jsx'
import { errorCampo, errorGeneral } from '../api.js'

// ============================================================================
// Diálogos con modales. Reemplazan a confirm(), alert() y prompt() del navegador.
//
//   const dialogo = useDialogo()
//
//   if (await dialogo.confirmar({ titulo, mensaje, textoBoton, peligro })) { ... }
//   await dialogo.avisar({ titulo, mensaje, tipo: 'success' | 'danger' | 'warning' })
//   await dialogo.formulario({ titulo, campos: [...], textoBoton, alGuardar: async (valores) => {...} })
//
// En "formulario", si alGuardar lanza el error de Django, el modal NO se cierra
// y muestra el mensaje bajo el campo correspondiente.
// ============================================================================
const DialogoContext = createContext(null)

export function DialogoProvider({ children }) {
  const [actual, setActual] = useState(null) // { id, tipo, opciones, responder }

  const abrir = useCallback(
    (tipo, opciones) =>
      new Promise((responder) => setActual({ id: Date.now(), tipo, opciones, responder })),
    []
  )

  const dialogo = useMemo(() => ({
    confirmar: (opciones) => abrir('confirmar', opciones),
    avisar: (opciones) => abrir('avisar', opciones),
    formulario: (opciones) => abrir('formulario', opciones),
  }), [abrir])

  const cerrar = (valor) => {
    actual?.responder(valor)
    setActual(null)
  }

  const Componente = actual && { confirmar: Confirmar, avisar: Avisar, formulario: Formulario }[actual.tipo]

  return (
    <DialogoContext.Provider value={dialogo}>
      {children}
      {Componente && <Componente key={actual.id} {...actual.opciones} responder={cerrar} />}
    </DialogoContext.Provider>
  )
}

export const useDialogo = () => useContext(DialogoContext)

// ---- ¿Seguro? (Aceptar / Cancelar) -----------------------------------------
function Confirmar({ titulo = '¿Estás seguro?', mensaje, textoBoton = 'Aceptar', peligro = false, responder }) {
  return (
    <Modal titulo={titulo} onCerrar={() => responder(false)}>
      <div className="modal-body">{mensaje}</div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-secondary" onClick={() => responder(false)}>Cancelar</button>
        <button type="button" className={`btn ${peligro ? 'btn-danger' : 'btn-accent'}`} onClick={() => responder(true)}>
          {textoBoton}
        </button>
      </div>
    </Modal>
  )
}

// ---- Aviso (solo "Entendido") ----------------------------------------------
const ICONOS = { success: '✓', danger: '!', warning: '!', info: 'i' }

function Avisar({ titulo, mensaje, contenido, tipo = 'info', textoBoton = 'Entendido', responder }) {
  return (
    <Modal titulo={titulo} onCerrar={() => responder()}>
      <div className="modal-body">
        {mensaje && (
          <div className="d-flex gap-3 align-items-start">
            <span className={`icono-aviso bg-${tipo}-subtle text-${tipo}-emphasis`}>{ICONOS[tipo]}</span>
            <div className="pt-1">{mensaje}</div>
          </div>
        )}
        {contenido}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-accent" onClick={() => responder()}>{textoBoton}</button>
      </div>
    </Modal>
  )
}

// ---- Formulario (reemplaza a prompt) ---------------------------------------
function Formulario({ titulo, campos, textoBoton = 'Guardar', alGuardar, responder }) {
  const [valores, setValores] = useState(() =>
    Object.fromEntries(campos.map((c) => [c.name, c.valor ?? '']))
  )
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const cambiar = (campo) => (e) => {
    const valor = campo.mayusculas ? e.target.value.toUpperCase() : e.target.value
    setValores({ ...valores, [campo.name]: valor })
  }

  const enviar = async (e) => {
    e.preventDefault()
    setEnviando(true)
    try {
      const resultado = await alGuardar(valores)
      responder(resultado ?? true)
    } catch (err) {
      setError(err) // se queda abierto mostrando el error
      setEnviando(false)
    }
  }

  // Si el error es de un campo, va bajo el campo; si no, arriba
  const general = error && Object.keys(error.errores || {}).every((k) => !campos.some((c) => c.name === k))
    ? errorGeneral(error) : ''

  return (
    <Modal titulo={titulo} onCerrar={() => responder(null)} cerrable={!enviando}>
      <form onSubmit={enviar} noValidate>
        <div className="modal-body">
          <AlertaError mensaje={general} />
          <div className="row g-3">
            {campos.map((c, i) => {
              const props = {
                id: `dlg-${c.name}`,
                className: `form-control ${errorCampo(error, c.name) ? 'is-invalid' : ''}`,
                value: valores[c.name], onChange: cambiar(c), placeholder: c.placeholder,
                maxLength: c.maxLength, 'data-autofocus': i === 0 ? '' : undefined,
              }
              return (
                <div className={c.columna || 'col-12'} key={c.name}>
                  <label htmlFor={`dlg-${c.name}`} className="form-label small text-secondary">{c.label}</label>
                  {c.tipo === 'textarea' ? (
                    <textarea rows={c.filas || 2} {...props} />
                  ) : c.tipo === 'select' ? (
                    // Lista desplegable: opciones = [[valor, texto], ...] o grupos {Grupo: [[valor, texto]]}
                    <select {...props} className={`form-select ${errorCampo(error, c.name) ? 'is-invalid' : ''}`}>
                      <option value="">{c.placeholder || 'Selecciona...'}</option>
                      {Array.isArray(c.opciones)
                        ? c.opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)
                        : Object.entries(c.opciones || {}).map(([grupo, lista]) => (
                          <optgroup key={grupo} label={grupo}>
                            {lista.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                          </optgroup>
                        ))}
                    </select>
                  ) : c.sufijo ? (
                    <div className="input-group has-validation">
                      <input type={c.tipo || 'text'} min={c.min} max={c.max} {...props} />
                      <span className="input-group-text">{c.sufijo}</span>
                      <div className="invalid-feedback">{errorCampo(error, c.name)}</div>
                    </div>
                  ) : (
                    <input type={c.tipo || 'text'} min={c.min} max={c.max} {...props} />
                  )}
                  {!c.sufijo && <div className="invalid-feedback">{errorCampo(error, c.name)}</div>}
                  {c.ayuda && <div className="form-text">{c.ayuda}</div>}
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={() => responder(null)} disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-accent" disabled={enviando}>
            {enviando ? 'Guardando...' : textoBoton}
          </button>
        </div>
      </form>
    </Modal>
  )
}
