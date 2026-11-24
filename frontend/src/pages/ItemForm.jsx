import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorCampo, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { AlertaError, Cargando } from '../components/Estados.jsx'
import { useToast } from '../components/Toasts.jsx'

// Sirve para crear (/items/nuevo) y para editar (/items/HRM-0001/editar)
export default function ItemForm() {
  const { sku } = useParams()
  const editando = Boolean(sku)
  const navigate = useNavigate()

  const { data: dataCat } = useApi('/categorias/')
  const { data: dataBod } = useApi('/bodegas/')
  // [Bodegas reales] estantes y áreas libres de todas las bodegas, con su espacio libre
  const { data: dataEsp } = useApi('/espacios/')
  const { data: dataItem, cargando, recargar: recargarItem } = useApi(editando ? `/items/${sku}/` : null)

  const [form, setForm] = useState({
    nombre: '', categoria: '', tipo: 'herramienta', unidad_medida: 'unidad', stock_minimo: 5, bodega: '', lugar: 'area',
    espacio: '', stock: 0,
  })
  const [error, setError] = useState(null)
  // [Doble envío] Mientras se guarda, el botón queda deshabilitado (antes un doble clic creaba dos ítems)
  const [enviando, setEnviando] = useState(false)
  // [Control optimista] Stock que el usuario VIO en la bodega elegida; Django rechaza (409) si cambió
  const [stockEsperado, setStockEsperado] = useState(null)
  const avisar = useToast()

  // Cuando llega el ítem desde Django, llenamos el formulario
  useEffect(() => {
    if (dataItem) {
      const i = dataItem.item
      setForm((f) => ({ ...f, nombre: i.nombre, categoria: i.categoria_id, tipo: i.tipo, unidad_medida: i.unidad_medida,
        stock_minimo: i.stock_minimo }))
    }
  }, [dataItem])

  // Stock que el ítem ya tiene en un espacio (al editar)
  const stockEn = (espacioId) =>
    dataItem?.item.ubicaciones.find((u) => String(u.espacio_id) === String(espacioId))?.cantidad || 0

  const cambiar = (e) => {
    const { name, value } = e.target
    const nuevo = { ...form, [name]: value }
    if (name === 'tipo' && value === 'herramienta') nuevo.unidad_medida = 'unidad'
    if (name === 'tipo') {
      const actual = categorias.find((c) => String(c.id) === String(form.categoria))
      if (actual && !admite(actual, value)) nuevo.categoria = ''
    }
    if (name === 'categoria' && nuevo.tipo === 'material') {
      const elegida = categorias.find((c) => String(c.id) === String(value))
      if (elegida?.unidad_medida) nuevo.unidad_medida = elegida.unidad_medida
    }
    // Cambiar de bodega o de tipo de lugar obliga a elegir de nuevo el estante/área
    if (name === 'bodega' || name === 'lugar') nuevo.espacio = ''
    // Al editar y elegir un espacio, mostramos el stock que ya tiene ahí
    if (name === 'espacio' || name === 'bodega' || name === 'lugar') {
      nuevo.stock = editando ? stockEn(nuevo.espacio) : nuevo.stock
      setStockEsperado(editando && nuevo.espacio ? nuevo.stock : null)
    }
    setForm(nuevo)
  }

  const categorias = dataCat?.categorias || []
  const admite = (c, tipo) => c.tipo === 'ambos' || c.tipo === tipo
  const categoriasTipo = categorias.filter((c) => admite(c, form.tipo))
  const simbolo = (dataCat?.unidades_medida || []).flatMap((g) => g.opciones)
    .find((o) => o.valor === form.unidad_medida)?.simbolo || 'unid.'

  const espaciosBodega = (dataEsp?.espacios || []).filter((x) => String(x.bodega_id) === String(form.bodega))
  const opcionesEspacio = espaciosBodega.filter((x) => x.tipo === (form.lugar === 'estante' ? 'estante' : 'area'))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (enviando) return
    const datos = { ...form, bodega: form.bodega || null, espacio: form.espacio || null, stock: Number(form.stock) }
    delete datos.lugar
    if (editando && form.espacio && stockEsperado !== null) datos.stock_esperado = stockEsperado
    setEnviando(true)
    try {
      const esHerramienta = form.tipo === 'herramienta'
      if (editando) {
        await api.post(`/editarItem/${sku}/`, datos)
        if (esHerramienta && form.espacio) {
          navigate(`/items/${sku}/unidades`, { state: { aviso: 'Stock actualizado: los códigos de barras quedaron al día.' } })
        } else {
          navigate('/catalogo')
        }
      } else {
        const r = await api.post('/addItem/', datos)
        if (esHerramienta && r.unidades_creadas) {
          navigate(`/items/${r.item.sku}/unidades`, {
            state: { aviso: `Se crearon ${r.unidades_creadas} códigos de barras, uno por herramienta. Imprímelos y pégalos en cada una.` },
          })
        } else {
          navigate('/catalogo')
        }
      }
      avisar(editando ? 'Cambios guardados.' : 'Ítem registrado.')
    } catch (err) {
      setError(err)
      if (err?.status === 409) {
        avisar(err.error, 'warning')
        recargarItem()   // trae el stock real para que el usuario decida con datos actuales
      }
      setEnviando(false)
    }
  }

  // Al recargar el ítem tras un conflicto, se muestra el stock real del espacio elegido
  useEffect(() => {
    if (dataItem && form.espacio) setStockEsperado(stockEn(form.espacio))
  }, [dataItem]) // eslint-disable-line react-hooks/exhaustive-deps

  if (editando && cargando) return <Cargando />

  const stockInvalido = Number(form.stock) < 0
  const claseCampo = (campo) => `form-control ${errorCampo(error, campo) ? 'is-invalid' : ''}`

  return (
    <div className="card p-3 p-sm-4 p-md-5" style={{ maxWidth: 640 }}>
      <h1 className="h4 fw-bold mb-4">Panel: {editando ? 'editar' : 'registrar'} ítem</h1>
      <AlertaError mensaje={errorGeneral(error)} />
      <form noValidate onSubmit={handleSubmit}>
        <div className="mb-3">
          <label htmlFor="nombre" className="form-label text-secondary">Nombre</label>
          <input type="text" id="nombre" name="nombre" className={claseCampo('nombre')}
            placeholder="Ej. Taladro percutor 1/2" value={form.nombre} onChange={cambiar} />
          <div className="invalid-feedback">{errorCampo(error, 'nombre')}</div>
        </div>
        <div className="mb-3">
          <label htmlFor="sku" className="form-label text-secondary">SKU (no editable)</label>
          <input type="text" id="sku" className="form-control sku bg-light"
            value={sku || 'Se generará automáticamente'} readOnly />
        </div>
        <div className="row g-3 mb-3">
          <div className="col-md-5">
            <label htmlFor="tipo" className="form-label text-secondary">Tipo</label>
            <select id="tipo" name="tipo" className={`form-select ${errorCampo(error, 'tipo') ? 'is-invalid' : ''}`}
              value={form.tipo} onChange={cambiar}>
              <option value="herramienta">Herramienta</option>
              <option value="material">Material</option>
            </select>
            <div className="invalid-feedback">{errorCampo(error, 'tipo')}</div>
          </div>
          <div className="col-md-7">
            <label htmlFor="categoria" className="form-label text-secondary">Categoría</label>
            <select id="categoria" name="categoria" className={`form-select ${errorCampo(error, 'categoria') ? 'is-invalid' : ''}`}
              value={form.categoria} onChange={cambiar}>
              <option value="">Selecciona...</option>
              {categoriasTipo.map((c) => (
                <option key={c.id} value={c.id}>{c.padre_id ? `\u00A0\u00A0\u00A0└ ${c.nombre}` : c.nombre}</option>
              ))}
            </select>
            <div className="invalid-feedback">{errorCampo(error, 'categoria')}</div>
          </div>
          <div className="col-md-7">
            <label htmlFor="unidad_medida" className="form-label text-secondary">Unidad de medida</label>
            <select id="unidad_medida" name="unidad_medida" disabled={form.tipo === 'herramienta'}
              className={`form-select ${errorCampo(error, 'unidad_medida') ? 'is-invalid' : ''}`}
              value={form.unidad_medida} onChange={cambiar}>
              {(dataCat?.unidades_medida || []).map((g) => (
                <optgroup key={g.grupo} label={g.grupo}>
                  {g.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto} ({o.simbolo})</option>)}
                </optgroup>
              ))}
            </select>
            <div className="invalid-feedback">{errorCampo(error, 'unidad_medida')}</div>
            <div className="form-text">
              {form.tipo === 'herramienta'
                ? 'Las herramientas se cuentan por unidad: cada una lleva su código de barras.'
                : 'Cómo se mide este material: por peso, largo, volumen o por unidades.'}
            </div>
          </div>
          <div className="col-md-5">
            <label htmlFor="stock_minimo" className="form-label text-secondary">Stock mínimo</label>
            <div className="input-group">
              <input type="number" id="stock_minimo" name="stock_minimo" min="0" className={claseCampo('stock_minimo')}
                value={form.stock_minimo} onChange={cambiar} />
              <span className="input-group-text">{simbolo}</span>
            </div>
          </div>
        </div>
        {/* [Bodegas reales] Dónde se guarda: bodega → estante o área libre → cuál */}
        <fieldset className="filtros-card mb-4">
          <legend className="h6 fw-semibold mb-2">{editando ? 'Ajustar stock en un lugar' : 'Dónde se guarda'}</legend>
          {editando && dataItem?.item.ubicaciones.length > 0 && (
            <div className="d-flex flex-wrap gap-1 mb-2 small">
              <span className="text-body-secondary">Hoy está en:</span>
              {dataItem.item.ubicaciones.map((u) => (
                <span key={u.espacio_id} className={`chip-ubicacion ${u.tipo_espacio}`}>{u.bodega} · {u.espacio} · <b>{u.cantidad}</b></span>
              ))}
            </div>
          )}
          <div className="row g-3">
            <div className="col-md-6">
              <label htmlFor="bodega" className="form-label">Bodega</label>
              <select id="bodega" name="bodega" className="form-select" value={form.bodega} onChange={cambiar}>
                <option value="">{editando ? 'No cambiar stock' : 'Selecciona...'}</option>
                {dataBod?.bodegas.map((b) => (
                  <option key={b.id} value={b.id}>{b.nombre} — {b.disponible.toLocaleString('es-CL')} u. libres</option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <span className="form-label d-block">Tipo de lugar</span>
              <div className="btn-group w-100" role="group" aria-label="Estante o área libre">
                {[['estante', 'Estante'], ['area', 'Área libre']].map(([v, t]) => (
                  <button key={v} type="button" disabled={!form.bodega}
                    className={`btn ${form.lugar === v ? 'btn-accent' : 'btn-outline-secondary'}`}
                    onClick={() => cambiar({ target: { name: 'lugar', value: v } })}>{t}</button>
                ))}
              </div>
            </div>
            <div className="col-md-7">
              <label htmlFor="espacio" className="form-label">{form.lugar === 'estante' ? 'Estante' : 'Área libre'}</label>
              <select id="espacio" name="espacio" disabled={!form.bodega}
                className={`form-select ${errorCampo(error, 'espacio') ? 'is-invalid' : ''}`} value={form.espacio} onChange={cambiar}>
                <option value="">{form.bodega ? (opcionesEspacio.length ? 'Selecciona...' : 'Esta bodega no tiene de este tipo') : 'Primero elige la bodega'}</option>
                {opcionesEspacio.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre} — {x.disponible} de {x.capacidad} libres{x.niveles ? ` · ${x.niveles} niveles` : ''}{x.area_m2 ? ` · ${x.area_m2} m²` : ''}
                  </option>
                ))}
              </select>
              <div className="invalid-feedback">{errorCampo(error, 'espacio')}</div>
            </div>
            <div className="col-md-5">
              <label htmlFor="stock" className="form-label">{editando ? 'Stock en ese lugar' : 'Stock inicial'}</label>
              <div className="input-group has-validation">
                <input type="number" id="stock" name="stock" disabled={!form.espacio} min="0" step="1"
                  inputMode="numeric"
                  className={`form-control ${stockInvalido || errorCampo(error, 'stock') ? 'is-invalid' : ''}`}
                  value={form.stock} onChange={cambiar} />
                <span className="input-group-text">{simbolo}</span>
                <div className="invalid-feedback">{errorCampo(error, 'stock') || 'El stock no puede ser negativo.'}</div>
              </div>
            </div>
          </div>
        </fieldset>
        {form.tipo === 'herramienta' && (
          <div className="alert alert-light border small mb-4">
            Cada herramienta recibe su propio <strong>código de barras</strong> ({sku || 'SKU'}-001, -002...).
            {editando
              ? ' Si subes el stock se crean códigos nuevos; si lo bajas, las últimas unidades disponibles quedan dadas de baja.'
              : ` Se crearán ${Math.max(Number(form.stock) || 0, 0)} códigos al guardar.`}
            {editando && <> <Link to={`/items/${sku}/unidades`}>Ver e imprimir códigos</Link></>}
          </div>
        )}
        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-accent flex-fill py-2" disabled={stockInvalido || enviando}>
            {enviando ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button type="button" className="btn btn-outline-secondary flex-fill py-2" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
