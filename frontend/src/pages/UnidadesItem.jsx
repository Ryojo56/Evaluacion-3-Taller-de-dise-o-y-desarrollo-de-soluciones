import { useEffect, useMemo, useState } from 'react'
import { CButton } from '@coreui/react'
import TablaDatos from '../components/TablaDatos.jsx'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, errorGeneral } from '../api.js'
import { useApi } from '../useApi.js'
import { useDialogo } from '../components/Dialogo.jsx'
import { AlertaError, Cargando, EstadoBadge } from '../components/Estados.jsx'
import CodigoBarras from '../components/CodigoBarras.jsx'

const FILTROS = [
  ['', 'Todas'],
  ['Disponible', 'Disponibles'],
  ['Prestada', 'Prestadas'],
  ['De baja', 'De baja'],
]

export default function UnidadesItem() {
  const { sku } = useParams()
  const location = useLocation()
  const dialogo = useDialogo()
  const { data, cargando, error, recargar } = useApi(`/items/${sku}/unidades/`)
  const [filtro, setFiltro] = useState('')
  const [aviso, setAviso] = useState(location.state?.aviso || null)
  const [aImprimir, setAImprimir] = useState(null)

  useEffect(() => {
    if (!aImprimir) return
    const terminar = () => setAImprimir(null)
    window.addEventListener('afterprint', terminar)
    const t = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', terminar)
    }
  }, [aImprimir])

  const visibles = useMemo(
    () => (data?.unidades || []).filter((u) => !filtro || u.estado === filtro), [data, filtro])

  if (cargando && !data) return <Cargando />
  if (error) return <AlertaError mensaje={errorGeneral(error)} />

  const { item, unidades } = data
  const contar = (estado) => unidades.filter((u) => u.estado === estado).length
  const imprimibles = unidades.filter((u) => u.estado !== 'De baja')
  const etiquetas = aImprimir ? unidades.filter((u) => aImprimir.includes(u.codigo)) : imprimibles

  const cambiarEstado = async (u) => {
    const baja = u.estado === 'Disponible'
    const ok = await dialogo.confirmar({
      titulo: baja ? 'Dar de baja herramienta' : 'Reactivar herramienta',
      mensaje: baja
        ? <>La herramienta <strong>{u.codigo}</strong> dejará de estar disponible (pérdida, daño o retiro) y el stock de {u.bodega} · {u.espacio} bajará en 1.</>
        : <>La herramienta <strong>{u.codigo}</strong> vuelve a estar disponible en {u.bodega} · {u.espacio} y el stock sube en 1.</>,
      textoBoton: baja ? 'Dar de baja' : 'Reactivar',
      peligro: baja,
    })
    if (!ok) return
    try {
      await api.post(`/${baja ? 'bajaUnidad' : 'reactivarUnidad'}/${u.codigo}/`)
      setAviso(`${u.codigo} ${baja ? 'quedó dada de baja' : 'volvió a estar disponible'}.`)
      recargar()
    } catch (err) {
      dialogo.avisar({ titulo: 'No se pudo cambiar', mensaje: errorGeneral(err), tipo: 'danger' })
    }
  }

  return (
    <>
      <div className="no-imprimir">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
          <div>
            <h1 className="h3 fw-bold mb-0">{item.nombre}</h1>
            <p className="text-secondary mb-0">
              <span className="sku">{item.sku}</span> · Cada herramienta tiene su propio código de barras
            </p>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Link to={`/items/${sku}/editar`} className="btn btn-outline-secondary">Editar ítem</Link>
            <button className="btn btn-accent" onClick={() => setAImprimir(imprimibles.map((u) => u.codigo))}
              disabled={!imprimibles.length}>
              Imprimir etiquetas ({imprimibles.length})
            </button>
          </div>
        </div>

        {aviso && (
          <div className="alert alert-success py-2 small d-flex justify-content-between align-items-center">
            <span>{aviso}</span>
            <button type="button" className="btn-close btn-sm" aria-label="Cerrar" onClick={() => setAviso(null)}></button>
          </div>
        )}

        <div className="row g-2 mb-3">
          {[['Disponibles', contar('Disponible'), 'text-success'], ['Prestadas', contar('Prestada'), 'text-primary'],
            ['De baja', contar('De baja'), 'text-secondary'], ['Total', unidades.length, '']].map(([t, v, c]) => (
            <div className="col-6 col-md-3" key={t}>
              <div className="kpi"><div className="kpi-titulo">{t}</div><div className={`kpi-valor ${c}`}>{v}</div></div>
            </div>
          ))}
        </div>

        <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
          <div className="pills-filtro">
            {FILTROS.map(([v, t]) => (
              <button key={v || 'todas'} className={`btn ${filtro === v ? 'active' : ''}`} onClick={() => setFiltro(v)}>{t}</button>
            ))}
          </div>
        </div>

        <TablaDatos datos={visibles} titulo={`Códigos de ${item.nombre}`} archivo={`codigos-${item.sku}`}
          vacio="Esta herramienta todavía no tiene unidades. Agrega stock desde Editar ítem." columnas={[
            { titulo: 'Código de barras', dato: 'codigo',
              render: (v) => <div><CodigoBarras valor={v} alto={30} modulo={2} className="tamano-real" /><div className="sku small">{v}</div></div> },
            { titulo: 'Estado', dato: 'estado', render: (v) => <EstadoBadge estado={v} /> },
            { titulo: 'Bodega', dato: 'bodega' },
            { titulo: 'Lugar', dato: 'espacio' },
            { titulo: 'Prestada a', dato: 'prestada_a', texto: (u) => u.prestada_a || '—',
              render: (v, u) => (v ? <>{v} <span className="small text-body-secondary">· hasta {u.fecha_limite}</span></> : '—') },
            { titulo: 'Acciones', acciones: (u) => (
              <div className="d-inline-flex gap-1">
                {u.estado !== 'De baja' && <CButton size="sm" color="primary" variant="outline" onClick={() => setAImprimir([u.codigo])}>Imprimir</CButton>}
                {u.estado === 'Disponible' && <CButton size="sm" color="danger" variant="outline" onClick={() => cambiarEstado(u)}>Dar de baja</CButton>}
                {u.estado === 'De baja' && <CButton size="sm" color="success" variant="outline" onClick={() => cambiarEstado(u)}>Reactivar</CButton>}
              </div>
            ) },
          ]} />
        <p className="small text-secondary mt-2">
          Para agregar más herramientas, sube el stock desde <Link to={`/items/${sku}/editar`}>Editar ítem</Link>:
          se crea un código nuevo por cada unidad. Los códigos nunca se reutilizan.
        </p>
      </div>

      <div className="etiquetas-impresion" aria-hidden="true">
        {etiquetas.map((u) => (
          <div className="etiqueta" key={u.codigo}>
            <div className="etiqueta-nombre">{item.nombre}</div>
            <div className="etiqueta-categoria">{item.categoria}</div>
            <CodigoBarras valor={u.codigo} alto={56} modulo={2} />
            <div className="etiqueta-pie">{u.bodega} · {u.espacio}</div>
          </div>
        ))}
      </div>
    </>
  )
}
