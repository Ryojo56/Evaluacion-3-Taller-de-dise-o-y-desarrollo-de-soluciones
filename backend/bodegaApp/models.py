from datetime import timedelta

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Case, F, Q, Value, When
from django.utils import timezone


# ===========================================================================
# [Soft delete] Borrado lógico: el registro queda en la base (para no perder el
# historial de préstamos y solicitudes), pero deja de aparecer en la aplicación.
# ===========================================================================
class VivosManager(models.Manager):
    """Manager por defecto: oculta lo eliminado. Para verlo todo: Modelo.todos."""

    def get_queryset(self):
        return super().get_queryset().filter(eliminado_en__isnull=True)


class SoftDeleteModel(models.Model):
    eliminado_en = models.DateTimeField(null=True, blank=True, db_index=True, editable=False)
    eliminado_por = models.ForeignKey('bodegaApp.Usuario', null=True, blank=True, on_delete=models.SET_NULL,
                                      related_name='+', editable=False)

    objects = VivosManager()
    todos = models.Manager()

    # MySQL no permite UNIQUE condicional: al eliminar se libera el nombre único agregándole
    # un sufijo, para poder volver a crear una bodega/categoría con el mismo nombre.
    CAMPO_NOMBRE_UNICO = None

    class Meta:
        abstract = True

    def eliminar(self, usuario=None):
        self.eliminado_en = timezone.now()
        self.eliminado_por = usuario
        campos = ['eliminado_en', 'eliminado_por']
        if self.CAMPO_NOMBRE_UNICO:
            largo = self._meta.get_field(self.CAMPO_NOMBRE_UNICO).max_length
            sufijo = f' ·eliminado {self.pk}'
            valor = getattr(self, self.CAMPO_NOMBRE_UNICO)
            setattr(self, self.CAMPO_NOMBRE_UNICO, valor[:largo - len(sufijo)] + sufijo)
            campos.append(self.CAMPO_NOMBRE_UNICO)
        self.save(update_fields=campos)


# ===========================================================================
# [Lógica unificada] UNA sola regla para el estado del stock. Antes el inicio,
# las notificaciones y el catálogo usaban tres definiciones distintas de "crítico".
# ===========================================================================
ESTADOS_STOCK = ['Disponible', 'Stock bajo', 'Crítico', 'Sin stock']
ESTADOS_ALERTA = ('Sin stock', 'Crítico')   # requieren reposición urgente


def estado_stock(total, minimo):
    if total <= 0:
        return 'Sin stock'
    if total <= minimo:
        return 'Crítico'
    if total <= minimo * 2:
        return 'Stock bajo'
    return 'Disponible'


def anotar_estado(qs, campo_total='total'):
    """Misma regla que estado_stock(), pero la calcula MySQL (para filtrar sin traer todo a Python)."""
    return qs.annotate(estado_calc=Case(
        When(**{f'{campo_total}__lte': 0}, then=Value('Sin stock')),
        When(**{f'{campo_total}__lte': F('stock_minimo')}, then=Value('Crítico')),
        When(**{f'{campo_total}__lte': F('stock_minimo') * 2}, then=Value('Stock bajo')),
        default=Value('Disponible'), output_field=models.CharField(),
    ))


UNIDADES_MEDIDA = [
    ('Conteo', [('unidad', 'Unidad'), ('par', 'Par'), ('caja', 'Caja'), ('paquete', 'Paquete'),
                ('bolsa', 'Bolsa'), ('saco', 'Saco'), ('rollo', 'Rollo')]),
    ('Peso', [('kg', 'Kilogramo'), ('g', 'Gramo'), ('t', 'Tonelada')]),
    ('Longitud', [('m', 'Metro'), ('cm', 'Centímetro'), ('mm', 'Milímetro')]),
    ('Volumen', [('l', 'Litro'), ('ml', 'Mililitro'), ('galon', 'Galón'), ('m3', 'Metro cúbico')]),
    ('Superficie', [('m2', 'Metro cuadrado')]),
]
SIMBOLOS_UNIDAD = {
    'unidad': 'unid.', 'par': 'pares', 'caja': 'cajas', 'paquete': 'paq.', 'bolsa': 'bolsas', 'saco': 'sacos',
    'rollo': 'rollos', 'kg': 'kg', 'g': 'g', 't': 't', 'm': 'm', 'cm': 'cm', 'mm': 'mm', 'l': 'L', 'ml': 'mL',
    'galon': 'gal', 'm3': 'm³', 'm2': 'm²',
}
GRUPO_UNIDAD = {codigo: grupo for grupo, opciones in UNIDADES_MEDIDA for codigo, _ in opciones}


def simbolo_unidad(codigo):
    return SIMBOLOS_UNIDAD.get(codigo or 'unidad', codigo)


# ===========================================================================
# USUARIO
# ===========================================================================
class Usuario(AbstractUser):
    ROLES = [
        ('admin', 'Administrador'),
        ('bodeguero', 'Bodeguero'),
        ('trabajador', 'Trabajador'),
        ('rrhh', 'Recursos humanos'),
    ]
    telefono = models.CharField(max_length=15, blank=True)
    rol = models.CharField(max_length=20, choices=ROLES, default='trabajador')
    debe_cambiar_password = models.BooleanField(default=True)
    # [Soft delete] El usuario eliminado queda inactivo y oculto, pero su historial se conserva
    eliminado_en = models.DateTimeField(null=True, blank=True, db_index=True, editable=False)
    foto_actualizada = models.DateTimeField(null=True, blank=True, editable=False)

    def save(self, *args, **kwargs):
        if self._state.adding and self.is_superuser:
            self.rol = 'admin'
            self.debe_cambiar_password = False
        super().save(*args, **kwargs)

    def eliminar(self):
        # Se libera el username (= correo) para poder crear otra cuenta con ese correo más adelante
        self.eliminado_en = timezone.now()
        self.is_active = False
        self.username = f'eliminado-{self.pk}-{self.username}'[:150]
        self.save(update_fields=['eliminado_en', 'is_active', 'username'])

    def nombre_completo(self):
        return f'{self.first_name} {self.last_name}'.strip() or self.username

    def url_foto(self):
        if not self.foto_actualizada:
            return None
        return f'/api/fotoPerfil/{self.pk}/?v={int(self.foto_actualizada.timestamp())}'

    def __str__(self):
        return self.nombre_completo()


class FotoPerfil(models.Model):
    TIPOS = [('image/jpeg', 'JPEG'), ('image/png', 'PNG'), ('image/webp', 'WebP')]

    usuario = models.OneToOneField(Usuario, on_delete=models.CASCADE, related_name='foto_perfil')
    imagen = models.BinaryField()
    tipo = models.CharField(max_length=20, choices=TIPOS)
    actualizada = models.DateTimeField(auto_now=True)


# ===========================================================================
# BODEGA Y CATEGORÍA
# ===========================================================================
class Bodega(SoftDeleteModel):
    CAMPO_NOMBRE_UNICO = 'nombre'

    nombre = models.CharField(max_length=50, unique=True)
    ubicacion = models.CharField('ubicación', max_length=150, blank=True, default='',
                                 help_text='Dirección o sector, ej: Galpón 2, Av. Los Robles 123')
    # [Bodegas reales] La superficie se mide en m². Lo que cabe ya no es un número fijo de
    # "unidades" (no es lo mismo un tornillo que un casco): se calcula sumando sus ESPACIOS
    # (estantes y áreas libres), cada uno con su propia capacidad.
    area_m2 = models.DecimalField('superficie (m²)', max_digits=10, decimal_places=2, default=0)

    def capacidad_total(self):
        if hasattr(self, 'capacidad_espacios'):
            return self.capacidad_espacios or 0
        return self.espacios.aggregate(t=models.Sum('capacidad'))['t'] or 0

    def ocupado(self):
        if hasattr(self, 'total_ocupado'):
            return self.total_ocupado or 0
        return self.stocks.aggregate(t=models.Sum('cantidad'))['t'] or 0

    def disponible(self):
        return max(self.capacidad_total() - self.ocupado(), 0)

    def porcentaje_ocupado(self):
        capacidad = self.capacidad_total()
        return round(self.ocupado() * 100 / capacidad) if capacidad else 0

    def espacio_por_defecto(self):
        """Donde queda el stock si no se elige espacio: la primera área libre (o el primer estante)."""
        return (self.espacios.filter(tipo='area').order_by('id').first()
                or self.espacios.order_by('id').first())

    def __str__(self):
        return self.nombre


class Espacio(SoftDeleteModel):
    """[Bodegas reales] Lugar dentro de una bodega donde se guarda el stock."""
    TIPOS = [('estante', 'Estante'), ('area', 'Área libre')]
    CAMPO_NOMBRE_UNICO = 'nombre'

    bodega = models.ForeignKey(Bodega, on_delete=models.PROTECT, related_name='espacios')
    tipo = models.CharField(max_length=10, choices=TIPOS, default='estante')
    nombre = models.CharField(max_length=50, help_text='Ej: Estante A, Área de carga')
    capacidad = models.PositiveIntegerField(help_text='Unidades que caben en este espacio')
    niveles = models.PositiveSmallIntegerField(null=True, blank=True, help_text='Solo estantes: cantidad de repisas')
    area_m2 = models.DecimalField('superficie (m²)', max_digits=10, decimal_places=2, null=True, blank=True,
                                  help_text='Solo áreas libres')

    class Meta:
        ordering = ['bodega_id', 'tipo', 'nombre']
        constraints = [models.UniqueConstraint(fields=['bodega', 'nombre'], name='espacio_nombre_unico_por_bodega')]

    def ocupado(self):
        if hasattr(self, 'total_ocupado'):
            return self.total_ocupado or 0
        return self.stocks.aggregate(t=models.Sum('cantidad'))['t'] or 0

    def disponible(self):
        return max(self.capacidad - self.ocupado(), 0)

    def __str__(self):
        return f'{self.bodega} · {self.nombre}'


class Categoria(SoftDeleteModel):
    TIPOS = [('ambos', 'Herramientas y materiales'), ('herramienta', 'Herramientas'), ('material', 'Materiales')]
    CAMPO_NOMBRE_UNICO = 'nombre'

    nombre = models.CharField(max_length=50, unique=True)
    prefijo = models.CharField(max_length=3, help_text='Se usa para el SKU, ej: HRM')
    padre = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='subcategorias')
    tipo = models.CharField(max_length=12, choices=TIPOS, default='ambos')
    unidad_medida = models.CharField(max_length=10, choices=UNIDADES_MEDIDA, blank=True, default='')

    def ruta(self):
        return f'{self.padre.nombre} › {self.nombre}' if self.padre_id else self.nombre

    def admite(self, tipo_item):
        return self.tipo in ('ambos', tipo_item)

    def __str__(self):
        return self.ruta()


# ===========================================================================
# ÍTEM (material o herramienta) y su STOCK en cada bodega
# ===========================================================================
class Item(SoftDeleteModel):
    TIPOS = [('herramienta', 'Herramienta'), ('material', 'Material')]

    # [Concurrencia] NULL hasta asignarse. Antes nacía como '' (campo único) y dos altas
    # simultáneas chocaban con un IntegrityError (error 500).
    sku = models.CharField(max_length=10, unique=True, null=True, blank=True)
    nombre = models.CharField(max_length=100, db_index=True)
    categoria = models.ForeignKey(Categoria, on_delete=models.PROTECT, related_name='items')
    tipo = models.CharField(max_length=20, choices=TIPOS, default='material', db_index=True)
    unidad_medida = models.CharField(max_length=10, choices=UNIDADES_MEDIDA, default='unidad')
    stock_minimo = models.PositiveIntegerField(default=5)

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.sku:
            self.sku = f'{self.categoria.prefijo.upper()}-{self.id:04d}'
            super().save(update_fields=['sku'])

    def stock_total(self):
        return sum(s.cantidad for s in self.stocks.all())

    def simbolo_unidad(self):
        return simbolo_unidad(self.unidad_medida)

    def estado(self):
        return estado_stock(self.stock_total(), self.stock_minimo)

    def __str__(self):
        return f'{self.sku} - {self.nombre}'


class Stock(models.Model):
    """Cantidad de un ítem en una bodega. SOLO se modifica desde bodegaApp/stock.py."""
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='stocks')
    bodega = models.ForeignKey(Bodega, on_delete=models.CASCADE, related_name='stocks')
    espacio = models.ForeignKey(Espacio, on_delete=models.PROTECT, related_name='stocks')
    cantidad = models.PositiveIntegerField(default=0)

    class Meta:
        indexes = [models.Index(fields=['item', 'bodega'])]
        constraints = [
            # una fila por ítem y ESPACIO (un ítem puede estar en varios estantes de la misma bodega)
            models.UniqueConstraint(fields=['item', 'espacio'], name='stock_unico_item_espacio'),
            # [Stock negativo] Segunda barrera en la base de datos, además de la validación en Python
            models.CheckConstraint(condition=Q(cantidad__gte=0), name='stock_no_negativo'),
        ]

    def __str__(self):
        return f'{self.item.nombre} en {self.espacio}: {self.cantidad}'

    def save(self, *args, **kwargs):
        self.bodega_id = self.espacio.bodega_id   # la bodega siempre es la del espacio
        super().save(*args, **kwargs)


# ===========================================================================
# SOLICITUD: el trabajador pide algo y el bodeguero lo entrega
# ===========================================================================
class Solicitud(models.Model):
    ESTADOS = [('Pendiente', 'Pendiente'), ('Despachada', 'Despachada'), ('Cancelada', 'Cancelada')]

    trabajador = models.ForeignKey(Usuario, on_delete=models.PROTECT, related_name='solicitudes')
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name='solicitudes')
    cantidad = models.PositiveIntegerField()
    motivo = models.TextField(blank=True)
    fecha = models.DateTimeField(auto_now_add=True, db_index=True)
    estado = models.CharField(max_length=20, choices=ESTADOS, default='Pendiente', db_index=True)
    bodeguero = models.ForeignKey(Usuario, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='solicitudes_entregadas')
    stock_al_solicitar = models.PositiveIntegerField(null=True, blank=True)

    def excede_stock(self):
        return self.stock_al_solicitar is not None and self.cantidad > self.stock_al_solicitar

    def __str__(self):
        return f'{self.trabajador} pide {self.cantidad} x {self.item.nombre}'


# ===========================================================================
# PRÉSTAMO: se crea cuando se entrega una HERRAMIENTA
# ===========================================================================
class Prestamo(models.Model):
    ESTADOS_DEVOLUCION = [('Bueno', 'Bueno'), ('Regular', 'Regular'), ('Con falla', 'Con falla')]
    DIAS_PRESTAMO = 7

    solicitud = models.OneToOneField(Solicitud, on_delete=models.CASCADE, related_name='prestamo')
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name='prestamos')
    trabajador = models.ForeignKey(Usuario, on_delete=models.PROTECT, related_name='prestamos')
    responsable = models.ForeignKey(Usuario, on_delete=models.PROTECT, related_name='prestamos_responsable')
    bodega = models.ForeignKey(Bodega, on_delete=models.PROTECT)
    cantidad = models.PositiveIntegerField(default=1)
    fecha_entrega = models.DateTimeField(default=timezone.now, db_index=True)
    fecha_limite = models.DateTimeField(db_index=True)
    fecha_devolucion = models.DateTimeField(null=True, blank=True, db_index=True)
    estado_devolucion = models.CharField(max_length=20, choices=ESTADOS_DEVOLUCION, blank=True)
    comentario = models.TextField(blank=True)
    # [CRUD admin] Un préstamo registrado por error se ANULA (no se borra): las herramientas
    # vuelven al stock y el préstamo queda en el historial marcado como anulado.
    anulado = models.BooleanField(default=False)
    unidades = models.ManyToManyField('Unidad', related_name='prestamos', blank=True)

    def save(self, *args, **kwargs):
        if not self.fecha_limite:
            self.fecha_limite = (self.fecha_entrega or timezone.now()) + timedelta(days=self.DIAS_PRESTAMO)
        super().save(*args, **kwargs)

    def activo(self):
        return self.fecha_devolucion is None

    def __str__(self):
        return f'{self.item.nombre} -> {self.trabajador}'


class Unidad(models.Model):
    ESTADOS = [('Disponible', 'Disponible'), ('Prestada', 'Prestada'), ('De baja', 'De baja')]

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='unidades')
    codigo = models.CharField(max_length=30, unique=True)
    bodega = models.ForeignKey(Bodega, on_delete=models.PROTECT, related_name='unidades')
    espacio = models.ForeignKey(Espacio, on_delete=models.PROTECT, related_name='unidades', null=True, blank=True)
    estado = models.CharField(max_length=20, choices=ESTADOS, default='Disponible', db_index=True)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['codigo']

    def __str__(self):
        return f'{self.codigo} ({self.item.nombre})'


# ===========================================================================
# [Registro de movimientos] Cada cambio de stock deja una fila: quién, cuándo, cuánto, por qué y con
# qué saldo quedó. Permite auditar cualquier diferencia de inventario.
# Solo se escribe desde bodegaApp/stock.py.
# ===========================================================================
class MovimientoStock(models.Model):
    TIPOS = [
        ('ingreso', 'Ingreso'),
        ('ajuste', 'Ajuste manual'),
        ('entrega', 'Entrega a trabajador'),
        ('devolucion', 'Devolución'),
        ('baja', 'Baja de herramienta'),
        ('reactivacion', 'Reactivación de herramienta'),
        ('traslado', 'Traslado entre espacios'),
        ('salida', 'Salida manual'),
    ]
    tipo = models.CharField(max_length=15, choices=TIPOS, db_index=True)
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name='movimientos')
    bodega = models.ForeignKey(Bodega, on_delete=models.PROTECT, related_name='movimientos')
    espacio = models.ForeignKey(Espacio, null=True, blank=True, on_delete=models.PROTECT, related_name='movimientos')
    cantidad = models.IntegerField(help_text='Positivo = entra, negativo = sale')
    saldo = models.PositiveIntegerField(help_text='Stock que quedó en esa bodega después del movimiento')
    usuario = models.ForeignKey(Usuario, null=True, blank=True, on_delete=models.PROTECT, related_name='movimientos')
    fecha = models.DateTimeField(default=timezone.now, db_index=True)
    motivo = models.CharField(max_length=200, blank=True)
    solicitud = models.ForeignKey(Solicitud, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name='movimientos')
    prestamo = models.ForeignKey(Prestamo, null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name='movimientos')
    unidad = models.ForeignKey(Unidad, null=True, blank=True, on_delete=models.SET_NULL, related_name='movimientos')
    # [CRUD admin] El registro no se edita ni se borra (es la auditoría): un movimiento
    # equivocado se REVIERTE con otro movimiento en sentido contrario que apunta a él.
    revierte = models.OneToOneField('self', null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='reversion')

    class Meta:
        ordering = ['-fecha', '-id']

    def __str__(self):
        return f'{self.get_tipo_display()} {self.cantidad:+d} {self.item.nombre} en {self.bodega}'


class PedidoAdmin(models.Model):
    TIPOS = [('reposicion', 'Reposición de stock'), ('nuevo', 'Producto nuevo'), ('otro', 'Otro')]
    PRIORIDADES = [('normal', 'Normal'), ('alta', 'Alta'), ('urgente', 'Urgente')]
    ESTADOS = [('Pendiente', 'Pendiente'), ('Aprobado', 'Aprobado'), ('Rechazado', 'Rechazado'),
               ('Cancelado', 'Cancelado')]

    solicitante = models.ForeignKey(Usuario, on_delete=models.PROTECT, related_name='pedidos_admin')
    tipo = models.CharField(max_length=12, choices=TIPOS, default='reposicion')
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.PROTECT, related_name='pedidos_admin')
    descripcion = models.CharField(max_length=150, blank=True)
    cantidad = models.PositiveIntegerField()
    bodega = models.ForeignKey(Bodega, null=True, blank=True, on_delete=models.PROTECT, related_name='pedidos_admin')
    motivo = models.TextField()
    prioridad = models.CharField(max_length=10, choices=PRIORIDADES, default='normal')
    estado = models.CharField(max_length=12, choices=ESTADOS, default='Pendiente', db_index=True)
    fecha = models.DateTimeField(default=timezone.now, db_index=True)
    respuesta = models.TextField(blank=True)
    atendido_por = models.ForeignKey(Usuario, null=True, blank=True, on_delete=models.SET_NULL,
                                     related_name='pedidos_atendidos')
    fecha_respuesta = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-fecha', '-id']

    def producto(self):
        return self.item.nombre if self.item_id else self.descripcion

    def __str__(self):
        return f'{self.solicitante} pide {self.cantidad} x {self.producto()}'
