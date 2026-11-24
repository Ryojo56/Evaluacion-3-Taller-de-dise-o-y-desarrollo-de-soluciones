from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from bodegaApp.models import Bodega, Categoria, Espacio, Item, Prestamo, Solicitud, Stock, Usuario
from bodegaApp.unidades import generar_faltantes

PASSWORD_DEMO = 'Bodega#2026'


class Command(BaseCommand):
    help = 'Carga bodegas, categorías, ítems, usuarios, solicitudes y préstamos de prueba'

    @transaction.atomic
    def handle(self, *args, **options):
        if (Usuario.objects.filter(username__in=['admin@bodega.cl', 'bodeguero@bodega.cl']).exists()
                or Bodega.todos.filter(nombre__in=['Bodega Central', 'Bodega Norte', 'Bodega Sur']).exists()):
            self.stdout.write(self.style.WARNING('Los datos de prueba ya estaban cargados.'))
            return

        # ---- Usuarios ----------------------------------------------------
        def crear_usuario(email, nombre, apellido, rol, fono, **extra):
            u = Usuario(username=email, email=email, first_name=nombre, last_name=apellido,
                        rol=rol, telefono=fono, debe_cambiar_password=False, **extra)
            u.set_password(PASSWORD_DEMO)
            u.save()
            return u

        admin = crear_usuario('admin@bodega.cl', 'Alexander', 'Smith', 'admin', '+56911235444',is_staff=True, is_superuser=True)
        carla = crear_usuario('bodeguero@bodega.cl', 'Carla', 'Muñoz', 'bodeguero', '+56922223333')
        jose = crear_usuario('trabajador@bodega.cl', 'Jose', 'Perez', 'trabajador', '+56933334444')
        maria = crear_usuario('maria.soto@bodega.cl', 'María', 'Soto', 'trabajador', '+56944445555')
        luis = crear_usuario('luis.reyes@bodega.cl', 'Luis', 'Reyes', 'trabajador', '+56955556666')
        pedro = crear_usuario('pedro.vidal@bodega.cl', 'Pedro', 'Vidal', 'trabajador', '+56966667777')
        crear_usuario('rrhh@bodega.cl', 'Fernanda', 'Rojas', 'rrhh', '+56977778888')
        # Un usuario nuevo que debe cambiar su contraseña al entrar
        nuevo = crear_usuario('nuevo@bodega.cl', 'Usuario', 'Nuevo', 'trabajador', '')
        nuevo.debe_cambiar_password = True
        nuevo.save()

        # ---- Bodegas y categorías ----------------------------------------
        # Cada bodega tiene superficie (m²) y espacios: estantes y áreas libres con su capacidad
        central = Bodega.objects.create(nombre='Bodega Central', ubicacion='Galpón principal, Av. Los Robles 1450',
                                        area_m2=600)
        norte = Bodega.objects.create(nombre='Bodega Norte', ubicacion='Sector norte, módulo 3', area_m2=120)
        sur = Bodega.objects.create(nombre='Bodega Sur', ubicacion='Patio de maniobras sur', area_m2=250)

        def espacio(bodega, nombre, tipo, capacidad, **extra):
            return Espacio.objects.create(bodega=bodega, nombre=nombre, tipo=tipo, capacidad=capacidad, **extra)

        central_area = espacio(central, 'Área libre principal', 'area', 300, area_m2=200)
        estante_a = espacio(central, 'Estante A', 'estante', 400, niveles=5)
        estante_b = espacio(central, 'Estante B', 'estante', 300, niveles=4)
        norte_area = espacio(norte, 'Área libre principal', 'area', 150, area_m2=60)
        espacio(norte, 'Estante N1', 'estante', 40, niveles=3)
        espacio(sur, 'Área libre principal', 'area', 300, area_m2=180)

        herr = Categoria.objects.create(nombre='Herramientas eléctricas', prefijo='HRM')
        fij = Categoria.objects.create(nombre='Materiales de fijación', prefijo='MAT')
        epp = Categoria.objects.create(nombre='Equipos de protección', prefijo='EPP')

        # ---- Ítems y stock -----------------------------------------------
        def crear_item(nombre, cat, tipo, minimo, stocks):
            item = Item.objects.create(nombre=nombre, categoria=cat, tipo=tipo, stock_minimo=minimo)
            for lugar, cantidad in stocks:
                Stock.objects.create(item=item, espacio=lugar, cantidad=cantidad)
            return item

        taladro = crear_item('Taladro percutor 1/2"', herr, 'herramienta', 3, [(central_area, 2), (norte_area, 1)])
        tornillo = crear_item('Tornillo autoperforante 2"', fij, 'material', 50, [(estante_a, 340)])
        amoladora = crear_item('Amoladora angular 4.5"', herr, 'herramienta', 2, [(norte_area, 4)])
        crear_item('Casco de seguridad', epp, 'material', 10, [(estante_b, 58)])
        crear_item('Cemento gris 25kg', fij, 'material', 10, [])
        sierra = crear_item('Sierra circular', herr, 'herramienta', 1, [(central_area, 3)])

        # ---- Solicitudes y préstamos -------------------------------------
        ahora = timezone.now()
        Solicitud.objects.create(trabajador=maria, item=amoladora, cantidad=1, motivo='Mantención taller B',
                                 stock_al_solicitar=amoladora.stock_total())
        Solicitud.objects.create(trabajador=luis, item=tornillo, cantidad=80, estado='Despachada', bodeguero=carla)

        def prestamo(trabajador, item, bodega, dias_atras, limite, devuelto_hace=None, estado=''):
            s = Solicitud.objects.create(trabajador=trabajador, item=item, cantidad=1,
                                         estado='Despachada', bodeguero=carla)
            return Prestamo.objects.create(
                solicitud=s, item=item, trabajador=trabajador, responsable=carla, bodega=bodega,
                fecha_entrega=ahora - timedelta(days=dias_atras), fecha_limite=limite,
                fecha_devolucion=(ahora - timedelta(days=devuelto_hace)) if devuelto_hace else None,
                estado_devolucion=estado,
                comentario='Funcionó correctamente durante toda la faena, sin observaciones.' if estado else '',
            )

        prestamo(luis, taladro, central, 10, ahora - timedelta(days=3))                 # vencido
        prestamo(maria, amoladora, norte, 6, ahora + timedelta(hours=18))              # vence pronto
        prestamo(pedro, sierra, central, 12, ahora - timedelta(days=5), 8, 'Bueno')    # devuelto
        prestamo(jose, sierra, central, 1, ahora + timedelta(days=6))                  # de Jose (para probar devolución)

        generar_faltantes()

        self.stdout.write(self.style.SUCCESS('Datos de prueba cargados.'))
        self.stdout.write(f'Contraseña de todos los usuarios: {PASSWORD_DEMO}')
        self.stdout.write('  admin@bodega.cl       (administrador, también entra a /admin)')
        self.stdout.write('  bodeguero@bodega.cl   (bodeguero)')
        self.stdout.write('  trabajador@bodega.cl  (trabajador)')
        self.stdout.write('  rrhh@bodega.cl        (recursos humanos)')
        self.stdout.write('  nuevo@bodega.cl       (debe cambiar contraseña)')
