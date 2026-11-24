import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CBadge, CButton, CCard, CCardBody, CCardHeader, CCol, CFormInput, CRow } from '@coreui/react'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useDialogo } from '../components/Dialogo.jsx'
import { Cargando, AlertaError } from '../components/Estados.jsx'

const SECCIONES = [
  { tipo: 'herramienta', titulo: 'Herramientas', texto: 'Se prestan y vuelven a bodega', color: 'info' },
  { tipo: 'material', titulo: 'Materiales', texto: 'Se entregan y se consumen', color: 'success' },
  { tipo: 'ambos', titulo: 'Herramientas y materiales', texto: 'Aceptan los dos tipos', color: 'warning' },
]
const COLOR_TIPO = Object.fromEntries(SECCIONES.map((s) => [s.tipo, s.color]))

export default function Categorias() {
  const { usuario } = useAuth()
  const dialogo = useDialogo()
  const puedeGestionar = ['admin', 'bodeguero'].includes(usuario.rol)
  const { data, cargando, error, recargar } = useApi('/categorias/') // GET /api/categorias/
  const navigate = useNavigate()
  const [buscar, setBuscar] = useState('')
  const [seccion, setSeccion] = useState('')

  const categorias = useMemo(() => data?.categorias || [], [data])
  const principales = categorias.filter((c) => !c.padre_id)
  const opcionesUnidad = Object.fromEntries((data?.unidades_medida || []).map((g) => [
    g.grupo, g.opciones.map((o) => [o.valor, `${o.texto} (${o.simbolo})`]),
  ]))

  const campos = (c = {}, padreFijo = null) => [
    { name: 'nombre', label: 'Nombre', valor: c.nombre, placeholder: 'Ej. Herramientas manuales', maxLength: 50 },
    ...(c.id ? [] : [{ name: 'prefijo', label: 'Prefijo para los SKU', placeholder: 'Ej. HMA', maxLength: 3, mayusculas: true,
      columna: 'col-sm-5', ayuda: '3 letras: los ítems tendrán códigos como HMA-0001.' }]),
    { name: 'padre', label: 'Dentro de', tipo: 'select', valor: padreFijo?.id ?? c.padre_id ?? '',
      placeholder: 'Ninguna (categoría principal)', columna: c.id ? 'col-12' : 'col-sm-7',
      opciones: principales.filter((p) => p.id !== c.id).map((p) => [p.id, p.nombre]),
      ayuda: 'Elige una categoría principal para crear una subcategoría.' },
    { name: 'tipo', label: 'Qué guarda', tipo: 'select', valor: c.tipo && c.tipo !== 'ambos' ? c.tipo : (padreFijo?.tipo !== 'ambos' ? padreFijo?.tipo || '' : ''),
      placeholder: 'Herramientas y materiales', columna: 'col-sm-6',
      opciones: [['herramienta', 'Solo herramientas'], ['material', 'Solo materiales']] },
    { name: 'unidad_medida', label: 'Unidad por defecto', tipo: 'select', valor: c.unidad_medida || padreFijo?.unidad_medida || '',
      placeholder: 'Sin unidad por defecto', columna: 'col-sm-6', opciones: opcionesUnidad,
      ayuda: 'Los materiales nuevos de esta categoría toman esta unidad.' },
  ]

  const preparar = (v) => ({ ...v, padre: v.padre || null, tipo: v.tipo || 'ambos' })

  const nueva = (padre = null) =>
    dialogo.formulario({
      titulo: padre ? `Nueva subcategoría de ${padre.nombre}` : 'Nueva categoría',
      campos: campos({}, padre),
      textoBoton: padre ? 'Crear subcategoría' : 'Crear categoría',
      alGuardar: async (valores) => { await api.post('/addCategoria/', preparar(valores)); recargar() },
    })

  const editar = (c) =>
    dialogo.formulario({
      titulo: `Editar ${c.padre_id ? 'subcategoría' : 'categoría'}`,
      campos: campos(c),
      textoBoton: 'Guardar cambios',
      alGuardar: async (valores) => { await api.post(`/editarCategoria/${c.id}/`, preparar(valores)); recargar() },
    })

  const eliminar = async (c) => {
    if (c.productos > 0 || c.subcategorias > 0) {
      return dialogo.avisar({
        titulo: 'No se puede eliminar',
        mensaje: c.productos > 0
          ? <><strong>{c.nombre}</strong> tiene {c.productos} producto(s) asociados. Muévelos a otra categoría primero.</>
          : <><strong>{c.nombre}</strong> tiene {c.subcategorias} subcategoría(s). Elimínalas o muévelas primero.</>,
        tipo: 'warning',
      })
    }
    const ok = await dialogo.confirmar({
      titulo: 'Eliminar categoría',
      mensaje: <>¿Eliminar <strong>{c.nombre}</strong>? Queda en la Papelera y el administrador puede restaurarla.</>,
      textoBoton: 'Eliminar',
      peligro: true,
    })
    if (!ok) return
    try {
      await api.post(`/deleteCategoria/${c.id}/`)
      recargar()
    } catch (err) {
      dialogo.avisar({ titulo: 'No se pudo eliminar', mensaje: errorGeneral(err), tipo: 'danger' })
    }
  }

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const texto = buscar.trim().toLowerCase()
  const hijasDe = (p) => categorias.filter((c) => c.padre_id === p.id)
  const coincide = (c) => !texto || `${c.nombre} ${c.prefijo}`.toLowerCase().includes(texto)
  const visibles = (tipo) => principales.filter((p) => p.tipo === tipo && (coincide(p) || hijasDe(p).some(coincide)))
  const totalProductos = (p) => p.productos + hijasDe(p).reduce((t, h) => t + h.productos, 0)

  const acciones = (c, principal) => (
    <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
      <CButton size="sm" color="primary" variant="ghost" onClick={() => navigate(`/catalogo?categoria=${c.id}`)}>Ver ítems</CButton>
      {puedeGestionar && principal && <CButton size="sm" color="success" variant="ghost" onClick={() => nueva(c)}>+ Subcategoría</CButton>}
      {puedeGestionar && <CButton size="sm" color="secondary" variant="ghost" onClick={() => editar(c)}>Editar</CButton>}
      {puedeGestionar && <CButton size="sm" color="danger" variant="ghost" onClick={() => eliminar(c)}>Eliminar</CButton>}
    </div>
  )

  const unidad = (c) => c.unidad && <CBadge color="light" textColor="dark" className="border">{c.unidad}</CBadge>

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-start mb-3">
        <div>
          <h1 className="h3 fw-bold mb-0">Categorías</h1>
          <p className="text-body-secondary mb-0">
            {principales.length} categorías principales y {categorias.length - principales.length} subcategorías
          </p>
        </div>
        {puedeGestionar && <button className="btn btn-crear boton-movil-ancho" onClick={() => nueva()}>+ Nueva categoría</button>}
      </div>

      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div className="pills-filtro">
          {[{ tipo: '', titulo: 'Todas' }, ...SECCIONES].map((s) => (
            <button key={s.tipo} type="button" className={`btn ${seccion === s.tipo ? 'active' : ''}`}
              onClick={() => setSeccion(s.tipo)}>
              {s.titulo} <span className="badge rounded-pill bg-secondary-subtle text-secondary-emphasis ms-1">
                {s.tipo ? principales.filter((p) => p.tipo === s.tipo).length : principales.length}
              </span>
            </button>
          ))}
        </div>
        <CFormInput className="ms-auto" style={{ maxWidth: 260 }} placeholder="Buscar categoría o prefijo"
          value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar categoría" />
      </div>

      {SECCIONES.filter((s) => !seccion || s.tipo === seccion).map((s) => {
        const lista = visibles(s.tipo)
        if (!lista.length) return null
        return (
          <section key={s.tipo} className="mb-4">
            <h2 className="h6 fw-bold text-uppercase d-flex align-items-center gap-2 mb-2">
              <span className={`punto-tipo bg-${s.color}`} />{s.titulo}
              <span className="fw-normal text-body-secondary text-lowercase small">· {s.texto}</span>
            </h2>
            <CRow className="g-3">
              {lista.map((p) => {
                const hijas = hijasDe(p)
                return (
                  <CCol key={p.id} lg={6} xxl={4}>
                    <CCard className={`h-100 tarjeta-categoria borde-${s.color}`}>
                      <CCardHeader className="bg-transparent d-flex flex-wrap gap-2 align-items-center">
                        <span className="fw-bold">{p.nombre}</span>
                        <CBadge color="warning" className="sku text-dark">{p.prefijo}</CBadge>
                        {unidad(p)}
                        <span className="ms-auto small text-body-secondary">{totalProductos(p)} productos</span>
                      </CCardHeader>
                      <CCardBody className="p-2">
                        <div className="d-flex justify-content-end mb-1">{acciones(p, true)}</div>
                        {hijas.length ? (
                          <ul className="list-unstyled mb-0 lista-subcategorias">
                            {hijas.map((h) => (
                              <li key={h.id} className={`d-flex flex-wrap align-items-center gap-2 ${coincide(h) ? '' : 'opacity-50'}`}>
                                <span className="text-body-secondary">└</span>
                                <span className="fw-semibold">{h.nombre}</span>
                                <CBadge color={COLOR_TIPO[h.tipo]} shape="rounded-pill" className="sku text-white">{h.prefijo}</CBadge>
                                {unidad(h)}
                                <span className="small text-body-secondary">{h.productos} prod.</span>
                                <span className="ms-auto">{acciones(h, false)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="small text-body-secondary mb-0 px-2">Sin subcategorías.</p>}
                      </CCardBody>
                    </CCard>
                  </CCol>
                )
              })}
            </CRow>
          </section>
        )
      })}
      {!SECCIONES.some((s) => (!seccion || s.tipo === seccion) && visibles(s.tipo).length) && (
        <p className="text-body-secondary">No hay categorías que coincidan.</p>
      )}
    </>
  )
}
