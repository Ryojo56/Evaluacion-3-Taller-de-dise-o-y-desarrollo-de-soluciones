import random
from datetime import timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from bodegaApp import stock as servicio_stock
from bodegaApp.models import (Bodega, Categoria, Espacio, Item, MovimientoStock, PedidoAdmin, Prestamo, Solicitud,
                              Unidad, Usuario)
from bodegaApp.stock import CapacidadExcedida
from bodegaApp.unidades import crear_unidades

PASSWORD_DEMO = 'Bodega#2026'

NOMBRES = ['Camila', 'Diego', 'Valentina', 'Matías', 'Francisca', 'Sebastián', 'Javiera', 'Benjamín', 'Catalina',
           'Vicente', 'Constanza', 'Tomás', 'Antonia', 'Joaquín', 'Isidora', 'Cristóbal', 'Fernanda', 'Felipe',
           'Daniela', 'Nicolás', 'Paula', 'Martín', 'Carolina', 'Ignacio', 'Macarena', 'Rodrigo', 'Gabriela',
           'Andrés', 'Bárbara', 'Gonzalo', 'Pía', 'Esteban', 'Trinidad', 'Álvaro', 'Josefa', 'Claudio', 'Renata',
           'Patricio', 'Florencia', 'Hernán']
APELLIDOS = ['González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda',
             'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández', 'Torres', 'Araya', 'Flores', 'Espinoza',
             'Valenzuela', 'Castillo', 'Tapia', 'Reyes', 'Gutiérrez', 'Castro', 'Pizarro', 'Álvarez', 'Vásquez',
             'Sánchez', 'Fernández', 'Ramírez', 'Carrasco', 'Gómez', 'Cortés', 'Herrera', 'Núñez', 'Jara', 'Vergara',
             'Rivera', 'Figueroa']

BODEGAS = [
    ('Bodega Poniente', 'Camino a Melipilla km 12', 900, [('Estante P', 6, 600, 5)], [('Patio de carga', 2500, 400)]),
    ('Bodega Oriente', 'Av. Las Industrias 2300', 700, [('Estante O', 5, 500, 4)], [('Área de pallets', 1800, 300)]),
    ('Centro de Distribución', 'Ruta 68, parcela 15', 1500, [('Rack CD', 8, 900, 6)],
     [('Zona de acopio', 4000, 700), ('Zona de despacho', 1500, 250)]),
]

CATEGORIAS = [
    ('Herramientas eléctricas', 'HRM', 'herramienta', '', [
        ('Taladros', 'TLD', '', [('Taladro percutor', ['13 mm', '16 mm', 'inalámbrico 18V', 'inalámbrico 20V'], 2),
                                 ('Rotomartillo', ['SDS Plus', 'SDS Max'], 1)]),
        ('Esmeriles y amoladoras', 'ESM', '', [('Esmeril angular', ['4,5"', '7"', '9"'], 2),
                                               ('Esmeril de banco', ['6"', '8"'], 1)]),
        ('Sierras', 'SRR', '', [('Sierra caladora', ['600W', '800W'], 1), ('Sierra ingletadora', ['10"', '12"'], 1),
                                ('Sierra sable', ['inalámbrica', '1100W'], 1)]),
    ]),
    ('Herramientas manuales', 'HMN', 'herramienta', 'unidad', [
        ('Llaves', 'LLV', '', [('Llave inglesa', ['8"', '10"', '12"'], 3), ('Juego de llaves combinadas', ['métrico',
                                                                                                           'pulgadas'], 2)]),
        ('Martillos y combos', 'MRT', '', [('Martillo carpintero', ['16 oz', '20 oz'], 3), ('Combo', ['4 lb', '8 lb'], 2)]),
        ('Medición', 'MDC', '', [('Nivel de burbuja', ['60 cm', '120 cm'], 2), ('Huincha de medir', ['5 m', '8 m'], 4),
                                 ('Nivel láser', ['de líneas', 'rotativo'], 1)]),
    ]),
    ('Materiales de fijación', 'MAT', 'material', '', [
        ('Tornillos', 'TOR', 'caja', [('Tornillo volcanita', ['6x1"', '6x1 1/4"', '8x2"'], 20),
                                      ('Tornillo autoperforante', ['8x3/4"', '10x1"', '12x2"'], 20)]),
        ('Clavos', 'CLV', 'kg', [('Clavo corriente', ['1"', '2"', '3"', '4"'], 25), ('Clavo de techo', ['2 1/2"'], 15)]),
        ('Anclajes', 'ANC', 'paquete', [('Tarugo plástico', ['6 mm', '8 mm', '10 mm'], 30),
                                        ('Perno de anclaje', ['3/8"', '1/2"'], 15)]),
    ]),
    ('Construcción', 'CON', 'material', '', [
        ('Cementos y morteros', 'CEM', 'saco', [('Cemento', ['25 kg', '42,5 kg'], 20), ('Mortero de pega', ['25 kg'], 15),
                                                ('Yeso', ['25 kg'], 10)]),
        ('Áridos', 'ARI', 'm3', [('Arena', ['fina', 'gruesa'], 5), ('Gravilla', ['3/4"'], 5), ('Ripio', ['1 1/2"'], 4)]),
        ('Fierros', 'FIE', 'unidad', [('Fierro estriado', ['8 mm', '10 mm', '12 mm'], 40),
                                      ('Malla acma', ['C-92', 'C-139'], 15)]),
    ]),
    ('Electricidad', 'ELE', 'material', '', [
        ('Cables', 'CBL', 'm', [('Cable THHN', ['1,5 mm²', '2,5 mm²', '4 mm²'], 100), ('Cable concéntrico', ['2x6'], 50)]),
        ('Canalización', 'CAN', 'm', [('Tubo conduit', ['20 mm', '25 mm'], 60), ('Canaleta', ['20x10', '40x25'], 40)]),
        ('Iluminación', 'ILU', 'unidad', [('Foco LED', ['10W', '50W', '100W'], 10), ('Ampolleta LED', ['9W', '12W'], 25)]),
    ]),
    ('Pinturas y químicos', 'PIN', 'material', '', [
        ('Pinturas', 'PNT', 'galon', [('Esmalte al agua', ['blanco', 'gris', 'negro'], 6),
                                      ('Anticorrosivo', ['rojo', 'gris'], 5)]),
        ('Solventes', 'SOL', 'l', [('Diluyente sintético', [''], 10), ('Aguarrás', [''], 10)]),
        ('Adhesivos y sellos', 'ADH', 'unidad', [('Silicona', ['transparente', 'blanca'], 12),
                                                 ('Espuma expansiva', ['750 ml'], 8)]),
    ]),
    ('Equipos de protección', 'EPP', 'material', '', [
        ('Guantes', 'GNT', 'par', [('Guante de cabritilla', ['M', 'L', 'XL'], 20), ('Guante de nitrilo', ['M', 'L'], 30)]),
        ('Protección visual y auditiva', 'PVA', 'unidad', [('Lente de seguridad', ['claro', 'oscuro'], 20),
                                                           ('Protector auditivo', ['tipo fono'], 10)]),
        ('Calzado y ropa', 'CYR', 'par', [('Zapato de seguridad', ['40', '41', '42', '43', '44'], 4)]),
    ]),
]

COMENTARIOS_DEVOLUCION = {
    'Bueno': ['Funcionó bien durante toda la faena.', 'Sin observaciones, se devuelve limpia.',
              'Trabajó correctamente, sin problemas.'],
    'Regular': ['Funciona, pero hace un ruido extraño al partir.', 'El cable tiene desgaste en la funda.',
                'Le falta un accesorio del maletín.'],
    'Con falla': ['Dejó de encender al final del turno.', 'El gatillo se traba y hay que revisarlo.',
                  'Se quemó el motor, necesita mantención.'],
}
MOTIVOS_MATERIAL = ['Obra edificio Los Aromos', 'Mantención de galpón 3', 'Reparación de techumbre',
                    'Instalación eléctrica oficina', 'Pedido de faena norte', 'Terminaciones depto. piloto',
                    'Mantención preventiva', 'Cierre perimetral sector sur']


class Command(BaseCommand):
    help = 'Agrega muchos datos de prueba: bodegas, categorías con subcategorías, ítems, préstamos, solicitudes y pedidos'

    def add_arguments(self, parser):
        parser.add_argument('--semilla', type=int, default=2026)

    def handle(self, *args, **options):
        if not Usuario.objects.exists() and not Bodega.todos.exists():
            call_command('cargar_datos', stdout=self.stdout)
        if Bodega.todos.filter(nombre='Centro de Distribución').exists():
            self.stdout.write(self.style.WARNING('Los datos masivos ya estaban cargados.'))
            return
        self.azar = random.Random(options['semilla'])
        self.ahora = timezone.now()
        with transaction.atomic():
            self.cargar()
        self.stdout.write(self.style.SUCCESS('Datos masivos cargados.'))
        for etiqueta, modelo in [('Usuarios', Usuario), ('Bodegas', Bodega), ('Espacios', Espacio),
                                 ('Categorías', Categoria), ('Ítems', Item), ('Códigos de herramientas', Unidad),
                                 ('Solicitudes', Solicitud), ('Préstamos', Prestamo), ('Pedidos al admin', PedidoAdmin),
                                 ('Movimientos de stock', MovimientoStock)]:
            self.stdout.write(f'  {etiqueta}: {modelo.objects.count()}')
        self.stdout.write(f'Contraseña de todos los usuarios: {PASSWORD_DEMO}')

    def hace(self, dias, horas=0):
        return self.ahora - timedelta(days=dias, hours=horas)

    def fechar(self, movimientos, fecha):
        movimientos.update(fecha=fecha)

    def cargar(self):
        self.admin = (Usuario.objects.filter(rol='admin', is_active=True, eliminado_en__isnull=True).order_by('id').first()
                      or Usuario.objects.filter(is_superuser=True, is_active=True).order_by('id').first())
        if self.admin is None:
            self.admin = Usuario(username='admin@bodega.cl', email='admin@bodega.cl', first_name='Administrador',
                                 rol='admin', is_staff=True, is_superuser=True, debe_cambiar_password=False)
            self.admin.set_password(PASSWORD_DEMO)
            self.admin.save()
        self.crear_usuarios()
        self.crear_bodegas()
        self.crear_categorias_e_items()
        self.crear_stock()
        self.crear_prestamos()
        self.crear_solicitudes_material()
        self.crear_traslados()
        self.crear_pedidos()

    def crear_usuarios(self):
        usados = {u.lower() for u in Usuario.objects.values_list('username', flat=True)}
        nuevos = []
        for i in range(40):
            nombre, apellido = NOMBRES[i], APELLIDOS[(i * 7) % len(APELLIDOS)]
            rol = 'bodeguero' if i in (3, 17) else 'rrhh' if i == 29 else 'trabajador'
            base = f'{nombre}.{apellido}'.lower()
            for a, b in zip('áéíóúñ', 'aeioun'):
                base = base.replace(a, b)
            correo = f'{base}@bodega.cl'
            if correo in usados:
                continue
            u = Usuario(username=correo, email=correo, first_name=nombre, last_name=apellido, rol=rol,
                        telefono=f'+569{self.azar.randint(10000000, 99999999)}', debe_cambiar_password=False,
                        is_active=i != 38)
            u.set_password(PASSWORD_DEMO)
            nuevos.append(u)
        Usuario.objects.bulk_create(nuevos)
        for u in Usuario.objects.filter(username__in=[n.username for n in nuevos]):
            Usuario.objects.filter(pk=u.pk).update(date_joined=self.hace(self.azar.randint(5, 200)))
        self.trabajadores = list(Usuario.objects.filter(rol='trabajador', is_active=True, eliminado_en__isnull=True,
                                                        debe_cambiar_password=False))
        self.bodegueros = list(Usuario.objects.filter(rol='bodeguero', is_active=True, eliminado_en__isnull=True)) or [self.admin]
        self.solicitantes_pedido = ([b for b in self.bodegueros if b.rol == 'bodeguero'] + self.trabajadores[:12]
                                    + list(Usuario.objects.filter(rol='rrhh', is_active=True, eliminado_en__isnull=True)))

    def crear_bodegas(self):
        for nombre, ubicacion, area, estantes, areas in BODEGAS:
            bodega = Bodega.objects.create(nombre=nombre, ubicacion=ubicacion, area_m2=area)
            for prefijo, cantidad, capacidad, niveles in estantes:
                for n in range(1, cantidad + 1):
                    Espacio.objects.create(bodega=bodega, tipo='estante', nombre=f'{prefijo}{n}',
                                           capacidad=capacidad, niveles=niveles)
            for nombre_area, capacidad, m2 in areas:
                Espacio.objects.create(bodega=bodega, tipo='area', nombre=nombre_area, capacidad=capacidad, area_m2=m2)
        central = Bodega.objects.filter(nombre='Bodega Central').first()
        if central:
            for letra in 'CDE':
                if not central.espacios.filter(nombre=f'Estante {letra}').exists():
                    Espacio.objects.create(bodega=central, tipo='estante', nombre=f'Estante {letra}', capacidad=500,
                                           niveles=5)
        self.espacios = list(Espacio.objects.select_related('bodega'))

    def categoria(self, nombre, prefijo, tipo, unidad, padre=None):
        cat = Categoria.objects.filter(prefijo=prefijo, padre=padre).first() or Categoria.objects.filter(
            nombre=nombre).first()
        if cat is None:
            return Categoria.objects.create(nombre=nombre, prefijo=prefijo, tipo=tipo, unidad_medida=unidad,
                                            padre=padre)
        if cat.items.exclude(tipo=tipo).exists():
            tipo = 'ambos'
        cat.tipo, cat.unidad_medida = tipo, unidad if tipo != 'herramienta' else ''
        cat.save(update_fields=['tipo', 'unidad_medida'])
        return cat

    def crear_categorias_e_items(self):
        self.items = []
        existentes = {n.lower() for n in Item.objects.values_list('nombre', flat=True)}
        for nombre, prefijo, tipo, unidad, subcategorias in CATEGORIAS:
            padre = self.categoria(nombre, prefijo, 'ambos' if prefijo == 'HRM' else tipo, unidad)
            for sub_nombre, sub_prefijo, sub_unidad, plantillas in subcategorias:
                sub_tipo = tipo if padre.tipo == 'ambos' else padre.tipo
                sub = self.categoria(sub_nombre, sub_prefijo, sub_tipo,
                                     '' if sub_tipo == 'herramienta' else sub_unidad, padre)
                for base, variantes, minimo in plantillas:
                    for variante in variantes:
                        nombre_item = f'{base} {variante}'.strip()
                        if nombre_item.lower() in existentes:
                            continue
                        existentes.add(nombre_item.lower())
                        item = Item.objects.create(
                            nombre=nombre_item, categoria=sub, tipo=sub_tipo,
                            unidad_medida='unidad' if sub_tipo == 'herramienta' else (sub_unidad or 'unidad'),
                            stock_minimo=minimo)
                        self.items.append(item)

    def espacio_con_lugar(self, cantidad, preferidos=None):
        opciones = preferidos or self.espacios
        self.azar.shuffle(opciones)
        for espacio in opciones:
            if espacio.disponible() >= cantidad:
                return espacio
        return None

    def crear_stock(self):
        estantes = [e for e in self.espacios if e.tipo == 'estante']
        areas = [e for e in self.espacios if e.tipo == 'area']
        for n, item in enumerate(self.items):
            if n % 17 == 5:
                continue
            herramienta = item.tipo == 'herramienta'
            lugares = self.azar.choice([1, 1, 2, 2, 3])
            for _ in range(lugares):
                if herramienta:
                    cantidad = self.azar.randint(2, 8)
                elif n % 11 == 3:
                    cantidad = self.azar.randint(1, max(item.stock_minimo, 1))
                else:
                    cantidad = self.azar.randint(item.stock_minimo * 2, item.stock_minimo * 12)
                pesado = item.unidad_medida in ('saco', 'm3', 'kg', 'm')
                espacio = self.espacio_con_lugar(cantidad, list(areas if pesado else estantes))
                if espacio is None:
                    continue
                try:
                    servicio_stock.sumar(item, espacio, cantidad, 'ingreso', self.admin, 'Carga inicial de inventario')
                except CapacidadExcedida:
                    continue
                if herramienta:
                    crear_unidades(item, espacio, cantidad)
            fecha = self.hace(self.azar.randint(130, 180))
            self.fechar(MovimientoStock.objects.filter(item=item), fecha)
            Unidad.objects.filter(item=item).update(creada=fecha)

    def crear_prestamos(self):
        herramientas = [i for i in Item.objects.filter(tipo='herramienta') if i.unidades.filter(estado='Disponible').exists()]
        for n in range(220):
            item = self.azar.choice(herramientas)
            disponibles = list(item.unidades.filter(estado='Disponible').select_related('espacio', 'bodega'))
            if not disponibles:
                continue
            unidad = self.azar.choice(disponibles)
            trabajador = self.azar.choice(self.trabajadores)
            bodeguero = self.azar.choice(self.bodegueros)
            activo = n >= 175
            dias = self.azar.randint(1, 12) if activo else self.azar.randint(14, 120)
            entrega = self.hace(dias, self.azar.randint(0, 9))
            solicitud = Solicitud.objects.create(trabajador=trabajador, item=item, cantidad=1, estado='Despachada',
                                                 bodeguero=bodeguero, motivo=self.azar.choice(MOTIVOS_MATERIAL),
                                                 stock_al_solicitar=item.stock_total())
            Solicitud.objects.filter(pk=solicitud.pk).update(fecha=entrega - timedelta(hours=self.azar.randint(1, 30)))
            fila = servicio_stock.bloquear_fila(item, unidad.espacio)
            motivo = f'Solicitud #{solicitud.id} de {trabajador.nombre_completo()}'
            servicio_stock.mover(fila, -1, 'entrega', bodeguero, motivo, solicitud=solicitud, unidad=unidad)
            unidad.estado = 'Prestada'
            unidad.save(update_fields=['estado'])
            prestamo = Prestamo.objects.create(solicitud=solicitud, item=item, trabajador=trabajador,
                                               responsable=bodeguero, bodega=unidad.bodega, fecha_entrega=entrega,
                                               fecha_limite=entrega + timedelta(days=Prestamo.DIAS_PRESTAMO))
            prestamo.unidades.set([unidad])
            MovimientoStock.objects.filter(solicitud=solicitud).update(prestamo=prestamo, fecha=entrega)
            if activo:
                if n % 9 == 0:
                    estado = self.azar.choice(list(COMENTARIOS_DEVOLUCION))
                    prestamo.estado_devolucion = estado
                    prestamo.comentario = self.azar.choice(COMENTARIOS_DEVOLUCION[estado])
                    prestamo.save(update_fields=['estado_devolucion', 'comentario'])
                continue
            estado = self.azar.choices(list(COMENTARIOS_DEVOLUCION), weights=[75, 18, 7])[0]
            devuelto = min(entrega + timedelta(days=self.azar.randint(1, 10), hours=self.azar.randint(0, 8)),
                           self.ahora)
            prestamo.fecha_devolucion = devuelto
            prestamo.estado_devolucion = estado
            prestamo.comentario = self.azar.choice(COMENTARIOS_DEVOLUCION[estado])
            prestamo.save()
            unidad.estado = 'Disponible'
            unidad.save(update_fields=['estado'])
            servicio_stock.sumar(item, unidad.espacio, 1, 'devolucion', bodeguero,
                                 f'Préstamo #{prestamo.id} devuelto por {trabajador.nombre_completo()}',
                                 verificar_capacidad=False, prestamo=prestamo, unidad=unidad)
            MovimientoStock.objects.filter(prestamo=prestamo, tipo='devolucion').update(fecha=devuelto)

    def crear_solicitudes_material(self):
        materiales = list(Item.objects.filter(tipo='material'))
        for n in range(320):
            item = self.azar.choice(materiales)
            trabajador = self.azar.choice(self.trabajadores)
            total = item.stock_total()
            if n >= 290:
                estado = 'Pendiente'
                dias = self.azar.randint(0, 6)
            elif n % 23 == 0:
                estado = 'Cancelada'
                dias = self.azar.randint(10, 120)
            else:
                estado = 'Despachada'
                dias = self.azar.randint(1, 120)
            tope = max(1, min(total // 6, item.stock_minimo * 2)) if total else 1
            cantidad = self.azar.randint(1, tope)
            excede = estado == 'Pendiente' and n % 7 == 0
            if excede:
                cantidad = total + self.azar.randint(5, 40)
            if estado == 'Despachada' and cantidad > total:
                continue
            fecha = self.hace(dias, self.azar.randint(0, 10))
            motivo = self.azar.choice(MOTIVOS_MATERIAL)
            if excede:
                motivo = f'{motivo}: se necesita más de lo disponible para terminar la etapa completa'
            solicitud = Solicitud.objects.create(trabajador=trabajador, item=item, cantidad=cantidad, motivo=motivo,
                                                 estado=estado, stock_al_solicitar=total,
                                                 bodeguero=self.azar.choice(self.bodegueros) if estado == 'Despachada' else None)
            Solicitud.objects.filter(pk=solicitud.pk).update(fecha=fecha)
            if estado != 'Despachada':
                continue
            faltan = cantidad
            for fila in sorted(servicio_stock.bloquear_filas_item(item), key=lambda f: -f.cantidad):
                if not faltan:
                    break
                sacar = min(faltan, fila.cantidad)
                if sacar:
                    servicio_stock.mover(fila, -sacar, 'entrega', solicitud.bodeguero,
                                         f'Solicitud #{solicitud.id} de {trabajador.nombre_completo()}',
                                         solicitud=solicitud)
                    faltan -= sacar
            MovimientoStock.objects.filter(solicitud=solicitud).update(fecha=fecha + timedelta(hours=2))

    def crear_traslados(self):
        materiales = [i for i in Item.objects.filter(tipo='material') if i.stock_total() > 10]
        for _ in range(25):
            item = self.azar.choice(materiales)
            fila = item.stocks.filter(cantidad__gt=5).select_related('espacio').first()
            if not fila:
                continue
            cantidad = self.azar.randint(1, fila.cantidad // 2)
            destino = self.espacio_con_lugar(cantidad, [e for e in self.espacios if e.pk != fila.espacio_id])
            if destino is None:
                continue
            servicio_stock.trasladar(item, fila.espacio, destino, cantidad, self.azar.choice(self.bodegueros))
            self.fechar(MovimientoStock.objects.filter(item=item, tipo='traslado', fecha__gte=self.ahora),
                        self.hace(self.azar.randint(1, 60)))

    def crear_pedidos(self):
        criticos = [i for i in Item.objects.all() if i.estado() in ('Crítico', 'Sin stock', 'Stock bajo')]
        nuevos = ['Arnés de seguridad', 'Andamio modular', 'Generador eléctrico 5 kVA', 'Hidrolavadora industrial',
                  'Escalera telescópica', 'Compresor de aire 50 L', 'Soldadora inverter', 'Carro portaherramientas']
        bodegas = list(Bodega.objects.all())
        for n in range(45):
            solicitante = self.azar.choice(self.solicitantes_pedido)
            fecha = self.hace(self.azar.randint(0, 90), self.azar.randint(0, 10))
            if n % 3 == 0:
                datos = {'tipo': 'nuevo', 'descripcion': self.azar.choice(nuevos), 'cantidad': self.azar.randint(1, 4)}
            elif n % 10 == 7:
                datos = {'tipo': 'otro', 'descripcion': 'Mantención de herramientas con falla',
                         'cantidad': self.azar.randint(1, 6)}
            else:
                item = self.azar.choice(criticos) if criticos else self.azar.choice(self.items)
                datos = {'tipo': 'reposicion', 'item': item, 'cantidad': max(item.stock_minimo * 3, 5)}
            if n >= 38:
                estado = 'Pendiente'
                fecha = self.hace(self.azar.randint(0, 5), self.azar.randint(0, 10))
            else:
                estado = self.azar.choices(['Aprobado', 'Rechazado', 'Cancelado'], weights=[65, 25, 10])[0]
            respuesta = {'Aprobado': 'Aprobado. La compra llega la próxima semana.',
                         'Rechazado': 'No hay presupuesto este mes; vuelve a pedirlo el próximo.'}.get(estado, '')
            PedidoAdmin.objects.create(
                solicitante=solicitante, bodega=self.azar.choice(bodegas),
                motivo=self.azar.choice(['Se acabó el stock y hay faenas esperando', 'Aumentó la demanda en obra',
                                         'Reemplazo de equipos dados de baja', 'Nuevo contrato requiere este material']),
                prioridad=self.azar.choices(['normal', 'alta', 'urgente'], weights=[60, 30, 10])[0],
                estado=estado, fecha=fecha, respuesta=respuesta,
                atendido_por=self.admin if estado in ('Aprobado', 'Rechazado') else None,
                fecha_respuesta=fecha + timedelta(days=self.azar.randint(0, 3)) if respuesta else None,
                **datos)
