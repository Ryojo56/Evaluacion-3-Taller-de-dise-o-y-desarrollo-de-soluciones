"""
SERVICIO DE STOCK: el ÚNICO lugar donde se modifica Stock.cantidad.

El stock vive en ESPACIOS (estantes o áreas libres) dentro de cada bodega.

Reglas que garantiza este módulo:
  1. [Concurrencia] Toda fila de stock se BLOQUEA (SELECT ... FOR UPDATE) antes de leerla
     para modificarla. Si dos bodegueros descuentan el mismo producto a la vez, el segundo
     espera a que el primero termine y ve el saldo real (no hay "lost updates").
  2. [Stock negativo] Nunca se descuenta más de lo que hay: se lanza StockInsuficiente y
     la transacción completa se revierte (no quedan entregas a medias).
  3. [Capacidad] Los ingresos bloquean la fila del ESPACIO, así dos ingresos simultáneos
     no pueden superar juntos la capacidad del estante o del área.
  4. [Registro de movimientos] Cada cambio deja un MovimientoStock con usuario, motivo y saldo.

Todas las funciones deben llamarse dentro de transaction.atomic().
"""
from django.db import IntegrityError, connection, transaction
from django.db.models import Sum

from .models import Espacio, MovimientoStock, Stock


class StockInsuficiente(Exception):
    pass


class CapacidadExcedida(Exception):
    pass


class StockDesactualizado(Exception):
    """El stock cambió desde que el usuario abrió el formulario (control optimista)."""


def _exigir_transaccion():
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError('Las operaciones de stock deben ejecutarse dentro de transaction.atomic().')


def solo_esta_tabla(qs):
    if connection.features.has_select_for_update_of:
        return qs.select_for_update(of=('self',))
    return qs.select_related(None).select_for_update()


def _bloquear_espacios_compartido(ids):
    ids = sorted({i for i in ids if i})
    if not ids:
        return
    sufijo = {'mysql': ' LOCK IN SHARE MODE', 'postgresql': ' FOR SHARE'}.get(connection.vendor, '')
    marcas = ', '.join(['%s'] * len(ids))
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT id FROM {connection.ops.quote_name(Espacio._meta.db_table)} '
                       f'WHERE id IN ({marcas}) ORDER BY id{sufijo}', ids)


def bloquear_fila(item, espacio):
    """Devuelve la fila Stock(item, espacio) BLOQUEADA, creándola en 0 si no existe."""
    _exigir_transaccion()
    _bloquear_espacios_compartido([espacio.pk])
    fila = solo_esta_tabla(Stock.objects.select_related('espacio', 'bodega').filter(item=item, espacio=espacio)).first()
    if fila:
        return fila
    try:
        # Savepoint: si otro proceso la creó en este mismo instante, no se rompe la transacción
        with transaction.atomic():
            Stock.objects.create(item=item, espacio=espacio, cantidad=0)
    except IntegrityError:
        pass
    return solo_esta_tabla(Stock.objects.select_related('espacio', 'bodega')).get(item=item, espacio=espacio)


def bloquear_filas_item(item):
    """Bloquea TODAS las filas de stock del ítem, siempre en el mismo orden (evita deadlocks)."""
    _exigir_transaccion()
    _bloquear_espacios_compartido(Stock.objects.filter(item=item).values_list('espacio_id', flat=True))
    return list(solo_esta_tabla(Stock.objects.select_related('bodega', 'espacio').filter(item=item).order_by('id')))


def _verificar_capacidad(espacio, agregar):
    """Bloquea el espacio y verifica que quepan `agregar` unidades más."""
    if agregar <= 0:
        return
    espacio = solo_esta_tabla(Espacio.todos.select_related('bodega')).get(pk=espacio.pk)
    ocupado = Stock.objects.filter(espacio=espacio).aggregate(t=Sum('cantidad'))['t'] or 0
    libre = max(espacio.capacidad - ocupado, 0)
    if agregar > libre:
        raise CapacidadExcedida(f'{espacio.nombre} ({espacio.bodega.nombre}) solo tiene espacio para {libre} '
                                f'unidades más (capacidad {espacio.capacidad}).')


def _registrar(fila, tipo, delta, usuario, motivo='', **refs):
    return MovimientoStock.objects.create(
        tipo=tipo, item_id=fila.item_id, bodega_id=fila.bodega_id, espacio_id=fila.espacio_id, cantidad=delta,
        saldo=fila.cantidad, usuario=usuario if (usuario and usuario.is_authenticated) else None,
        motivo=motivo[:200], **refs,
    )


def mover(fila, delta, tipo, usuario, motivo='', verificar_capacidad=False, **refs):
    """Suma (delta > 0) o resta (delta < 0) sobre una fila YA BLOQUEADA y registra el movimiento."""
    if delta == 0:
        return fila
    if delta < 0 and fila.cantidad + delta < 0:
        raise StockInsuficiente(f'No hay stock suficiente de {fila.item.nombre} en {fila.espacio.nombre} '
                                f'({fila.bodega.nombre}): hay {fila.cantidad} y se necesitan {-delta}.')
    if verificar_capacidad:
        _verificar_capacidad(fila.espacio, delta)
    fila.cantidad += delta
    fila.save(update_fields=['cantidad'])
    _registrar(fila, tipo, delta, usuario, motivo, **refs)
    return fila


def sumar(item, espacio, cantidad, tipo, usuario, motivo='', verificar_capacidad=True, **refs):
    if verificar_capacidad:
        _verificar_capacidad(espacio, cantidad)   # primero el espacio, después el stock (orden fijo)
    return mover(bloquear_fila(item, espacio), cantidad, tipo, usuario, motivo, **refs)


def restar(item, espacio, cantidad, tipo, usuario, motivo='', **refs):
    return mover(bloquear_fila(item, espacio), -cantidad, tipo, usuario, motivo, **refs)


def fijar(item, espacio, nueva, usuario, esperado=None, motivo='Ajuste manual'):
    """
    Ajuste de inventario: deja el stock del espacio en `nueva`.
    [Control optimista] Si el formulario manda `esperado` (el stock que el usuario VIO al abrirlo)
    y ya no coincide, alguien entregó o recibió mientras tanto: se rechaza en vez de pisar el cambio.
    """
    if nueva < 0:
        raise StockInsuficiente('El stock no puede ser negativo.')
    Espacio.todos.select_for_update().get(pk=espacio.pk)   # orden fijo: espacio, luego stock
    fila = bloquear_fila(item, espacio)
    if esperado is not None and fila.cantidad != esperado:
        raise StockDesactualizado(
            f'El stock de {item.nombre} en {espacio.nombre} cambió mientras editabas: ahora hay {fila.cantidad} '
            f'(tú viste {esperado}). Revisa el valor y vuelve a guardar.')
    delta = nueva - fila.cantidad
    if delta > 0:
        _verificar_capacidad(espacio, delta)
    return mover(fila, delta, 'ajuste', usuario, motivo)


def trasladar(item, origen, destino, cantidad, usuario, motivo=''):
    """Mueve stock de un espacio a otro (puede ser de otra bodega). Todo o nada."""
    if origen.pk == destino.pk:
        raise StockInsuficiente('El origen y el destino son el mismo espacio.')
    # Orden fijo de bloqueo por id para que dos traslados cruzados no se bloqueen entre sí
    for e in sorted([origen, destino], key=lambda x: x.pk):
        Espacio.todos.select_for_update().get(pk=e.pk)
    texto = motivo or f'Traslado {origen} → {destino}'
    restar(item, origen, cantidad, 'traslado', usuario, texto)
    sumar(item, destino, cantidad, 'traslado', usuario, texto)
