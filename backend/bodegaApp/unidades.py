import re

from django.db import transaction

from .models import Item, Prestamo, Stock, Unidad

# Formato de un código de herramienta: SKU + correlativo, ej. HRM-0001-003
PATRON_CODIGO = re.compile(r'^[A-Z0-9]{1,5}-\d{1,6}(-\d{1,4})?$')


def normalizar_codigo(texto):
    """[Validación] Lo que llega del lector de códigos o del teclado: sin espacios y en mayúsculas.
    Devuelve None si no tiene el formato de un SKU o de un código de herramienta."""
    codigo = str(texto or '').strip().upper()
    return codigo if len(codigo) <= 30 and PATRON_CODIGO.fullmatch(codigo) else None


def _siguiente_correlativo(item):
    """Mayor correlativo usado + 1. Antes se usaba count() + 1, que repetía códigos si dos
    personas creaban unidades a la vez (IntegrityError)."""
    usados = Unidad.objects.filter(item=item).values_list('codigo', flat=True)
    numeros = [int(c.rsplit('-', 1)[1]) for c in usados if c.rsplit('-', 1)[-1].isdigit()]
    return max(numeros, default=0) + 1


def crear_unidades(item, espacio, cantidad, estado='Disponible'):
    """Crea `cantidad` herramientas con código propio, ubicadas en el espacio indicado."""
    with transaction.atomic():
        # [Concurrencia] Bloquear el ítem serializa la numeración: nunca se repite un código
        Item.todos.select_for_update().get(pk=item.pk)
        inicio = _siguiente_correlativo(item)
        return [
            Unidad.objects.create(item=item, bodega_id=espacio.bodega_id, espacio=espacio, estado=estado,
                                  codigo=f'{item.sku}-{n:03d}')
            for n in range(inicio, inicio + cantidad)
        ]


def ajustar_unidades(item, espacio, cantidad):
    """Deja exactamente `cantidad` unidades Disponibles del ítem en ese espacio."""
    disponibles = Unidad.objects.select_for_update().filter(item=item, espacio=espacio, estado='Disponible')
    actual = disponibles.count()
    if cantidad > actual:
        crear_unidades(item, espacio, cantidad - actual)
    elif cantidad < actual:
        sobran = list(disponibles.order_by('-id').values_list('id', flat=True)[:actual - cantidad])
        Unidad.objects.filter(id__in=sobran).update(estado='De baja')


def generar_faltantes():
    for item in Item.objects.filter(tipo='herramienta'):
        for stock in Stock.objects.filter(item=item):
            ajustar_unidades(item, stock.espacio, stock.cantidad)
        for prestamo in Prestamo.objects.filter(item=item, fecha_devolucion__isnull=True):
            faltan = prestamo.cantidad - prestamo.unidades.count()
            if faltan > 0:
                prestamo.unidades.add(*crear_unidades(item, prestamo.bodega.espacio_por_defecto(), faltan, 'Prestada'))
