"""
Pruebas automáticas. Se ejecutan con:  python manage.py test
(Django crea una base de datos temporal, no toca tus datos)
"""
import base64
import io
import json
import threading

from django.core.management import call_command
from django.db import connection
from django.db.models import F
from django.test import Client, TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from bodegaApp.models import (Bodega, Categoria, Espacio, Item, MovimientoStock, Prestamo, Solicitud, Stock, Unidad,
                              Usuario)

PASS = 'Bodega#2026'


class ApiBodegaTests(TestCase):

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())  # carga los datos sin imprimir nada

    # Ayudantes
    def cat_id(self):
        return Categoria.objects.get(prefijo='HRM').id

    def bod_id(self):
        return Bodega.objects.get(nombre='Bodega Central').id

    def entrar(self, email):
        r = self.post('/api/login/', {'email': email, 'password': PASS})
        self.assertEqual(r.status_code, 200, r.content)

    def post(self, url, data=None):
        return self.client.post(url, json.dumps(data or {}), content_type='application/json')

    # ---- Sesión ----------------------------------------------------------
    def test_login_incorrecto(self):
        r = self.post('/api/login/', {'email': 'admin@bodega.cl', 'password': 'mala'})
        self.assertEqual(r.status_code, 400)

    def test_login_con_superusuario_y_mayusculas(self):
        # Usuario creado como con "createsuperuser": username sin @
        Usuario.objects.create_superuser('jefe', 'Jefe@Empresa.cl', 'Clave#12345')
        for texto in ['jefe', 'JEFE', 'jefe@empresa.cl', 'Jefe@Empresa.cl']:
            r = self.post('/api/login/', {'email': texto, 'password': 'Clave#12345'})
            self.assertEqual(r.status_code, 200, texto)
        r = self.post('/api/login/', {'email': 'ADMIN@bodega.cl', 'password': PASS})
        self.assertEqual(r.status_code, 200)

    def test_sin_sesion_da_401(self):
        self.assertEqual(self.client.get('/api/items/').status_code, 401)

    def test_cambiar_password_valida_requisitos(self):
        self.entrar('nuevo@bodega.cl')
        r = self.post('/api/cambiarPassword/', {'actual': PASS, 'nueva': 'corta', 'confirmar': 'corta'})
        self.assertEqual(r.status_code, 400)
        r = self.post('/api/cambiarPassword/', {'actual': PASS, 'nueva': 'Nueva#Clave9', 'confirmar': 'Nueva#Clave9'})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['usuario']['debe_cambiar_password'])

    # ---- Permisos --------------------------------------------------------
    def test_trabajador_no_puede_crear_bodega(self):
        self.entrar('trabajador@bodega.cl')
        self.assertEqual(self.post('/api/addBodega/', {'nombre': 'Bodega X'}).status_code, 403)

    # ---- CRUD ------------------------------------------------------------
    def test_crud_bodega(self):
        # [Bodegas reales] superficie en m² + espacios iniciales (2 estantes de 100 y un área de 300)
        self.entrar('admin@bodega.cl')
        datos = {'nombre': 'Bodega Este', 'ubicacion': 'Camino interior km 2', 'area_m2': 450,
                 'estantes': 2, 'capacidad_estante': 100, 'capacidad_area': 300}
        r = self.post('/api/addBodega/', datos)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['capacidad'], 500)
        self.assertEqual(r.json()['disponible'], 500)
        self.assertEqual((r.json()['estantes'], r.json()['areas']), (2, 1))
        id_ = r.json()['id']
        r = self.post(f'/api/editarBodega/{id_}/', {'nombre': 'Bodega Oeste', 'ubicacion': 'Camino interior km 2',
                                                    'area_m2': 800})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['area_m2'], 800)
        self.assertEqual(self.post(f'/api/deleteBodega/{id_}/').status_code, 200)

    def test_bodega_exige_ubicacion_superficie_y_espacios(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addBodega/', {'nombre': 'Bodega X'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('ubicacion', r.json()['errores'])
        self.assertIn('area_m2', r.json()['errores'])
        r = self.post('/api/addBodega/', {'nombre': 'Bodega X', 'ubicacion': 'Patio', 'area_m2': 50})
        self.assertIn('__all__', r.json()['errores'])   # sin estantes ni área no puede guardar nada

    def test_bodega_espacio_disponible(self):
        self.entrar('bodeguero@bodega.cl')
        bodegas = {b['nombre']: b for b in self.client.get('/api/bodegas/').json()['bodegas']}
        central = bodegas['Bodega Central']
        self.assertEqual(central['ocupado'], 2 + 340 + 58 + 3)
        self.assertEqual(central['disponible'], central['capacidad'] - central['ocupado'])
        self.assertEqual(central['ubicacion'], 'Galpón principal, Av. Los Robles 1450')

    def test_capacidad_no_menor_a_lo_guardado(self):
        self.entrar('admin@bodega.cl')
        estante = Espacio.objects.get(bodega__nombre='Bodega Central', nombre='Estante A')   # 340 tornillos
        r = self.post(f'/api/editarEspacio/{estante.id}/',
                      {'tipo': 'estante', 'nombre': 'Estante A', 'capacidad': 10})
        self.assertEqual(r.status_code, 400)
        self.assertIn('ya tiene', r.json()['errores']['capacidad'][0])

    def test_item_no_supera_capacidad_de_bodega(self):
        self.entrar('admin@bodega.cl')
        norte = Bodega.objects.get(nombre='Bodega Norte')
        r = self.post('/api/addItem/', {'nombre': 'Guantes', 'categoria': self.cat_id(), 'tipo': 'material', 'stock_minimo': 5,
                                        'bodega': norte.id, 'stock': 200})
        self.assertEqual(r.status_code, 400)
        self.assertIn('solo tiene espacio', r.json()['errores']['stock'][0])
        r = self.post('/api/addItem/', {'nombre': 'Guantes', 'categoria': self.cat_id(), 'tipo': 'material', 'stock_minimo': 5,
                                        'bodega': norte.id, 'stock': 145})
        self.assertEqual(r.status_code, 201, r.content)

    def test_no_elimina_bodega_con_prestamos_sin_error_500(self):
        self.entrar('admin@bodega.cl')
        norte = Bodega.objects.get(nombre='Bodega Norte')
        norte.stocks.update(cantidad=0)
        r = self.post(f'/api/deleteBodega/{norte.id}/')
        self.assertEqual(r.status_code, 400)
        self.assertIn('préstamos', r.json()['error'])

    def test_solicitud_sobre_stock_exige_motivo(self):
        amoladora = Item.objects.get(nombre__startswith='Amoladora')
        disponible = amoladora.stock_total()
        self.entrar('trabajador@bodega.cl')
        r = self.post('/api/addSolicitud/', {'sku': amoladora.sku, 'cantidad': disponible + 5, 'motivo': 'urgente'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('motivo', r.json()['errores'])
        r = self.post('/api/addSolicitud/', {'sku': amoladora.sku, 'cantidad': disponible + 5,
                                             'motivo': 'Obra nueva en faena norte, llegan 3 cuadrillas'})
        self.assertEqual(r.status_code, 201)
        sol = r.json()['solicitud']
        self.assertTrue(sol['excede_stock'])
        self.assertEqual(sol['stock_al_solicitar'], disponible)
        self.assertEqual(sol['faltan'], 5)
        r = self.post('/api/addSolicitud/', {'sku': amoladora.sku, 'cantidad': 1})
        self.assertEqual(r.status_code, 201)
        self.assertFalse(r.json()['solicitud']['excede_stock'])
        self.entrar('bodeguero@bodega.cl')
        r = self.post(f"/api/entregarSolicitud/{sol['id']}/")
        self.assertEqual(r.status_code, 400)
        self.assertIn('Faltan 5', r.json()['error'])
        grupos, _ = self.notif()
        self.assertTrue(any('supera el stock' in i['detalle'] for i in grupos['solicitudes']['items']))

    def test_solicitud_sin_stock_con_motivo(self):
        cemento = Item.objects.get(nombre__startswith='Cemento')
        self.entrar('trabajador@bodega.cl')
        r = self.post('/api/addSolicitud/', {'sku': cemento.sku, 'cantidad': 10})
        self.assertEqual(r.status_code, 400)
        r = self.post('/api/addSolicitud/', {'sku': cemento.sku, 'cantidad': 10,
                                             'motivo': 'Radier de la nueva sala de máquinas'})
        self.assertEqual(r.status_code, 201)

    def test_rrhh_gestiona_usuarios_pero_no_admins(self):
        self.entrar('rrhh@bodega.cl')
        usuarios = {u['correo']: u for u in self.client.get('/api/usuarios/').json()['usuarios']}
        self.assertFalse(usuarios['admin@bodega.cl']['puede_editar'])
        self.assertTrue(usuarios['luis.reyes@bodega.cl']['puede_editar'])
        datos = {'first_name': 'Ana', 'last_name': 'Rojas', 'email': 'ana@bodega.cl', 'telefono': '',
                 'rol': 'trabajador', 'password': 'Xr7#mQ2vLp'}
        self.assertEqual(self.post('/api/addUsuario/', datos).status_code, 201)
        r = self.post('/api/addUsuario/', {**datos, 'email': 'jefe@bodega.cl', 'rol': 'admin'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('rol', r.json()['errores'])
        admin = Usuario.objects.get(username='admin@bodega.cl')
        self.assertEqual(self.post(f'/api/resetPassword/{admin.id}/').status_code, 403)
        self.assertEqual(self.post(f'/api/editarUsuario/{admin.id}/', {'first_name': 'X', 'last_name': 'Y',
                         'email': admin.email, 'telefono': '', 'rol': 'admin', 'is_active': False}).status_code, 403)
        self.assertEqual(self.post(f'/api/deleteUsuario/{admin.id}/').status_code, 403)
        luis = Usuario.objects.get(username='luis.reyes@bodega.cl')
        r = self.post(f'/api/editarUsuario/{luis.id}/', {'first_name': 'Luis', 'last_name': 'Reyes',
                      'email': luis.email, 'telefono': '', 'rol': 'admin', 'is_active': True})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.post(f'/api/resetPassword/{luis.id}/').status_code, 200)
        roles = [r['valor'] for r in self.client.get('/api/roles/').json()['roles']]
        self.assertNotIn('admin', roles)
        self.assertIn('rrhh', roles)

    def test_rrhh_no_cambia_su_propio_rol(self):
        self.entrar('rrhh@bodega.cl')
        yo = Usuario.objects.get(username='rrhh@bodega.cl')
        r = self.post(f'/api/editarUsuario/{yo.id}/', {'first_name': 'Fernanda', 'last_name': 'Rojas',
                      'email': yo.email, 'telefono': '', 'rol': 'trabajador', 'is_active': True})
        self.assertEqual(r.status_code, 400)

    def test_admin_puede_crear_rrhh(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addUsuario/', {'first_name': 'Rosa', 'last_name': 'Paz', 'email': 'rosa@bodega.cl',
                                           'telefono': '', 'rol': 'rrhh', 'password': 'Xr7#mQ2vLp'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['usuario']['rol'], 'rrhh')

    def test_rrhh_no_opera_la_bodega(self):
        self.entrar('rrhh@bodega.cl')
        self.assertEqual(self.post('/api/addBodega/', {'nombre': 'X', 'ubicacion': 'Y', 'capacidad': 5}).status_code, 403)
        self.assertEqual(self.post('/api/addItem/', {'nombre': 'X'}).status_code, 403)
        sol = Solicitud.objects.filter(estado='Pendiente').first()
        self.assertEqual(self.post(f'/api/entregarSolicitud/{sol.id}/').status_code, 403)
        prestamo = Prestamo.objects.filter(fecha_devolucion__isnull=True).first()
        r = self.post(f'/api/devolverPrestamo/{prestamo.id}/', {'estado_devolucion': 'Bueno',
                      'comentario': 'Devuelto sin problemas, todo funcionando correctamente.'})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.client.get('/api/prestamos/').json()['prestamos'], [])
        self.assertEqual(self.client.get('/api/solicitudes/').json()['solicitudes'], [])

    def test_rrhh_reportes_de_personas(self):
        self.entrar('rrhh@bodega.cl')
        for tipo in ['usuarios', 'prestamos', 'solicitudes']:
            self.assertEqual(self.client.get(f'/api/reportes/{tipo}/').status_code, 200, tipo)
        for tipo in ['items', 'bodegas']:
            self.assertEqual(self.client.get(f'/api/reportes/{tipo}/').status_code, 403, tipo)
        data = self.reporte('usuarios', rol='rrhh')
        self.assertEqual([f[1] for f in data['filas']], ['rrhh@bodega.cl'])

    def test_rrhh_inicio_y_notificaciones(self):
        self.entrar('rrhh@bodega.cl')
        resumen = self.client.get('/api/resumen/').json()
        self.assertEqual(resumen['claves_temporales'], 1)
        self.assertEqual(resumen['prestamos_vencidos'], 1)         # taladro de Luis
        self.assertEqual(resumen['prestamos_activos'], 0)
        grupos, _ = self.notif()
        self.assertIn('claves', grupos)
        self.assertIn('vencidos', grupos)
        self.assertNotIn('stock', grupos)
        self.assertNotIn('solicitudes', grupos)

    def test_admin_pide_materiales_y_ve_solo_los_suyos(self):
        self.entrar('admin@bodega.cl')
        casco = Item.objects.get(nombre__startswith='Casco')
        r = self.post('/api/addSolicitud/', {'sku': casco.sku, 'cantidad': 2, 'motivo': 'Visita a faena'})
        self.assertEqual(r.status_code, 201)
        todas = self.client.get('/api/solicitudes/').json()['solicitudes']
        mias = self.client.get('/api/solicitudes/?mias=1').json()['solicitudes']
        self.assertGreater(len(todas), len(mias))
        self.assertEqual([s['producto'] for s in mias], [casco.nombre])
        self.assertEqual(self.client.get('/api/prestamos/?mias=1').json()['prestamos'], [])
        self.assertTrue(self.client.get('/api/prestamos/').json()['prestamos'])
        resumen = self.client.get('/api/resumen/').json()
        self.assertEqual(resumen['mis_solicitudes_pendientes'], 1)
        self.assertIn('usuarios_activos', resumen)
        self.assertIn('criticos', resumen)

    def test_admin_registra_devolucion_de_otro(self):
        self.entrar('admin@bodega.cl')
        prestamo = Prestamo.objects.filter(fecha_devolucion__isnull=True).first()
        datos = {'estado_devolucion': 'Bueno', 'comentario': 'Recibida en bodega por el administrador, sin observaciones.'}
        self.assertEqual(self.post(f'/api/devolverPrestamo/{prestamo.id}/', datos).status_code, 400)
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/', {**datos, 'unidades': self.codigos(prestamo)})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['prestamo']['activo'])
        self.assertEqual(self.client.get(f'/api/prestamos/{prestamo.id}/').json()['prestamo']['trabajador_id'],
                         prestamo.trabajador_id)

    def test_admin_recibe_avisos_de_bodega_y_de_personas(self):
        self.entrar('admin@bodega.cl')
        grupos, _ = self.notif()
        for g in ['solicitudes', 'vencidos', 'stock', 'claves', 'nuevos']:
            self.assertIn(g, grupos)

    def reporte(self, nombre_reporte, **filtros):
        r = self.client.get(f'/api/reportes/{nombre_reporte}/', filtros)
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        for fila in data['filas']:
            self.assertEqual(len(fila), len(data['columnas']))
        return data

    def disponibles_por_bodega(self, item):
        conteo = {}
        for u in item.unidades.filter(estado='Disponible'):
            conteo[u.bodega.nombre] = conteo.get(u.bodega.nombre, 0) + 1
        return conteo

    def stock_por_bodega(self, item):
        return {s.bodega.nombre: s.cantidad for s in item.stocks.all() if s.cantidad}

    def test_crear_herramienta_genera_un_codigo_por_unidad(self):
        self.entrar('admin@bodega.cl')
        central = Bodega.objects.get(nombre='Bodega Central')
        r = self.post('/api/addItem/', {'nombre': 'Esmeril', 'categoria': self.cat_id(), 'tipo': 'herramienta',
                                        'stock_minimo': 1, 'bodega': central.id, 'stock': 3})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['unidades_creadas'], 3)
        sku = r.json()['item']['sku']
        codigos = list(Unidad.objects.filter(item__sku=sku).values_list('codigo', flat=True))
        self.assertEqual(codigos, [f'{sku}-001', f'{sku}-002', f'{sku}-003'])
        r = self.post('/api/addItem/', {'nombre': 'Guantes', 'categoria': self.cat_id(), 'tipo': 'material',
                                        'stock_minimo': 1, 'bodega': central.id, 'stock': 50})
        self.assertFalse(Unidad.objects.filter(item__sku=r.json()['item']['sku']).exists())

    def test_editar_stock_de_herramienta_crea_o_da_de_baja_unidades(self):
        self.entrar('admin@bodega.cl')
        sierra = Item.objects.get(nombre='Sierra circular')
        central = Bodega.objects.get(nombre='Bodega Central')
        datos = {'nombre': sierra.nombre, 'categoria': sierra.categoria_id, 'tipo': 'herramienta',
                 'stock_minimo': 1, 'bodega': central.id}
        self.assertEqual(self.post(f'/api/editarItem/{sierra.sku}/', {**datos, 'stock': 5}).status_code, 200)
        self.assertEqual(self.disponibles_por_bodega(sierra), {'Bodega Central': 5})
        self.assertEqual(self.post(f'/api/editarItem/{sierra.sku}/', {**datos, 'stock': 2}).status_code, 200)
        self.assertEqual(self.disponibles_por_bodega(sierra), {'Bodega Central': 2})
        self.assertEqual(sierra.unidades.filter(estado='De baja').count(), 3)
        self.assertEqual(self.stock_por_bodega(sierra), self.disponibles_por_bodega(sierra))

    def test_no_cambia_tipo_si_hay_stock(self):
        self.entrar('admin@bodega.cl')
        sierra = Item.objects.get(nombre='Sierra circular')
        r = self.post(f'/api/editarItem/{sierra.sku}/', {'nombre': sierra.nombre, 'categoria': sierra.categoria_id,
                                                        'tipo': 'material', 'stock_minimo': 1})
        self.assertEqual(r.status_code, 400)
        self.assertIn('tipo', r.json()['errores'])

    def test_datos_iniciales_tienen_codigos_cuadrados_con_el_stock(self):
        for item in Item.objects.filter(tipo='herramienta'):
            self.assertEqual(self.stock_por_bodega(item), self.disponibles_por_bodega(item), item.nombre)
            for p in item.prestamos.filter(fecha_devolucion__isnull=True):
                self.assertEqual(p.unidades.filter(estado='Prestada').count(), p.cantidad)

    def test_entregar_herramienta_con_unidades_escaneadas(self):
        amoladora = Item.objects.get(nombre__startswith='Amoladora')
        sol = Solicitud.objects.get(item=amoladora, estado='Pendiente')
        elegida = amoladora.unidades.filter(estado='Disponible').last()
        self.entrar('bodeguero@bodega.cl')
        otra = Item.objects.get(nombre='Sierra circular').unidades.filter(estado='Disponible').first()
        r = self.post(f'/api/entregarSolicitud/{sol.id}/', {'unidades': [otra.codigo]})
        self.assertEqual(r.status_code, 400)
        self.assertIn(otra.codigo, r.json()['error'])
        r = self.post(f'/api/entregarSolicitud/{sol.id}/', {'unidades': []})
        self.assertIn('exactamente 1', r.json()['error'])
        r = self.post(f'/api/entregarSolicitud/{sol.id}/', {'unidades': [elegida.codigo.lower()]})
        self.assertEqual(r.status_code, 200, r.content)
        elegida.refresh_from_db()
        self.assertEqual(elegida.estado, 'Prestada')
        prestamo = Prestamo.objects.get(solicitud=sol)
        self.assertEqual([u.codigo for u in prestamo.unidades.all()], [elegida.codigo])
        self.assertEqual(self.stock_por_bodega(amoladora), self.disponibles_por_bodega(amoladora))
        prestamos = self.client.get('/api/prestamos/').json()['prestamos']
        self.assertTrue(any(elegida.codigo in p['unidades'] for p in prestamos))

    def codigos(self, prestamo):
        return [u.codigo for u in prestamo.unidades.all()]

    def test_entregar_herramienta_exige_escanear(self):
        amoladora = Item.objects.get(nombre__startswith='Amoladora')
        sol = Solicitud.objects.get(item=amoladora, estado='Pendiente')
        self.entrar('bodeguero@bodega.cl')
        r = self.post(f'/api/entregarSolicitud/{sol.id}/')
        self.assertEqual(r.status_code, 400)
        self.assertIn('Escanea', r.json()['error'])
        self.assertEqual(Solicitud.objects.get(id=sol.id).estado, 'Pendiente')

    def test_devolucion_en_dos_pasos_aviso_y_recepcion_escaneada(self):
        prestamo = Prestamo.objects.get(trabajador__username='trabajador@bodega.cl', fecha_devolucion__isnull=True)
        unidad = prestamo.unidades.get()
        stock_antes = prestamo.item.stock_total()
        self.entrar('trabajador@bodega.cl')
        aviso = {'estado_devolucion': 'Regular', 'comentario': 'Funcionó, pero el disco quedó algo gastado.'}
        r = self.post(f'/api/devolverPrestamo/{prestamo.id}/', aviso)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['prestamo']['por_recibir'])
        self.assertEqual(r.json()['prestamo']['estado'], 'Por recibir')
        unidad.refresh_from_db()
        self.assertEqual(unidad.estado, 'Prestada')
        self.assertEqual(prestamo.item.stock_total(), stock_antes)
        self.assertEqual(self.post(f'/api/devolverPrestamo/{prestamo.id}/', aviso).status_code, 400)
        self.assertEqual(self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': [unidad.codigo]}).status_code, 403)

        self.entrar('bodeguero@bodega.cl')
        grupos, _ = self.notif()
        self.assertEqual(grupos['por_recibir']['cantidad'], 1)
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/')
        self.assertIn('Escanea', r.json()['error'])
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': []})
        self.assertIn('Falta escanear', r.json()['error'])
        otra = Unidad.objects.exclude(id=unidad.id).filter(estado='Prestada').first()
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': [unidad.codigo, otra.codigo]})
        self.assertIn('no son de este préstamo', r.json()['error'])
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': [unidad.codigo.lower()]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['prestamo']['estado'], 'Regular')
        unidad.refresh_from_db()
        self.assertEqual(unidad.estado, 'Disponible')
        self.assertEqual(prestamo.item.stock_total(), stock_antes + 1)
        self.assertEqual(self.stock_por_bodega(prestamo.item), self.disponibles_por_bodega(prestamo.item))
        self.assertEqual(self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': [unidad.codigo]}).status_code, 400)

    def test_recibir_sin_aviso_del_trabajador_exige_estado_y_comentario(self):
        prestamo = Prestamo.objects.get(trabajador__username='trabajador@bodega.cl', fecha_devolucion__isnull=True)
        self.entrar('bodeguero@bodega.cl')
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': self.codigos(prestamo)})
        self.assertEqual(r.status_code, 400)
        self.assertIn('comentario', r.json()['errores'])
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': self.codigos(prestamo),
                      'estado_devolucion': 'Con falla', 'comentario': 'El trabajador la dejó con el cable dañado.'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['prestamo']['estado'], 'Con falla')

    def test_recibir_con_falla_no_suma_stock_disponible(self):
        prestamo = Prestamo.objects.get(trabajador__username='trabajador@bodega.cl', fecha_devolucion__isnull=True)
        stock_antes = prestamo.item.stock_total()
        codigos = self.codigos(prestamo)
        self.entrar('bodeguero@bodega.cl')
        r = self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': codigos,
                      'estado_devolucion': 'Con falla', 'comentario': 'Motor quemado.'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(prestamo.item.stock_total(), stock_antes)
        self.assertEqual(set(Unidad.objects.filter(codigo__in=codigos).values_list('estado', flat=True)), {'De baja'})
        self.assertEqual(self.stock_por_bodega(prestamo.item), self.disponibles_por_bodega(prestamo.item))
        r = self.post(f'/api/reactivarUnidad/{codigos[0]}/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(prestamo.item.stock_total(), stock_antes + 1)

    def test_baja_reactivar_y_buscar_por_codigo(self):
        sierra = Item.objects.get(nombre='Sierra circular')
        unidad = sierra.unidades.filter(estado='Disponible').first()
        prestada = sierra.unidades.filter(estado='Prestada').first()
        self.entrar('trabajador@bodega.cl')
        self.assertEqual(self.post(f'/api/bajaUnidad/{unidad.codigo}/').status_code, 403)
        self.entrar('bodeguero@bodega.cl')
        r = self.client.get(f'/api/unidades/{unidad.codigo.lower()}/')
        self.assertEqual(r.json()['unidad']['sku'], sierra.sku)
        r = self.client.get(f'/api/unidades/{prestada.codigo}/')
        self.assertEqual(r.json()['unidad']['prestada_a'], 'Jose Perez')
        self.assertEqual(self.client.get('/api/unidades/NO-EXISTE/').status_code, 404)
        self.assertEqual(self.post(f'/api/bajaUnidad/{prestada.codigo}/').status_code, 400)
        antes = sierra.stock_total()
        self.assertEqual(self.post(f'/api/bajaUnidad/{unidad.codigo}/').status_code, 200)
        self.assertEqual(sierra.stock_total(), antes - 1)
        self.assertEqual(self.post(f'/api/reactivarUnidad/{unidad.codigo}/').status_code, 200)
        self.assertEqual(sierra.stock_total(), antes)
        lista = self.client.get(f'/api/items/{sierra.sku}/unidades/').json()['unidades']
        self.assertEqual(len(lista), sierra.unidades.count())
        self.assertEqual(len(self.client.get(f'/api/items/{sierra.sku}/unidades/?estado=Prestada').json()['unidades']), 1)

    def test_reporte_usuarios_filtra_por_rol_y_estado(self):
        Usuario.objects.filter(username='pedro.vidal@bodega.cl').update(is_active=False)
        self.entrar('admin@bodega.cl')
        data = self.reporte('usuarios', rol='bodeguero')
        self.assertEqual([f[1] for f in data['filas']], ['bodeguero@bodega.cl'])
        self.assertEqual(data['resumen'][0]['valor'], 1)
        self.assertIn('Rol: Bodeguero', data['filtros'])
        data = self.reporte('usuarios', estado='inactivos')
        self.assertEqual([f[1] for f in data['filas']], ['pedro.vidal@bodega.cl'])
        todos = self.reporte('usuarios', estado='todos')
        self.assertEqual(len(todos['filas']), Usuario.objects.count())

    def test_reporte_items_filtros(self):
        self.entrar('admin@bodega.cl')
        data = self.reporte('items', tipo='herramienta')
        self.assertTrue(data['filas'])
        self.assertTrue(all(f[3] == 'Herramienta' for f in data['filas']))
        data = self.reporte('items', estado='Sin stock')
        self.assertEqual([f[1] for f in data['filas']], ['Cemento gris 25kg'])
        norte = Bodega.objects.get(nombre='Bodega Norte')
        data = self.reporte('items', bodega=norte.id)
        self.assertIn('Bodega Norte', data['columnas'])
        self.assertNotIn('Bodega Central', data['columnas'])
        self.assertEqual(data['resumen'][1]['valor'], norte.ocupado())

    def test_reporte_prestamos_y_solicitudes(self):
        self.entrar('admin@bodega.cl')
        self.assertEqual(self.reporte('prestamos', estado='vencidos')['resumen'][0]['valor'], 1)
        self.assertEqual(len(self.reporte('prestamos', estado='devueltos')['filas']), 1)
        data = self.reporte('solicitudes', estado='Pendiente')
        self.assertTrue(all(f[9] == 'Pendiente' for f in data['filas']))
        self.assertEqual(len(self.reporte('solicitudes', excede='si')['filas']), 0)

    def test_reporte_filtro_fechas(self):
        self.entrar('admin@bodega.cl')
        hoy = timezone.localdate()
        data = self.reporte('prestamos', desde=(hoy - timezone.timedelta(days=2)).isoformat(), hasta=hoy.isoformat())
        self.assertEqual(len(data['filas']), 1)
        r = self.client.get('/api/reportes/prestamos/', {'desde': '2026-13-01'})
        self.assertEqual(r.status_code, 400)
        r = self.client.get('/api/reportes/prestamos/', {'desde': '2026-11-10', 'hasta': '2026-11-01'})
        self.assertEqual(r.status_code, 400)
        r = self.client.get('/api/reportes/items/', {'bodega': '999'})
        self.assertEqual(r.status_code, 400)

    def test_no_elimina_categoria_con_productos(self):
        self.entrar('admin@bodega.cl')
        cats = self.client.get('/api/categorias/').json()['categorias']
        con_productos = next(c for c in cats if c['productos'] > 0)
        self.assertEqual(self.post(f"/api/deleteCategoria/{con_productos['id']}/").status_code, 400)

    def test_item_stock_negativo(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addItem/', {'nombre': 'Martillo', 'categoria': self.cat_id(), 'tipo': 'herramienta',
                                         'stock_minimo': 2, 'bodega': self.bod_id(), 'stock': -1})
        self.assertEqual(r.status_code, 400)
        self.assertIn('stock', r.json()['errores'])

    def test_item_genera_sku(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addItem/', {'nombre': 'Martillo', 'categoria': self.cat_id(), 'tipo': 'herramienta',
                                         'stock_minimo': 2, 'bodega': self.bod_id(), 'stock': 10})
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.json()['item']['sku'].startswith('HRM-'))

    def test_crear_usuario_valida_telefono(self):
        self.entrar('admin@bodega.cl')
        datos = {'first_name': 'Ana', 'last_name': 'Rojas', 'email': 'ana@bodega.cl',
                 'telefono': '12345', 'rol': 'trabajador', 'password': 'Xr7#mQ2vLp'}
        self.assertEqual(self.post('/api/addUsuario/', datos).status_code, 400)
        datos['telefono'] = '9 8765 4321'
        r = self.post('/api/addUsuario/', datos)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['usuario']['telefono'], '+56987654321')

    # ---- Flujo completo: solicitar -> entregar -> devolver ---------------
    def test_flujo_solicitud_prestamo_devolucion(self):
        amoladora = Item.objects.get(nombre__startswith='Amoladora')
        stock_inicial = amoladora.stock_total()

        self.entrar('trabajador@bodega.cl')
        r = self.post('/api/addSolicitud/', {'sku': amoladora.sku, 'cantidad': 99})
        self.assertEqual(r.status_code, 400)  # más de lo disponible
        r = self.post('/api/addSolicitud/', {'sku': amoladora.sku, 'cantidad': 1, 'motivo': 'Corte'})
        self.assertEqual(r.status_code, 201)
        id_sol = r.json()['solicitud']['id']

        self.entrar('bodeguero@bodega.cl')
        codigo = amoladora.unidades.filter(estado='Disponible').first().codigo
        self.assertEqual(self.post(f'/api/entregarSolicitud/{id_sol}/', {'unidades': [codigo]}).status_code, 200)
        self.assertEqual(amoladora.stock_total(), stock_inicial - 1)
        prestamo = Prestamo.objects.get(solicitud_id=id_sol)

        self.entrar('trabajador@bodega.cl')
        r = self.post(f'/api/devolverPrestamo/{prestamo.id}/', {'estado_devolucion': 'Bueno', 'comentario': 'corto'})
        self.assertEqual(r.status_code, 400)  # comentario de menos de 30 caracteres
        r = self.post(f'/api/devolverPrestamo/{prestamo.id}/', {
            'estado_devolucion': 'Regular', 'comentario': 'Funcionó bien pero el disco viene algo gastado.'})
        self.assertEqual(r.status_code, 200)
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(self.post(f'/api/recibirPrestamo/{prestamo.id}/', {'unidades': [codigo]}).status_code, 200)
        self.assertEqual(amoladora.stock_total(), stock_inicial)
        self.assertEqual(Solicitud.objects.get(id=id_sol).estado, 'Despachada')

    # ---- Reportes --------------------------------------------------------
    def test_reportes_solo_admin(self):
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(self.client.get('/api/reportes/usuarios/').status_code, 403)
        self.entrar('admin@bodega.cl')
        self.assertEqual(self.client.get('/api/reportes/inventado/').status_code, 404)

    def test_reporte_usuarios_solo_activos(self):
        Usuario.objects.filter(username='pedro.vidal@bodega.cl').update(is_active=False)
        self.entrar('admin@bodega.cl')
        data = self.client.get('/api/reportes/usuarios/').json()
        correos = [fila[1] for fila in data['filas']]
        self.assertIn('admin@bodega.cl', correos)
        self.assertNotIn('pedro.vidal@bodega.cl', correos)
        self.assertEqual(len(data['columnas']), len(data['filas'][0]))

    def test_reporte_bodegas(self):
        self.entrar('admin@bodega.cl')
        data = self.client.get('/api/reportes/bodegas/').json()
        central = next(f for f in data['filas'] if f[0] == 'Bodega Central')
        col = data['columnas'].index('Unidades en stock')
        self.assertEqual(central[col], 2 + 340 + 58 + 3)  # unidades en stock de la Bodega Central
        self.assertEqual(central[data['columnas'].index('Capacidad')], 1000)   # suma de sus estantes y áreas

    def test_reporte_items_tiene_columna_por_bodega(self):
        self.entrar('admin@bodega.cl')
        data = self.client.get('/api/reportes/items/').json()
        for b in Bodega.objects.all():
            self.assertIn(b.nombre, data['columnas'])
        self.assertEqual(len(data['filas']), Item.objects.count())

    # ---- CRUD de usuarios -----------------------------------------------
    def test_crud_usuario_completo(self):
        self.entrar('admin@bodega.cl')
        datos = {'first_name': 'Ana', 'last_name': 'Rojas', 'email': 'ana@bodega.cl',
                 'telefono': '987654321', 'rol': 'trabajador', 'password': 'Xr7#mQ2vLp'}
        id_ = self.post('/api/addUsuario/', datos).json()['usuario']['id']
        # leer
        self.assertEqual(self.client.get(f'/api/usuarios/{id_}/').json()['usuario']['correo'], 'ana@bodega.cl')
        # editar (cambia correo y rol; el correo nuevo sirve para entrar)
        r = self.post(f'/api/editarUsuario/{id_}/', {'first_name': 'Ana', 'last_name': 'Rojas Paz',
                                                     'email': 'ana.rojas@bodega.cl', 'telefono': '987654321',
                                                     'rol': 'bodeguero', 'is_active': True})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Usuario.objects.get(id=id_).username, 'ana.rojas@bodega.cl')
        self.assertEqual(r.json()['usuario']['rol'], 'bodeguero')
        # eliminar (no tiene historial)
        self.assertEqual(self.post(f'/api/deleteUsuario/{id_}/').status_code, 200)
        # [Soft delete] la fila sigue en la base, pero eliminada e inactiva
        ana = Usuario.objects.get(id=id_)
        self.assertIsNotNone(ana.eliminado_en)
        self.assertFalse(ana.is_active)

    def test_correo_duplicado_al_editar(self):
        self.entrar('admin@bodega.cl')
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        r = self.post(f'/api/editarUsuario/{jose.id}/', {'first_name': 'Jose', 'last_name': 'Perez',
                                                         'email': 'bodeguero@bodega.cl', 'telefono': ''})
        self.assertEqual(r.status_code, 400)
        self.assertIn('email', r.json()['errores'])

    def test_desactivar_impide_entrar(self):
        self.entrar('admin@bodega.cl')
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        r = self.post(f'/api/editarUsuario/{jose.id}/', {'first_name': 'Jose', 'last_name': 'Perez',
                                                         'email': jose.email, 'telefono': jose.telefono,
                                                         'is_active': False})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['usuario']['activo'])
        r = self.post('/api/login/', {'email': 'trabajador@bodega.cl', 'password': PASS})
        self.assertEqual(r.status_code, 400)

    def test_soft_delete_usuario_conserva_historial(self):
        # [Soft delete] Antes no se podía eliminar a alguien con historial; ahora se elimina de forma
        # lógica: desaparece de la lista y no puede entrar, pero sus solicitudes siguen ahí.
        self.entrar('admin@bodega.cl')
        # Pedro tiene historial (un préstamo ya devuelto) y ninguna herramienta pendiente
        luis = Usuario.objects.get(username='pedro.vidal@bodega.cl')
        solicitudes = luis.solicitudes.count()
        self.assertGreater(solicitudes, 0)
        self.assertEqual(self.post(f'/api/deleteUsuario/{luis.id}/').status_code, 200)
        luis.refresh_from_db()
        self.assertIsNotNone(luis.eliminado_en)
        self.assertEqual(luis.solicitudes.count(), solicitudes)
        ids = [u['id'] for u in self.client.get('/api/usuarios/').json()['usuarios']]
        self.assertNotIn(luis.id, ids)
        papelera = [u['id'] for u in self.client.get('/api/usuarios/?eliminados=1').json()['usuarios']]
        self.assertIn(luis.id, papelera)
        r = self.post('/api/login/', {'email': 'pedro.vidal@bodega.cl', 'password': PASS})
        self.assertEqual(r.status_code, 400)
        # La cuenta se puede restaurar con su mismo correo
        self.entrar('admin@bodega.cl')
        self.assertEqual(self.post(f'/api/restaurarUsuario/{luis.id}/').status_code, 200)
        luis.refresh_from_db()
        self.assertEqual(luis.username, 'pedro.vidal@bodega.cl')

    def test_no_elimina_usuario_con_herramientas_sin_devolver(self):
        self.entrar('admin@bodega.cl')
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        self.assertTrue(jose.prestamos.filter(fecha_devolucion__isnull=True).exists())
        self.assertEqual(self.post(f'/api/deleteUsuario/{jose.id}/').status_code, 400)

    def test_admin_no_se_bloquea_a_si_mismo(self):
        self.entrar('admin@bodega.cl')
        yo = Usuario.objects.get(username='admin@bodega.cl')
        self.assertEqual(self.post(f'/api/deleteUsuario/{yo.id}/').status_code, 400)
        r = self.post(f'/api/editarUsuario/{yo.id}/', {'first_name': 'A', 'last_name': 'S', 'email': yo.email,
                                                       'rol': 'trabajador'})
        self.assertEqual(r.status_code, 400)

    def test_reset_password(self):
        self.entrar('admin@bodega.cl')
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        temporal = self.post(f'/api/resetPassword/{jose.id}/').json()['password_temporal']
        r = self.post('/api/login/', {'email': 'trabajador@bodega.cl', 'password': temporal})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['usuario']['debe_cambiar_password'])

    def test_crud_usuarios_solo_admin(self):
        self.entrar('bodeguero@bodega.cl')
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        self.assertEqual(self.post(f'/api/deleteUsuario/{jose.id}/').status_code, 403)
        self.assertEqual(self.post(f'/api/resetPassword/{jose.id}/').status_code, 403)

    # ---- Cambiar contraseña desde Mi perfil -----------------------------
    def test_cambiar_password_desde_perfil(self):
        self.entrar('trabajador@bodega.cl')
        r = self.post('/api/cambiarPassword/', {'actual': PASS, 'nueva': PASS, 'confirmar': PASS})
        self.assertEqual(r.status_code, 400)  # igual a la actual
        r = self.post('/api/cambiarPassword/', {'actual': PASS, 'nueva': 'OtraClave#77', 'confirmar': 'OtraClave#77'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get('/api/yo/').status_code, 200)  # sigue con sesión

    # ---- Optimización: las consultas SQL no crecen con los datos ---------
    def contar_consultas(self, url):
        with CaptureQueriesContext(connection) as q:
            self.assertEqual(self.client.get(url).status_code, 200)
        return len(q)

    def test_listado_usuarios_sin_n_mas_1(self):
        self.entrar('admin@bodega.cl')
        antes = self.contar_consultas('/api/usuarios/')
        for i in range(15):
            Usuario.objects.create_user(f'extra{i}@bodega.cl', f'extra{i}@bodega.cl', 'Clave#12345')
        self.assertEqual(self.contar_consultas('/api/usuarios/'), antes)

    def test_resumen_criticos_igual_que_estado(self):
        self.entrar('admin@bodega.cl')
        # Regla unificada: "críticos" = Sin stock + Crítico (los mismos que muestra la campana)
        esperado = sum(1 for i in Item.objects.all() if i.estado() in ('Sin stock', 'Crítico'))
        self.assertEqual(self.client.get('/api/resumen/').json()['criticos'], esperado)
        antes = self.contar_consultas('/api/resumen/')
        cat = Categoria.objects.first()
        for i in range(15):
            Item.objects.create(nombre=f'Extra {i}', categoria=cat)
        self.assertEqual(self.contar_consultas('/api/resumen/'), antes)

    # ---- Historial del trabajador ----------------------------------------
    def test_trabajador_solo_ve_lo_suyo_y_separado_por_tipo(self):
        self.entrar('trabajador@bodega.cl')
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        self.post('/api/addSolicitud/', {'sku': tornillo.sku, 'cantidad': 10})
        prestamos = self.client.get('/api/prestamos/').json()['prestamos']
        self.assertTrue(prestamos)
        self.assertTrue(all(p['trabajador'] == jose.nombre_completo() for p in prestamos))
        solicitudes = self.client.get('/api/solicitudes/').json()['solicitudes']
        self.assertTrue(all(s['trabajador'] == jose.nombre_completo() for s in solicitudes))
        self.assertIn('material', {s['tipo'] for s in solicitudes})
        # Home: números propios
        resumen = self.client.get('/api/resumen/').json()
        self.assertEqual(resumen['prestamos_activos'],
                         Prestamo.objects.filter(trabajador=jose, fecha_devolucion__isnull=True).count())
        self.assertEqual(resumen['solicitudes_pendientes'], 1)

    def test_bodeguero_ve_prestamos_globales(self):
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(len(self.client.get('/api/prestamos/').json()['prestamos']), Prestamo.objects.count())

    # ---- Notificaciones ---------------------------------------------------
    def notif(self):
        r = self.client.get('/api/notificaciones/')
        self.assertEqual(r.status_code, 200)
        return {g['tipo']: g for g in r.json()['grupos']}, r.json()['total']

    def test_notificaciones_bodeguero(self):
        self.entrar('bodeguero@bodega.cl')
        grupos, total = self.notif()
        self.assertEqual(grupos['solicitudes']['cantidad'], 1)   # la de María
        self.assertEqual(grupos['vencidos']['cantidad'], 1)      # taladro de Luis
        self.assertEqual(grupos['por_vencer']['cantidad'], 1)    # amoladora de María
        self.assertIn('stock', grupos)                           # cemento sin stock, taladro crítico
        self.assertNotIn('claves', grupos)                       # eso es solo del admin
        self.assertEqual(total, sum(g['cantidad'] for g in grupos.values()))

    def test_notificaciones_admin_ve_claves_temporales(self):
        self.entrar('admin@bodega.cl')
        grupos, _ = self.notif()
        self.assertEqual(grupos['claves']['items'][0]['detalle'], 'nuevo@bodega.cl')

    def test_notificaciones_trabajador_solo_lo_suyo(self):
        self.entrar('trabajador@bodega.cl')
        grupos, _ = self.notif()
        self.assertNotIn('solicitudes', grupos)                  # no ve las de otros
        self.assertNotIn('vencidos', grupos)                     # su sierra no está vencida
        self.assertEqual(grupos['recibidas']['items'][0]['texto'], 'Sierra circular')
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        self.post('/api/addSolicitud/', {'sku': tornillo.sku, 'cantidad': 5})
        grupos, _ = self.notif()
        self.assertEqual(grupos['mis_pendientes']['cantidad'], 1)

    def test_notificaciones_consultas_fijas(self):
        self.entrar('admin@bodega.cl')
        antes = self.contar_consultas('/api/notificaciones/')
        cat = Categoria.objects.first()
        for i in range(10):
            Item.objects.create(nombre=f'Agotado {i}', categoria=cat)
        self.assertEqual(self.contar_consultas('/api/notificaciones/'), antes)


# ===========================================================================
# PRUEBAS DE LAS MEJORAS DE LA AUDITORÍA
# ===========================================================================
class MejorasAuditoriaTests(TestCase):

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())
        from django.core.cache import cache
        cache.clear()

    def entrar(self, email):
        self.client.force_login(Usuario.objects.get(username=email))

    def post(self, url, data=None):
        return self.client.post(url, json.dumps(data if data is not None else {}), content_type='application/json')

    def test_entrega_registra_kardex(self):
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        sol = Solicitud.objects.create(trabajador=Usuario.objects.get(username='trabajador@bodega.cl'),
                                       item=tornillo, cantidad=40)
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(self.post(f'/api/entregarSolicitud/{sol.id}/').status_code, 200)
        mov = MovimientoStock.objects.get(solicitud=sol)
        self.assertEqual((mov.tipo, mov.cantidad, mov.saldo), ('entrega', -40, 300))
        self.assertEqual(mov.usuario.username, 'bodeguero@bodega.cl')
        r = self.client.get(f'/api/movimientos/?sku={tornillo.sku}')
        self.assertEqual(r.json()['movimientos'][0]['cantidad'], -40)

    def test_edicion_con_stock_desactualizado_da_409(self):
        # [Control optimista] El usuario vio 340, pero mientras tanto se entregaron 40
        self.entrar('admin@bodega.cl')
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        central = Bodega.objects.get(nombre='Bodega Central')
        Stock.objects.filter(item=tornillo, bodega=central).update(cantidad=300)
        datos = {'nombre': tornillo.nombre, 'categoria': tornillo.categoria_id, 'tipo': 'material',
                 'stock_minimo': 50, 'bodega': central.id, 'stock': 280, 'stock_esperado': 340}
        r = self.post(f'/api/editarItem/{tornillo.sku}/', datos)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(Stock.objects.get(item=tornillo, bodega=central).cantidad, 300)   # no se pisó
        r = self.post(f'/api/editarItem/{tornillo.sku}/', {**datos, 'stock_esperado': 300})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(MovimientoStock.objects.get(item=tornillo, tipo='ajuste').cantidad, -20)

    def test_json_que_no_es_objeto_no_da_500(self):
        self.entrar('admin@bodega.cl')
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        r = self.client.post(f'/api/editarItem/{tornillo.sku}/', '[1, 2]', content_type='application/json')
        self.assertEqual(r.status_code, 400)   # antes: TypeError -> error 500
        self.assertIn('nombre', r.json()['errores'])

    def test_login_bloquea_tras_intentos_fallidos(self):
        for _ in range(5):
            r = self.post('/api/login/', {'email': 'admin@bodega.cl', 'password': 'mala'})
            self.assertEqual(r.status_code, 400)
        r = self.post('/api/login/', {'email': 'admin@bodega.cl', 'password': PASS})
        self.assertEqual(r.status_code, 429)   # bloqueado aunque ahora la clave sea correcta

    def test_roles_requiere_sesion(self):
        self.assertEqual(self.client.get('/api/roles/').status_code, 401)

    def test_codigo_con_formato_invalido_da_404(self):
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(self.client.get('/api/unidades/%3Cscript%3E/').status_code, 404)

    def test_soft_delete_item_y_categoria(self):
        self.entrar('admin@bodega.cl')
        cemento = Item.objects.get(nombre__startswith='Cemento')   # sin stock
        tornillo = Item.objects.get(nombre__startswith='Tornillo')  # con stock
        self.assertEqual(self.post(f'/api/deleteItem/{tornillo.sku}/').status_code, 400)
        self.assertEqual(self.post(f'/api/deleteItem/{cemento.sku}/').status_code, 200)
        self.assertTrue(Item.todos.filter(pk=cemento.pk, eliminado_en__isnull=False).exists())
        skus = [i['sku'] for i in self.client.get('/api/items/').json()['items']]
        self.assertNotIn(cemento.sku, skus)
        r = self.post('/api/addCategoria/', {'nombre': 'Vacía', 'prefijo': 'VAC'})
        cat_id = r.json()['id']
        self.assertEqual(self.post(f'/api/deleteCategoria/{cat_id}/').status_code, 200)
        # el nombre queda libre para crear otra categoría igual
        self.assertEqual(self.post('/api/addCategoria/', {'nombre': 'Vacía', 'prefijo': 'VAC'}).status_code, 201)

    def test_catalogo_paginado_y_filtrado_en_servidor(self):
        self.entrar('bodeguero@bodega.cl')
        r = self.client.get('/api/items/?page=1&page_size=2&orden=nombre').json()
        self.assertEqual(len(r['items']), 2)
        self.assertEqual(r['total'], Item.objects.count())
        self.assertEqual(sum(r['conteo_estados'].values()), Item.objects.count())
        r = self.client.get('/api/items/?page=1&estado=Sin%20stock').json()
        self.assertTrue(r['items'])
        self.assertTrue(all(i['estado'] == 'Sin stock' for i in r['items']))
        # escanear el código de una herramienta encuentra su ítem
        sierra = Item.objects.get(nombre='Sierra circular')
        codigo = sierra.unidades.first().codigo
        r = self.client.get(f'/api/items/?page=1&q={codigo}').json()
        self.assertEqual([i['sku'] for i in r['items']], [sierra.sku])

    def test_dashboard(self):
        self.entrar('admin@bodega.cl')
        r = self.client.get('/api/dashboard/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()['dias']), 14)
        self.entrar('trabajador@bodega.cl')
        self.assertEqual(self.client.get('/api/dashboard/').status_code, 403)


class ConcurrenciaStockTests(TransactionTestCase):
    """[Race conditions] Dos bodegueros operando EXACTAMENTE al mismo tiempo (hilos reales)."""

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())

    def en_paralelo(self, *tareas):
        barrera = threading.Barrier(len(tareas))
        resultados = [None] * len(tareas)

        def correr(i, tarea):
            try:
                barrera.wait()
                resultados[i] = tarea()
            finally:
                connection.close()

        hilos = [threading.Thread(target=correr, args=(i, t)) for i, t in enumerate(tareas)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join(30)
        return resultados

    def cliente(self, email='bodeguero@bodega.cl'):
        c = Client()
        c.force_login(Usuario.objects.get(username=email))
        return c

    def enviar(self, cliente, url, datos=None):
        return cliente.post(url, json.dumps(datos or {}), content_type='application/json').status_code

    def test_dos_entregas_simultaneas_no_despachan_de_mas(self):
        tornillo = Item.objects.get(nombre__startswith='Tornillo')   # 340 en total
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        s1 = Solicitud.objects.create(trabajador=jose, item=tornillo, cantidad=200)
        s2 = Solicitud.objects.create(trabajador=jose, item=tornillo, cantidad=200)
        c1, c2 = self.cliente(), self.cliente('admin@bodega.cl')
        codigos = self.en_paralelo(
            lambda: self.enviar(c1, f'/api/entregarSolicitud/{s1.id}/'),
            lambda: self.enviar(c2, f'/api/entregarSolicitud/{s2.id}/'),
        )
        self.assertEqual(sorted(codigos), [200, 400])   # solo UNA se entrega
        self.assertEqual(tornillo.stock_total(), 140)
        self.assertEqual(Solicitud.objects.filter(id__in=[s1.id, s2.id], estado='Despachada').count(), 1)

    def test_dos_recepciones_simultaneas_no_pierden_stock(self):
        sierra = Item.objects.get(nombre='Sierra circular')
        jose = Usuario.objects.get(username='trabajador@bodega.cl')
        carla = Usuario.objects.get(username='bodeguero@bodega.cl')
        central = Bodega.objects.get(nombre='Bodega Central')
        prestamos = []
        for unidad in list(sierra.unidades.filter(estado='Disponible', bodega=central)[:2]):
            sol = Solicitud.objects.create(trabajador=jose, item=sierra, cantidad=1, estado='Despachada')
            p = Prestamo.objects.create(solicitud=sol, item=sierra, trabajador=jose, responsable=carla,
                                        bodega=central, estado_devolucion='Bueno', comentario='Sin problemas')
            p.unidades.add(unidad)
            unidad.estado = 'Prestada'
            unidad.save()
            Stock.objects.filter(item=sierra, bodega=central).update(cantidad=F('cantidad') - 1)
            prestamos.append((p, unidad.codigo))
        self.assertEqual(len(prestamos), 2)
        antes = Stock.objects.get(item=sierra, bodega=central).cantidad
        c1, c2 = self.cliente(), self.cliente('admin@bodega.cl')
        (p1, cod1), (p2, cod2) = prestamos
        codigos = self.en_paralelo(
            lambda: self.enviar(c1, f'/api/recibirPrestamo/{p1.id}/', {'unidades': [cod1]}),
            lambda: self.enviar(c2, f'/api/recibirPrestamo/{p2.id}/', {'unidades': [cod2]}),
        )
        self.assertEqual(codigos, [200, 200])
        self.assertEqual(Stock.objects.get(item=sierra, bodega=central).cantidad, antes + 2)   # no se perdió ninguna


class CrudAdminYReportesTests(TestCase):
    """CRUD completo del administrador, papelera y gráficos de reportes."""

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())

    def entrar(self, email):
        self.client.force_login(Usuario.objects.get(username=email))

    def post(self, url, data=None):
        return self.client.post(url, json.dumps(data or {}), content_type='application/json')

    def test_admin_edita_y_cancela_solicitud(self):
        sol = Solicitud.objects.get(estado='Pendiente', trabajador__username='maria.soto@bodega.cl')
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(self.post(f'/api/editarSolicitud/{sol.id}/', {'cantidad': 2}).status_code, 403)
        self.entrar('admin@bodega.cl')
        self.assertEqual(self.post(f'/api/editarSolicitud/{sol.id}/', {'cantidad': 0}).status_code, 400)
        r = self.post(f'/api/editarSolicitud/{sol.id}/', {'cantidad': 2, 'motivo': 'Dos frentes de trabajo'})
        self.assertEqual(r.json()['solicitud']['cantidad'], 2)
        self.assertEqual(self.post(f'/api/cancelarSolicitud/{sol.id}/').status_code, 200)
        self.assertEqual(Solicitud.objects.get(id=sol.id).estado, 'Cancelada')
        self.assertEqual(self.post(f'/api/editarSolicitud/{sol.id}/', {'cantidad': 1}).status_code, 400)

    def test_trabajador_cancela_solo_las_suyas(self):
        ajena = Solicitud.objects.get(estado='Pendiente', trabajador__username='maria.soto@bodega.cl')
        self.entrar('trabajador@bodega.cl')
        self.assertEqual(self.post(f'/api/cancelarSolicitud/{ajena.id}/').status_code, 403)
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        id_ = self.post('/api/addSolicitud/', {'sku': tornillo.sku, 'cantidad': 3}).json()['solicitud']['id']
        self.assertEqual(self.post(f'/api/cancelarSolicitud/{id_}/').status_code, 200)

    def test_admin_extiende_plazo_de_prestamo(self):
        p = Prestamo.objects.filter(fecha_devolucion__isnull=True).first()
        self.entrar('admin@bodega.cl')
        nueva = (timezone.localtime(p.fecha_entrega).date() + timezone.timedelta(days=20)).isoformat()
        r = self.post(f'/api/editarPrestamo/{p.id}/', {'fecha_limite': nueva, 'comentario': 'Faena extendida'})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['prestamo']['fecha_limite'], nueva)
        antes = (timezone.localtime(p.fecha_entrega).date() - timezone.timedelta(days=1)).isoformat()
        self.assertEqual(self.post(f'/api/editarPrestamo/{p.id}/', {'fecha_limite': antes}).status_code, 400)

    def test_papelera_restaura_bodega_con_su_nombre(self):
        self.entrar('admin@bodega.cl')
        sur = Bodega.objects.get(nombre='Bodega Sur')
        self.assertEqual(self.post(f'/api/deleteBodega/{sur.id}/').status_code, 200)
        papelera = self.client.get('/api/papelera/').json()
        self.assertEqual(papelera['bodegas'][0]['nombre'], 'Bodega Sur')
        self.assertEqual(self.post(f'/api/restaurar/bodegas/{sur.id}/').status_code, 200)
        self.assertEqual(Bodega.objects.get(id=sur.id).nombre, 'Bodega Sur')
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(self.client.get('/api/papelera/').status_code, 403)

    def test_editar_item_con_bodega_sin_stock_no_lo_deja_en_cero(self):
        self.entrar('admin@bodega.cl')
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        central = Bodega.objects.get(nombre='Bodega Central')
        r = self.post(f'/api/editarItem/{tornillo.sku}/', {'nombre': tornillo.nombre, 'bodega': central.id})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(tornillo.stock_total(), 340)

    def test_cada_reporte_trae_graficos(self):
        self.entrar('admin@bodega.cl')
        for tipo in ['items', 'bodegas', 'prestamos', 'solicitudes', 'usuarios']:
            r = self.client.get(f'/api/reportes/{tipo}/').json()
            self.assertTrue(r['graficos'], tipo)
            for g in r['graficos']:
                self.assertEqual(len(g['etiquetas']), len(g['datos']), f'{tipo}: {g["titulo"]}')
        # los gráficos respetan los filtros
        r = self.client.get('/api/reportes/items/?estado=Sin%20stock').json()
        estados = next(g for g in r['graficos'] if g['tipo'] == 'doughnut')
        self.assertEqual(estados['etiquetas'], ['Sin stock'])


class EspaciosTests(TestCase):
    """Estantes y áreas libres: capacidad propia, traslados y catálogo sin duplicados."""

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())
        self.client.force_login(Usuario.objects.get(username='admin@bodega.cl'))
        self.central = Bodega.objects.get(nombre='Bodega Central')

    def post(self, url, data=None):
        return self.client.post(url, json.dumps(data or {}), content_type='application/json')

    def test_crud_espacio(self):
        r = self.post(f'/api/bodegas/{self.central.id}/addEspacio/',
                      {'tipo': 'estante', 'nombre': 'Estante C', 'capacidad': 80, 'niveles': 3})
        self.assertEqual(r.status_code, 201, r.content)
        id_ = r.json()['espacio']['id']
        repetido = self.post(f'/api/bodegas/{self.central.id}/addEspacio/',
                             {'tipo': 'area', 'nombre': 'estante c', 'capacidad': 10})
        self.assertIn('nombre', repetido.json()['errores'])
        self.assertEqual(self.post(f'/api/editarEspacio/{id_}/', {'tipo': 'estante', 'nombre': 'Estante C',
                                                                 'capacidad': 120}).status_code, 200)
        lleno = Espacio.objects.get(bodega=self.central, nombre='Estante A')
        self.assertEqual(self.post(f'/api/deleteEspacio/{lleno.id}/').status_code, 400)   # tiene stock
        self.assertEqual(self.post(f'/api/deleteEspacio/{id_}/').status_code, 200)
        self.assertEqual(self.client.get('/api/bodegas/').json()['bodegas'][0]['capacidad'], 1000)

    def test_registrar_item_en_un_estante(self):
        estante_b = Espacio.objects.get(bodega=self.central, nombre='Estante B')
        r = self.post('/api/addItem/', {'nombre': 'Guantes', 'categoria': Categoria.objects.first().id,
                                        'tipo': 'material', 'stock_minimo': 5, 'espacio': estante_b.id, 'stock': 20})
        self.assertEqual(r.status_code, 201, r.content)
        ubic = r.json()['item']['ubicaciones']
        self.assertEqual([(u['espacio'], u['cantidad']) for u in ubic], [('Estante B', 20)])
        # el estante B tiene capacidad 300 y ya guarda 58 cascos + 20 guantes
        r = self.post('/api/addItem/', {'nombre': 'Lentes', 'categoria': Categoria.objects.first().id,
                                        'tipo': 'material', 'stock_minimo': 5, 'espacio': estante_b.id, 'stock': 300})
        self.assertIn('solo tiene espacio', r.json()['errores']['stock'][0])

    def test_trasladar_stock_y_herramientas(self):
        sierra = Item.objects.get(nombre='Sierra circular')
        area = Espacio.objects.get(bodega=self.central, nombre='Área libre principal')
        estante = Espacio.objects.get(bodega=self.central, nombre='Estante B')
        r = self.post(f'/api/trasladarStock/{sierra.sku}/', {'origen': area.id, 'destino': estante.id, 'cantidad': 2})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Stock.objects.get(item=sierra, espacio=estante).cantidad, 2)
        self.assertEqual(sierra.unidades.filter(espacio=estante, estado='Disponible').count(), 2)
        self.assertEqual(sierra.stock_total(), 3)   # el total no cambia
        r = self.post(f'/api/trasladarStock/{sierra.sku}/', {'origen': area.id, 'destino': estante.id, 'cantidad': 5})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(MovimientoStock.objects.filter(item=sierra, tipo='traslado').count(), 2)

    def test_no_permite_items_duplicados(self):
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        r = self.post('/api/addItem/', {'nombre': tornillo.nombre.upper(), 'categoria': tornillo.categoria_id,
                                        'tipo': 'material', 'stock_minimo': 5})
        self.assertEqual(r.status_code, 400)
        self.assertIn(tornillo.sku, r.json()['errores']['nombre'][0])


class CrudCompletoAdminTests(TestCase):
    """El administrador puede crear, editar y eliminar en todas las tablas."""

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())
        self.client.force_login(Usuario.objects.get(username='admin@bodega.cl'))

    def post(self, url, data=None):
        return self.client.post(url, json.dumps(data or {}), content_type='application/json')

    def test_admin_crea_solicitud_a_nombre_de_trabajador(self):
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        maria = Usuario.objects.get(username='maria.soto@bodega.cl')
        r = self.post('/api/addSolicitud/', {'sku': tornillo.sku, 'cantidad': 5, 'trabajador': maria.id})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Solicitud.objects.get(id=r.json()['solicitud']['id']).trabajador, maria)
        # un trabajador NO puede pedir a nombre de otro: se ignora y queda a su nombre
        self.client.force_login(Usuario.objects.get(username='trabajador@bodega.cl'))
        r = self.post('/api/addSolicitud/', {'sku': tornillo.sku, 'cantidad': 5, 'trabajador': maria.id})
        self.assertEqual(Solicitud.objects.get(id=r.json()['solicitud']['id']).trabajador.username, 'trabajador@bodega.cl')

    def test_anular_prestamo_devuelve_herramientas(self):
        p = Prestamo.objects.get(trabajador__username='trabajador@bodega.cl', fecha_devolucion__isnull=True)
        antes = p.item.stock_total()
        r = self.post(f'/api/anularPrestamo/{p.id}/', {'motivo': 'Se registró por error'})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['prestamo']['estado'], 'Anulado')
        self.assertEqual(p.item.stock_total(), antes + p.cantidad)
        self.assertEqual(Solicitud.objects.get(id=p.solicitud_id).estado, 'Cancelada')
        self.assertFalse(p.unidades.filter(estado='Prestada').exists())
        self.assertEqual(self.post(f'/api/anularPrestamo/{p.id}/').status_code, 400)   # ya no está activo

    def test_movimiento_manual_y_reversion(self):
        tornillo = Item.objects.get(nombre__startswith='Tornillo')
        estante = Stock.objects.get(item=tornillo).espacio
        r = self.post('/api/addMovimiento/', {'sku': tornillo.sku, 'espacio': estante.id, 'tipo': 'salida',
                                              'cantidad': 40, 'motivo': 'Merma'})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(tornillo.stock_total(), 300)
        mov = MovimientoStock.objects.get(item=tornillo, tipo='salida')
        self.assertEqual(self.post(f'/api/revertirMovimiento/{mov.id}/').status_code, 200)
        self.assertEqual(tornillo.stock_total(), 340)
        self.assertEqual(self.post(f'/api/revertirMovimiento/{mov.id}/').status_code, 400)   # no dos veces
        # las herramientas no se mueven a mano (tienen códigos)
        sierra = Item.objects.get(nombre='Sierra circular')
        r = self.post('/api/addMovimiento/', {'sku': sierra.sku, 'espacio': estante.id, 'tipo': 'ingreso',
                                              'cantidad': 1, 'motivo': 'Prueba'})
        self.assertIn('sku', r.json()['errores'])

    def test_eliminar_definitivo_solo_sin_historial(self):
        r = self.post('/api/addCategoria/', {'nombre': 'Temporal', 'prefijo': 'TMP'})
        cat_id = r.json()['id']
        self.post(f'/api/deleteCategoria/{cat_id}/')
        self.assertEqual(self.post(f'/api/eliminarDefinitivo/categorias/{cat_id}/').status_code, 200)
        self.assertFalse(Categoria.todos.filter(id=cat_id).exists())
        # Pedro tiene un préstamo en su historial: no se puede borrar de verdad
        pedro = Usuario.objects.get(username='pedro.vidal@bodega.cl')
        self.post(f'/api/deleteUsuario/{pedro.id}/')
        self.assertEqual(self.post(f'/api/eliminarDefinitivo/usuarios/{pedro.id}/').status_code, 400)
        self.assertTrue(Usuario.objects.filter(id=pedro.id).exists())
        # solo se borra lo que ya está en la papelera
        sur = Bodega.objects.get(nombre='Bodega Sur')
        self.assertEqual(self.post(f'/api/eliminarDefinitivo/bodegas/{sur.id}/').status_code, 404)
        self.post(f'/api/deleteBodega/{sur.id}/')
        self.assertEqual(self.post(f'/api/eliminarDefinitivo/bodegas/{sur.id}/').status_code, 200)

    def test_solo_admin(self):
        self.client.force_login(Usuario.objects.get(username='bodeguero@bodega.cl'))
        p = Prestamo.objects.filter(fecha_devolucion__isnull=True).first()
        self.assertEqual(self.post(f'/api/anularPrestamo/{p.id}/').status_code, 403)
        self.assertEqual(self.post('/api/addMovimiento/', {}).status_code, 403)


class UnidadesCategoriasPedidosTests(TestCase):

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())

    def post(self, url, data=None):
        return self.client.post(url, json.dumps(data or {}), content_type='application/json')

    def entrar(self, email):
        r = self.post('/api/login/', {'email': email, 'password': PASS})
        self.assertEqual(r.status_code, 200, r.content)

    def cat(self, prefijo):
        return Categoria.objects.get(prefijo=prefijo)

    def test_material_guarda_su_unidad_de_medida(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addItem/', {'nombre': 'Arena fina', 'categoria': self.cat('MAT').id, 'tipo': 'material',
                                        'unidad_medida': 'kg', 'stock_minimo': 20})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['item']['unidad'], 'kg')
        self.assertEqual(Item.objects.get(nombre='Arena fina').unidad_medida, 'kg')

    def test_herramienta_siempre_se_cuenta_por_unidad(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addItem/', {'nombre': 'Taladro inalámbrico', 'categoria': self.cat('HRM').id,
                                        'tipo': 'herramienta', 'unidad_medida': 'kg', 'stock_minimo': 1})
        self.assertEqual(r.status_code, 400)
        self.assertIn('unidad_medida', r.json()['errores'])

    def test_material_sin_unidad_toma_la_de_su_categoria(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addCategoria/', {'nombre': 'Cables', 'prefijo': 'CBL', 'tipo': 'material',
                                             'unidad_medida': 'm'})
        self.assertEqual(r.status_code, 201, r.content)
        r = self.post('/api/addItem/', {'nombre': 'Cable 2.5 mm', 'categoria': r.json()['id'], 'tipo': 'material',
                                        'stock_minimo': 10})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['item']['unidad_medida'], 'm')

    def test_editar_item_sin_mandar_unidad_la_conserva(self):
        self.entrar('admin@bodega.cl')
        item = Item.objects.get(nombre='Cemento gris 25kg')
        item.unidad_medida = 'saco'
        item.save()
        r = self.post(f'/api/editarItem/{item.sku}/', {'nombre': 'Cemento gris 25 kg'})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['item']['unidad_medida'], 'saco')

    def test_subcategoria_y_filtro_por_categoria_principal(self):
        self.entrar('admin@bodega.cl')
        padre = self.cat('HRM')
        r = self.post('/api/addCategoria/', {'nombre': 'Taladros', 'prefijo': 'TLD', 'padre': padre.id})
        self.assertEqual(r.status_code, 201, r.content)
        sub = r.json()
        self.assertEqual(sub['ruta'], f'{padre.nombre} › Taladros')
        self.assertEqual(sub['tipo'], padre.tipo)
        r = self.post('/api/addItem/', {'nombre': 'Taladro de banco', 'categoria': sub['id'], 'tipo': 'herramienta',
                                        'stock_minimo': 1})
        self.assertEqual(r.status_code, 201, r.content)
        nombres = [i['nombre'] for i in self.client.get(f'/api/items/?categoria={padre.id}').json()['items']]
        self.assertIn('Taladro de banco', nombres)
        self.assertIn('Sierra circular', nombres)
        lista = self.client.get('/api/categorias/').json()
        ids = [c['id'] for c in lista['categorias']]
        self.assertEqual(ids.index(sub['id']), ids.index(padre.id) + 1)
        self.assertTrue(lista['unidades_medida'])

    def test_solo_dos_niveles_de_categorias(self):
        self.entrar('admin@bodega.cl')
        sub = self.post('/api/addCategoria/', {'nombre': 'Taladros', 'prefijo': 'TLD', 'padre': self.cat('HRM').id}).json()
        r = self.post('/api/addCategoria/', {'nombre': 'Taladros percutores', 'prefijo': 'TLP', 'padre': sub['id']})
        self.assertEqual(r.status_code, 400)
        self.assertIn('padre', r.json()['errores'])

    def test_no_se_elimina_categoria_con_subcategorias(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addCategoria/', {'nombre': 'Seguridad', 'prefijo': 'SEG'})
        self.post('/api/addCategoria/', {'nombre': 'Guantes', 'prefijo': 'GNT', 'padre': r.json()['id']})
        r = self.post(f'/api/deleteCategoria/{r.json()["id"]}/')
        self.assertEqual(r.status_code, 400)

    def test_categoria_de_materiales_no_acepta_herramientas(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addCategoria/', {'nombre': 'Áridos', 'prefijo': 'ARI', 'tipo': 'material'})
        r = self.post('/api/addItem/', {'nombre': 'Carretilla', 'categoria': r.json()['id'], 'tipo': 'herramienta',
                                        'stock_minimo': 1})
        self.assertEqual(r.status_code, 400)
        self.assertIn('categoria', r.json()['errores'])

    def test_bodeguero_crea_edita_y_elimina_categorias(self):
        self.entrar('trabajador@bodega.cl')
        self.assertEqual(self.post('/api/addCategoria/', {'nombre': 'Pinturas', 'prefijo': 'PIN',
                                                          'tipo': 'material'}).status_code, 403)
        self.client.logout()
        self.entrar('bodeguero@bodega.cl')
        r = self.post('/api/addCategoria/', {'nombre': 'Pinturas', 'prefijo': 'PIN', 'tipo': 'material'})
        self.assertEqual(r.status_code, 201, r.content)
        cat_id = r.json()['id']
        r = self.post(f'/api/editarCategoria/{cat_id}/', {'nombre': 'Pinturas y barnices'})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Categoria.objects.get(id=cat_id).nombre, 'Pinturas y barnices')
        self.assertEqual(self.post(f'/api/deleteCategoria/{cat_id}/').status_code, 200)
        self.assertIsNotNone(Categoria.todos.get(id=cat_id).eliminado_en)

    def test_no_se_cambia_tipo_de_categoria_con_productos_del_otro_tipo(self):
        self.entrar('admin@bodega.cl')
        r = self.post(f'/api/editarCategoria/{self.cat("HRM").id}/', {'nombre': 'Herramientas eléctricas',
                                                                       'tipo': 'material'})
        self.assertEqual(r.status_code, 400)

    def test_pedido_al_administrador_completo(self):
        sku = Item.objects.get(nombre='Casco de seguridad').sku
        self.entrar('bodeguero@bodega.cl')
        r = self.post('/api/addPedido/', {'tipo': 'reposicion', 'sku': sku, 'cantidad': 30,
                                          'motivo': 'Llegan 30 trabajadores nuevos el lunes', 'prioridad': 'alta'})
        self.assertEqual(r.status_code, 201, r.content)
        pedido = r.json()['pedido']
        self.assertEqual(pedido['estado'], 'Pendiente')
        self.client.logout()
        self.entrar('admin@bodega.cl')
        self.assertEqual(self.client.get('/api/resumen/').json()['pedidos_pendientes'], 1)
        tipos = [g['tipo'] for g in self.client.get('/api/notificaciones/').json()['grupos']]
        self.assertIn('pedidos', tipos)
        r = self.post(f'/api/responderPedido/{pedido["id"]}/', {'estado': 'Rechazado'})
        self.assertEqual(r.status_code, 400)
        r = self.post(f'/api/responderPedido/{pedido["id"]}/', {'estado': 'Aprobado', 'respuesta': 'Compra hecha'})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['pedido']['atendido_por'], 'Alexander Smith')
        r = self.post(f'/api/responderPedido/{pedido["id"]}/', {'estado': 'Rechazado', 'respuesta': 'Otra vez'})
        self.assertEqual(r.status_code, 400)
        self.client.logout()
        self.entrar('bodeguero@bodega.cl')
        mios = self.client.get('/api/pedidos/').json()['pedidos']
        self.assertEqual([p['estado'] for p in mios], ['Aprobado'])

    def test_pedido_de_producto_nuevo_exige_descripcion(self):
        self.entrar('trabajador@bodega.cl')
        r = self.post('/api/addPedido/', {'tipo': 'nuevo', 'cantidad': 2, 'motivo': 'Para soldar en altura'})
        self.assertEqual(r.status_code, 400)
        self.assertIn('descripcion', r.json()['errores'])
        r = self.post('/api/addPedido/', {'tipo': 'nuevo', 'descripcion': 'Arnés de seguridad', 'cantidad': 2,
                                          'motivo': 'Para soldar en altura'})
        self.assertEqual(r.status_code, 201, r.content)

    def test_permisos_de_pedidos(self):
        self.entrar('admin@bodega.cl')
        r = self.post('/api/addPedido/', {'tipo': 'otro', 'descripcion': 'Algo', 'cantidad': 1,
                                          'motivo': 'Prueba de permisos'})
        self.assertEqual(r.status_code, 403)
        self.client.logout()
        self.entrar('trabajador@bodega.cl')
        pedido = self.post('/api/addPedido/', {'tipo': 'otro', 'descripcion': 'Escalera', 'cantidad': 1,
                                               'motivo': 'Para la bodega norte'}).json()['pedido']
        r = self.post(f'/api/responderPedido/{pedido["id"]}/', {'estado': 'Aprobado'})
        self.assertEqual(r.status_code, 403)
        self.client.logout()
        self.entrar('maria.soto@bodega.cl')
        self.assertEqual(self.post(f'/api/cancelarPedido/{pedido["id"]}/').status_code, 403)
        self.assertEqual(self.client.get('/api/pedidos/').json()['pedidos'], [])
        self.client.logout()
        self.entrar('trabajador@bodega.cl')
        r = self.post(f'/api/cancelarPedido/{pedido["id"]}/')
        self.assertEqual(r.json()['pedido']['estado'], 'Cancelado')

    def test_prestamos_traen_bodega_categoria_y_vencido(self):
        self.entrar('bodeguero@bodega.cl')
        prestamos = self.client.get('/api/prestamos/').json()['prestamos']
        self.assertTrue(all(p['bodega'] and p['categoria'] for p in prestamos))
        self.assertEqual(sum(1 for p in prestamos if p['vencido']), 1)

    def test_cargar_muchos_datos_deja_inventario_consistente(self):
        call_command('cargar_muchos_datos', stdout=io.StringIO())
        self.assertGreater(Item.objects.count(), 90)
        self.assertGreater(Prestamo.objects.count(), 150)
        self.assertTrue(Categoria.objects.filter(padre__isnull=False).exists())
        for s in Stock.objects.filter(item__tipo='herramienta'):
            self.assertEqual(Unidad.objects.filter(item=s.item, espacio=s.espacio, estado='Disponible').count(),
                             s.cantidad)
        self.assertEqual(Prestamo.objects.filter(fecha_devolucion__isnull=True).count(),
                         Unidad.objects.filter(estado='Prestada').count())
        self.assertFalse([e for e in Espacio.objects.all() if e.ocupado() > e.capacidad])
        salida = io.StringIO()
        call_command('cargar_muchos_datos', stdout=salida)
        self.assertIn('ya estaban cargados', salida.getvalue())

    def test_cargar_muchos_datos_en_base_sin_los_usuarios_de_prueba(self):
        Usuario.objects.filter(username='admin@bodega.cl').update(username='jefe@empresa.cl', email='jefe@empresa.cl')
        Usuario.objects.get(username='bodeguero@bodega.cl').eliminar()
        call_command('cargar_muchos_datos', stdout=io.StringIO())
        self.assertGreater(Item.objects.count(), 90)
        self.assertEqual(Bodega.objects.filter(nombre='Bodega Norte').count(), 1)
        self.assertEqual(Prestamo.objects.filter(fecha_devolucion__isnull=True).count(),
                         Unidad.objects.filter(estado='Prestada').count())
        salida = io.StringIO()
        call_command('cargar_datos', stdout=salida)
        self.assertIn('ya estaban cargados', salida.getvalue())


class CargarMuchosDatosBaseVaciaTests(TestCase):

    def test_en_base_vacia_carga_tambien_los_datos_base(self):
        call_command('cargar_muchos_datos', stdout=io.StringIO())
        self.assertTrue(Usuario.objects.filter(username='admin@bodega.cl').exists())
        self.assertGreater(Item.objects.count(), 90)


class FotoPerfilTests(TestCase):
    PNG = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kg'
           'AAAABJRU5ErkJggg==')

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())

    def post(self, url, data=None):
        return self.client.post(url, json.dumps(data or {}), content_type='application/json')

    def entrar(self, email):
        self.assertEqual(self.post('/api/login/', {'email': email, 'password': PASS}).status_code, 200)

    def test_subir_ver_y_quitar_foto(self):
        self.entrar('trabajador@bodega.cl')
        r = self.post('/api/perfil/foto/', {'foto': self.PNG})
        self.assertEqual(r.status_code, 200, r.content)
        url = r.json()['usuario']['foto']
        self.assertTrue(url.startswith('/api/fotoPerfil/'))
        self.assertEqual(self.client.get('/api/yo/').json()['usuario']['foto'], url)
        imagen = self.client.get(url)
        self.assertEqual(imagen.status_code, 200)
        self.assertEqual(imagen['Content-Type'], 'image/png')
        self.assertTrue(imagen.content.startswith(b'\x89PNG'))
        self.client.logout()
        self.entrar('bodeguero@bodega.cl')
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.logout()
        self.entrar('trabajador@bodega.cl')
        r = self.post('/api/perfil/quitarFoto/')
        self.assertIsNone(r.json()['usuario']['foto'])
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_foto_requiere_sesion(self):
        self.entrar('trabajador@bodega.cl')
        url = self.post('/api/perfil/foto/', {'foto': self.PNG}).json()['usuario']['foto']
        self.client.logout()
        self.assertEqual(self.client.get(url).status_code, 401)

    def test_rechaza_archivos_que_no_son_imagenes(self):
        self.entrar('trabajador@bodega.cl')
        falsa = 'data:image/png;base64,' + base64.b64encode(b'<script>alert(1)</script>').decode()
        for foto in [falsa, 'data:text/html;base64,PGgxPg==', 'no es una imagen', None]:
            r = self.post('/api/perfil/foto/', {'foto': foto})
            self.assertEqual(r.status_code, 400, foto)
            self.assertIn('foto', r.json()['errores'])

    def test_rechaza_fotos_muy_pesadas(self):
        self.entrar('trabajador@bodega.cl')
        grande = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xff' + b'0' * (800 * 1024)).decode()
        r = self.post('/api/perfil/foto/', {'foto': grande})
        self.assertEqual(r.status_code, 400)

    def test_lista_de_usuarios_trae_la_foto(self):
        self.entrar('trabajador@bodega.cl')
        self.post('/api/perfil/foto/', {'foto': self.PNG})
        self.client.logout()
        self.entrar('admin@bodega.cl')
        lista = self.client.get('/api/usuarios/').json()['usuarios']
        jose = next(u for u in lista if u['correo'] == 'trabajador@bodega.cl')
        self.assertTrue(jose['foto'])


class DashboardTests(TestCase):

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())

    def test_actividad_por_dia_cuenta_lo_de_hoy(self):
        self.client.post('/api/login/', json.dumps({'email': 'admin@bodega.cl', 'password': PASS}),
                         content_type='application/json')
        datos = self.client.get('/api/dashboard/').json()
        self.assertEqual(len(datos['solicitudes_por_dia']), 14)
        self.assertGreater(sum(datos['solicitudes_por_dia']), 0)
        self.assertGreater(sum(datos['prestamos_por_dia']), 0)


class ConcurrenciaYEscalaTests(TestCase):

    def setUp(self):
        call_command('cargar_datos', stdout=io.StringIO())

    def entrar(self, email):
        self.client.post('/api/login/', json.dumps({'email': email, 'password': PASS}), content_type='application/json')

    def test_reintenta_la_operacion_si_mysql_detecta_un_interbloqueo(self):
        from django.db import OperationalError
        from django.http import JsonResponse
        from bodegaApp import views
        intentos = []

        def vista(request):
            intentos.append(1)
            if len(intentos) < 3:
                raise OperationalError(1213, 'Deadlock found when trying to get lock; try restarting transaction')
            return JsonResponse({'ok': True})

        respuesta = views.ejecutar_con_reintentos(vista, None)
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(len(intentos), 3)

    def test_no_reintenta_otros_errores_de_base_de_datos(self):
        from django.db import OperationalError
        from bodegaApp import views
        intentos = []

        def vista(request):
            intentos.append(1)
            raise OperationalError(2006, 'MySQL server has gone away')

        with self.assertRaises(OperationalError):
            views.ejecutar_con_reintentos(vista, None)
        self.assertEqual(len(intentos), 1)

    def test_bloqueo_de_stock_no_bloquea_bodega_ni_espacio(self):
        from django.db import connection, transaction
        from django.test.utils import CaptureQueriesContext
        from bodegaApp import stock as servicio_stock
        item = Item.objects.filter(stocks__isnull=False).first()
        with transaction.atomic(), CaptureQueriesContext(connection) as consultas:
            servicio_stock.bloquear_filas_item(item)
        bloqueos = [q['sql'] for q in consultas.captured_queries if 'FOR UPDATE' in q['sql']]
        self.assertTrue(bloqueos)
        if connection.features.has_select_for_update_of:
            self.assertTrue(all('FOR UPDATE OF' in sql for sql in bloqueos), bloqueos)
        else:
            self.assertTrue(all('JOIN' not in sql for sql in bloqueos), bloqueos)

    def test_lista_general_trae_pendientes_y_limita_el_historial(self):
        from bodegaApp import views
        trabajador = Usuario.objects.get(username='trabajador@bodega.cl')
        item = Item.objects.filter(tipo='material').first()
        Solicitud.objects.bulk_create([Solicitud(trabajador=trabajador, item=item, cantidad=1, estado='Despachada',
                                                 stock_al_solicitar=0) for _ in range(30)])
        pendientes = Solicitud.objects.filter(estado='Pendiente').count()
        original = views.LIMITE_HISTORIAL
        views.LIMITE_HISTORIAL = 10
        try:
            self.entrar('bodeguero@bodega.cl')
            datos = self.client.get('/api/solicitudes/').json()
        finally:
            views.LIMITE_HISTORIAL = original
        estados = [s['estado'] for s in datos['solicitudes']]
        self.assertEqual(estados.count('Pendiente'), pendientes)
        self.assertEqual(len(estados) - pendientes, 10)
        self.assertGreater(datos['total_historial'], 10)
