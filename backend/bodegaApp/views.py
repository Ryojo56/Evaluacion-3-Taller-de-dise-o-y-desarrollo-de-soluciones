"""
Vistas de la API.

Funcionan igual que empleadoData / empleadoRegistro, pero en vez de
render(request, 'plantilla.html', data) devuelven JsonResponse(data),
porque las pantallas ahora las dibuja React.
"""
import base64
import binascii
import json
import random
import re
import secrets
from functools import wraps
from time import sleep

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from datetime import date, datetime, time, timedelta

from django.db import OperationalError, transaction
from django.db.models.deletion import ProtectedError
from django.db.models import Count, F, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from django.conf import settings
from django.core.cache import cache
from django.core.paginator import Paginator

from bodegaApp import forms
from bodegaApp import stock as servicio_stock
from bodegaApp.models import (ESTADOS_ALERTA, ESTADOS_STOCK, UNIDADES_MEDIDA, Bodega, Categoria, Espacio, FotoPerfil,
                              Item, MovimientoStock, PedidoAdmin, Prestamo,
                              Solicitud, Stock, Unidad, Usuario, anotar_estado, simbolo_unidad)
from bodegaApp.stock import CapacidadExcedida, StockDesactualizado, StockInsuficiente
from bodegaApp.unidades import ajustar_unidades, crear_unidades, normalizar_codigo


# ===========================================================================
# AYUDANTES
# ===========================================================================
def leer_json(request):
    """React envía los datos como JSON (no como formulario HTML).
    [Validación] Si el cuerpo no es un objeto JSON (ej. una lista), se trata como vacío:
    antes `{**leer_json(request)}` con una lista provocaba un error 500."""
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def total_stock_subquery():
    """Suma del stock de cada ítem calculada por MySQL (para anotar querysets de Item)."""
    return Coalesce(Subquery(Stock.objects.filter(item=OuterRef('pk')).values('item')
                             .annotate(suma=Sum('cantidad')).values('suma')), 0)


def errores(form):
    """Convierte los errores del formulario en JSON: {'campo': ['mensaje']}."""
    return JsonResponse({'errores': form.errors}, status=400)


LIMITE_HISTORIAL = 1500


def con_historial_reciente(consulta, abiertos):
    historial = consulta.exclude(abiertos)
    return list(consulta.filter(abiertos)) + list(historial[:LIMITE_HISTORIAL]), historial.count()


CODIGOS_REINTENTO = {1205, 1213}
MAX_INTENTOS_BD = 4


def ejecutar_con_reintentos(vista, request, *args, **kwargs):
    for intento in range(1, MAX_INTENTOS_BD + 1):
        try:
            with transaction.atomic():
                return vista(request, *args, **kwargs)
        except OperationalError as error:
            if intento == MAX_INTENTOS_BD or not error.args or error.args[0] not in CODIGOS_REINTENTO:
                raise
            sleep(random.uniform(0.02, 0.1) * intento)


def requiere_login(roles=None):
    """Decorador: exige sesión iniciada y, opcionalmente, ciertos roles."""
    def decorador(vista):
        @wraps(vista)
        def envoltura(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({'error': 'Debes iniciar sesión.'}, status=401)
            if roles and request.user.rol not in roles:
                return JsonResponse({'error': 'No tienes permiso para esto.'}, status=403)
            if request.method == 'POST':
                return ejecutar_con_reintentos(vista, request, *args, **kwargs)
            return vista(request, *args, **kwargs)
        return envoltura
    return decorador


GESTION_USUARIOS = ['admin', 'rrhh']
VEN_TODA_LA_BODEGA = ['admin', 'bodeguero']


def puede_gestionar(actor, objetivo):
    return actor.rol == 'admin' or (actor.rol == 'rrhh' and objetivo.rol != 'admin')


def puede_asignar_rol(actor, rol):
    return actor.rol == 'admin' or rol != 'admin'


def sin_permiso(mensaje='No tienes permiso para esto.'):
    return JsonResponse({'error': mensaje}, status=403)


def fecha_cl(dt):
    """2026-09-06 -> '06-09-2026' (en hora de Chile)."""
    return timezone.localtime(dt).strftime('%d-%m-%Y') if dt else None


# ---- Convertir modelos a diccionarios (lo que recibe React) ---------------
def usuario_a_dict(u):
    return {
        'id': u.id,
        'nombre': u.nombre_completo(),
        'first_name': u.first_name,
        'last_name': u.last_name,
        'correo': u.email,
        'telefono': u.telefono,
        'rol': u.rol,
        'debe_cambiar_password': u.debe_cambiar_password,
        'activo': u.is_active,
        'creado': fecha_cl(u.date_joined),
        'ultimo_acceso': fecha_cl(u.last_login),
        'foto': u.url_foto(),
    }


def stock_por_bodega(item, clave=lambda s: s.bodega.nombre):
    totales = {}
    for s in item.stocks.all():
        if s.cantidad > 0:
            totales[clave(s)] = totales.get(clave(s), 0) + s.cantidad
    return totales


def item_a_dict(i):
    return {
        'sku': i.sku,
        'nombre': i.nombre,
        'categoria': i.categoria.ruta(),
        'categoria_id': i.categoria_id,
        'categoria_nombre': i.categoria.nombre,
        'categoria_padre_id': i.categoria.padre_id,
        'tipo': i.tipo,
        'unidad_medida': i.unidad_medida,
        'unidad': i.simbolo_unidad(),
        'stock_minimo': i.stock_minimo,
        'stock': stock_por_bodega(i),   # total por bodega (suma de sus estantes y áreas)
        # [Bodegas reales] dónde está exactamente: bodega + estante/área + cantidad
        'ubicaciones': [
            {'bodega': s.bodega.nombre, 'bodega_id': s.bodega_id, 'espacio': s.espacio.nombre,
             'espacio_id': s.espacio_id, 'tipo_espacio': s.espacio.tipo, 'cantidad': s.cantidad}
            for s in sorted(i.stocks.all(), key=lambda x: (x.bodega.nombre, x.espacio.nombre)) if s.cantidad > 0
        ],
        'stock_total': i.stock_total(),
        'estado': i.estado(),
    }


def bodega_a_dict(b):
    return {
        'id': b.id,
        'nombre': b.nombre,
        'ubicacion': b.ubicacion,
        'area_m2': float(b.area_m2),
        'capacidad': b.capacidad_total(),   # suma de sus estantes y áreas libres
        'estantes': getattr(b, 'n_estantes', None),
        'areas': getattr(b, 'n_areas', None),
        'ocupado': b.ocupado(),
        'disponible': b.disponible(),
        'porcentaje': b.porcentaje_ocupado(),
        'items': getattr(b, 'items_distintos', None),
    }


def solicitud_a_dict(s):
    pendiente = s.estado == 'Pendiente'
    faltan = max(s.cantidad - s.item.stock_total(), 0) if pendiente else 0
    return {
        'id': s.id,
        'trabajador': s.trabajador.nombre_completo(),
        'sku': s.item.sku,
        'producto': s.item.nombre,
        'categoria': s.item.categoria.ruta(),
        'cantidad': s.cantidad,
        'unidad': s.item.simbolo_unidad(),
        'motivo': s.motivo,
        'fecha': timezone.localtime(s.fecha).date().isoformat(),
        'estado': s.estado,
        'tipo': s.item.tipo,  # 'herramienta' (se presta) o 'material' (se consume)
        'entregado_por': s.bodeguero.nombre_completo() if s.bodeguero else None,
        'stock_al_solicitar': s.stock_al_solicitar,
        'excede_stock': s.excede_stock(),
        'faltan': faltan,
    }


def prestamo_a_dict(p):
    ahora = timezone.now()
    por_recibir = p.activo() and bool(p.estado_devolucion)
    if p.fecha_devolucion:
        devolucion = fecha_cl(p.fecha_devolucion)
    elif p.fecha_limite < ahora:
        devolucion = 'Vencido'
    elif p.fecha_limite - ahora < timezone.timedelta(hours=48):
        horas = int((p.fecha_limite - ahora).total_seconds() // 3600)
        devolucion = f'Vence en {horas}h'
    else:
        devolucion = f'Hasta {fecha_cl(p.fecha_limite)}'
    return {
        'id': p.id,
        'sku': p.item.sku,
        'herramienta': p.item.nombre,
        'trabajador': p.trabajador.nombre_completo(),
        'trabajador_id': p.trabajador_id,
        'categoria': p.item.categoria.ruta(),
        'categoria_id': p.item.categoria_id,
        'categoria_padre_id': p.item.categoria.padre_id,
        'bodega': p.bodega.nombre,
        'bodega_id': p.bodega_id,
        'vencido': p.activo() and not p.anulado and p.fecha_limite < ahora,
        'fecha_devolucion': timezone.localtime(p.fecha_devolucion).date().isoformat() if p.fecha_devolucion else None,
        'entrega': timezone.localtime(p.fecha_entrega).date().isoformat(),
        'fecha_limite': timezone.localtime(p.fecha_limite).date().isoformat(),
        'devolucion': devolucion,
        'responsable': p.responsable.nombre_completo(),
        'estado': 'Anulado' if p.anulado else 'Por recibir' if por_recibir else (p.estado_devolucion or 'En préstamo'),
        'anulado': p.anulado,
        'activo': p.activo(),
        'por_recibir': por_recibir,
        'estado_devolucion': p.estado_devolucion,
        'comentario': p.comentario,
        'unidades': [u.codigo for u in p.unidades.all()],
    }


def unidad_a_dict(u, prestamo=None):
    return {
        'codigo': u.codigo,
        'estado': u.estado,
        'bodega': u.bodega.nombre,
        'bodega_id': u.bodega_id,
        'espacio': u.espacio.nombre if u.espacio_id else '—',
        'espacio_id': u.espacio_id,
        'sku': u.item.sku,
        'item': u.item.nombre,
        'prestada_a': prestamo.trabajador.nombre_completo() if prestamo else None,
        'prestamo_id': prestamo.id if prestamo else None,
        'fecha_limite': fecha_cl(prestamo.fecha_limite) if prestamo else None,
    }


def prestamo_activo_de(unidad):
    return next((p for p in unidad.prestamos.all() if p.fecha_devolucion is None), None)


# ===========================================================================
# SESIÓN: login, logout, usuario actual, cambiar contraseña, perfil
# ===========================================================================
@require_GET
@ensure_csrf_cookie
def csrf(request):
    """React llama aquí primero para recibir la cookie 'csrftoken'."""
    return JsonResponse({'ok': True})


def _clave_intentos(request, texto):
    ip = request.META.get('REMOTE_ADDR', '')
    return f'login-fallido:{ip}:{texto.lower()[:100]}'


@require_POST
def iniciarSesion(request):
    data = leer_json(request)
    texto = str(data.get('email') or '').strip()[:150]
    password = str(data.get('password') or '')

    # [Seguridad] Límite de intentos fallidos por IP + cuenta (frena ataques de fuerza bruta)
    clave = _clave_intentos(request, texto)
    if cache.get(clave, 0) >= settings.LOGIN_MAX_INTENTOS:
        minutos = max(1, settings.LOGIN_BLOQUEO_SEGUNDOS // 60)
        return JsonResponse({'error': f'Demasiados intentos fallidos. Espera {minutos} minuto(s) e inténtalo de nuevo.'},
                            status=429)

    # Se puede entrar con el CORREO o con el NOMBRE DE USUARIO (ej: el de createsuperuser),
    # sin importar mayúsculas/minúsculas. Los usuarios eliminados no pueden entrar.
    encontrado = (Usuario.objects.filter(eliminado_en__isnull=True)
                  .filter(Q(username__iexact=texto) | Q(email__iexact=texto)).first())
    usuario = None
    if encontrado and texto:
        usuario = authenticate(request, username=encontrado.username, password=password)
    if usuario is None:
        try:
            cache.add(clave, 0, settings.LOGIN_BLOQUEO_SEGUNDOS)
            cache.incr(clave)
        except ValueError:
            cache.set(clave, 1, settings.LOGIN_BLOQUEO_SEGUNDOS)
        # Mismo mensaje exista o no la cuenta (no se revela qué correos están registrados)
        return JsonResponse({'error': 'Correo o contraseña incorrectos.'}, status=400)
    cache.delete(clave)
    login(request, usuario)
    if not data.get('recordar'):
        request.session.set_expiry(0)  # la sesión termina al cerrar el navegador
    return JsonResponse({'usuario': usuario_a_dict(usuario)})


@require_POST
def cerrarSesion(request):
    logout(request)
    return JsonResponse({'ok': True})


@require_GET
@requiere_login()
def usuarioActual(request):
    return JsonResponse({'usuario': usuario_a_dict(request.user)})


@require_POST
@requiere_login()
def cambiarPassword(request):
    form = forms.CambiarPasswordForm(leer_json(request), usuario=request.user)
    if not form.is_valid():
        return errores(form)
    request.user.set_password(form.cleaned_data['nueva'])
    request.user.debe_cambiar_password = False
    request.user.save()
    update_session_auth_hash(request, request.user)  # para no cerrar la sesión
    return JsonResponse({'usuario': usuario_a_dict(request.user)})


@require_POST
@requiere_login()
def editarPerfil(request):
    data = leer_json(request)
    if not request.user.check_password(data.get('password', '')):
        return JsonResponse({'errores': {'password': ['Contraseña incorrecta.']}}, status=400)
    form = forms.PerfilForm(data, instance=request.user)
    if not form.is_valid():
        return errores(form)
    usuario = form.save()
    return JsonResponse({'usuario': usuario_a_dict(usuario)})


FIRMAS_IMAGEN = {'image/jpeg': (b'\xff\xd8\xff',), 'image/png': (b'\x89PNG\r\n\x1a\n',), 'image/webp': (b'RIFF',)}
MAX_FOTO_BYTES = 700 * 1024


def leer_foto(texto):
    if not isinstance(texto, str):
        return None, None, 'Elige una imagen.'
    coincidencia = re.fullmatch(r'data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)', texto.strip())
    if not coincidencia:
        return None, None, 'La foto debe ser una imagen JPG, PNG o WebP.'
    tipo = coincidencia.group(1)
    if len(coincidencia.group(2)) > MAX_FOTO_BYTES * 4 // 3 + 8:
        return None, None, 'La foto es demasiado pesada (máximo 700 KB).'
    try:
        datos = base64.b64decode(coincidencia.group(2), validate=False)
    except (binascii.Error, ValueError):
        return None, None, 'No se pudo leer la imagen.'
    if not datos.startswith(FIRMAS_IMAGEN[tipo]) or (tipo == 'image/webp' and datos[8:12] != b'WEBP'):
        return None, None, 'El archivo no es una imagen válida.'
    return datos, tipo, None


@require_POST
@requiere_login()
def subirFotoPerfil(request):
    datos, tipo, error = leer_foto(leer_json(request).get('foto'))
    if error:
        return JsonResponse({'errores': {'foto': [error]}}, status=400)
    with transaction.atomic():
        FotoPerfil.objects.update_or_create(usuario=request.user, defaults={'imagen': datos, 'tipo': tipo})
        request.user.foto_actualizada = timezone.now()
        request.user.save(update_fields=['foto_actualizada'])
    return JsonResponse({'usuario': usuario_a_dict(request.user)})


@require_POST
@requiere_login()
def quitarFotoPerfil(request):
    with transaction.atomic():
        FotoPerfil.objects.filter(usuario=request.user).delete()
        request.user.foto_actualizada = None
        request.user.save(update_fields=['foto_actualizada'])
    return JsonResponse({'usuario': usuario_a_dict(request.user)})


@require_GET
@requiere_login()
def fotoPerfil(request, id):
    foto = FotoPerfil.objects.filter(usuario_id=id).only('imagen', 'tipo').first()
    if foto is None:
        return JsonResponse({'error': 'Este usuario no tiene foto.'}, status=404)
    respuesta = HttpResponse(bytes(foto.imagen), content_type=foto.tipo)
    respuesta['Cache-Control'] = 'private, max-age=86400'
    respuesta['X-Content-Type-Options'] = 'nosniff'
    respuesta['Content-Security-Policy'] = "default-src 'none'"
    return respuesta


# ===========================================================================
# HOME
# ===========================================================================
@require_GET
@requiere_login()
def resumen(request):
    # [Lógica unificada] MySQL calcula el estado con la MISMA regla que Item.estado().
    # "criticos" = Sin stock + Crítico (antes excluía los ítems en 0, que son el peor caso).
    por_estado = dict(anotar_estado(Item.objects.annotate(total=total_stock_subquery()))
                      .values('estado_calc').annotate(n=Count('id')).values_list('estado_calc', 'n'))
    criticos = sum(por_estado.get(e, 0) for e in ESTADOS_ALERTA)
    prestamos = Prestamo.objects.filter(fecha_devolucion__isnull=True)
    pendientes = Solicitud.objects.filter(estado='Pendiente')
    if request.user.rol not in VEN_TODA_LA_BODEGA:
        prestamos = prestamos.filter(trabajador=request.user)
        pendientes = pendientes.filter(trabajador=request.user)
    data = {
        'bodegas': Bodega.objects.count(),
        'criticos': criticos,
        'stock_bajo': por_estado.get('Stock bajo', 0),
        'prestamos_activos': prestamos.count(),
        'solicitudes_pendientes': pendientes.count(),
        'mis_prestamos_activos': Prestamo.objects.filter(fecha_devolucion__isnull=True, trabajador=request.user).count(),
        'mis_solicitudes_pendientes': Solicitud.objects.filter(estado='Pendiente', trabajador=request.user).count(),
        'pedidos_pendientes': (PedidoAdmin.objects.filter(estado='Pendiente').count() if request.user.rol == 'admin'
                               else PedidoAdmin.objects.filter(estado='Pendiente', solicitante=request.user).count()),
    }
    if request.user.rol in GESTION_USUARIOS:
        activos = Usuario.objects.filter(is_active=True, eliminado_en__isnull=True)
        data.update({
            'usuarios_activos': activos.count(),
            'claves_temporales': activos.filter(debe_cambiar_password=True).count(),
            'prestamos_vencidos': Prestamo.objects.filter(fecha_devolucion__isnull=True,
                                                          fecha_limite__lt=timezone.now()).count(),
        })
    return JsonResponse(data)


# ===========================================================================
# ===========================================================================
@require_GET
@requiere_login(roles=GESTION_USUARIOS)
def usuarioData(request):
    # [Optimizado] Antes se preguntaba "¿tiene historial?" con 4 consultas POR CADA usuario
    # (problema N+1). Ahora MySQL lo responde para todos en UNA sola consulta con EXISTS.
    # [Soft delete] Los eliminados no aparecen salvo que se pida la papelera (?eliminados=1)
    eliminados = request.GET.get('eliminados') == '1'
    usuarios = (Usuario.objects.filter(eliminado_en__isnull=not eliminados)
                .annotate(prestamos_activos=Count('prestamos', filter=Q(prestamos__fecha_devolucion__isnull=True)))
                .order_by('first_name', 'last_name'))

    def puede_eliminar(u):
        # Ya no importa el historial: el borrado es lógico y el historial se conserva.
        # Solo se impide si todavía tiene herramientas sin devolver.
        return (u != request.user and puede_gestionar(request.user, u)
                and not u.eliminado_en and not u.prestamos_activos)

    return JsonResponse({'usuarios': [
        {**usuario_a_dict(u), 'puede_eliminar': puede_eliminar(u),
         'puede_editar': puede_gestionar(request.user, u) and not u.eliminado_en,
         'eliminado': fecha_cl(u.eliminado_en)}
        for u in usuarios
    ]})


@require_POST
@requiere_login(roles=GESTION_USUARIOS)
def usuarioRegistro(request):
    data = leer_json(request)
    if not puede_asignar_rol(request.user, data.get('rol')):
        return JsonResponse({'errores': {'rol': ['Solo un administrador puede crear cuentas de administrador.']}},
                            status=400)
    form = forms.UsuarioForm(data)
    if not form.is_valid():
        return errores(form)
    usuario = form.save()
    return JsonResponse({'usuario': usuario_a_dict(usuario)}, status=201)


def generar_password_temporal():
    """10 caracteres con mayúscula, número y símbolo (cumple los requisitos)."""
    letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'
    todos = letras + '23456789#$%&*'
    clave = [secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ'), secrets.choice('23456789'), secrets.choice('#$%&*')]
    clave += [secrets.choice(todos) for _ in range(7)]
    secrets.SystemRandom().shuffle(clave)
    return ''.join(clave)


@require_GET
@requiere_login(roles=GESTION_USUARIOS)
def usuarioDetalle(request, id):
    usuario = get_object_or_404(Usuario, id=id, eliminado_en__isnull=True)
    return JsonResponse({'usuario': {**usuario_a_dict(usuario), 'puede_editar': puede_gestionar(request.user, usuario)}})


@require_POST
@requiere_login(roles=GESTION_USUARIOS)
def editarUsuario(request, id):
    usuario = get_object_or_404(Usuario, id=id, eliminado_en__isnull=True)
    if not puede_gestionar(request.user, usuario):
        return sin_permiso('Solo un administrador puede modificar cuentas de administrador.')
    # Lo que React no mande se mantiene como estaba
    data = {'rol': usuario.rol, 'is_active': usuario.is_active, **leer_json(request)}
    if usuario == request.user and (data['rol'] != request.user.rol or not data['is_active']):
        return JsonResponse({'error': 'No puedes cambiar tu propio rol ni desactivarte a ti mismo.'}, status=400)
    if not puede_asignar_rol(request.user, data['rol']):
        return JsonResponse({'errores': {'rol': ['Solo un administrador puede asignar el rol Administrador.']}},
                            status=400)
    form = forms.UsuarioEditarForm(data, instance=usuario)
    if not form.is_valid():
        return errores(form)
    usuario = form.save()
    return JsonResponse({'usuario': usuario_a_dict(usuario)})


@require_POST
@requiere_login(roles=GESTION_USUARIOS)
def resetPassword(request, id):
    """Pone una contraseña temporal nueva; el usuario deberá cambiarla al entrar."""
    usuario = get_object_or_404(Usuario, id=id, eliminado_en__isnull=True)
    if not puede_gestionar(request.user, usuario):
        return sin_permiso('Solo un administrador puede cambiar la clave de un administrador.')
    temporal = generar_password_temporal()
    usuario.set_password(temporal)
    usuario.debe_cambiar_password = True
    usuario.save()
    return JsonResponse({'usuario': usuario_a_dict(usuario), 'password_temporal': temporal})


@require_POST
@requiere_login(roles=GESTION_USUARIOS)
def eliminarUsuario(request, id):
    """[Soft delete] Ya no se borra la fila: queda inactiva y oculta, con su historial intacto."""
    usuario = get_object_or_404(Usuario, id=id, eliminado_en__isnull=True)
    if not puede_gestionar(request.user, usuario):
        return sin_permiso('Solo un administrador puede eliminar cuentas de administrador.')
    if usuario == request.user:
        return JsonResponse({'error': 'No puedes eliminar tu propia cuenta.'}, status=400)
    if usuario.prestamos.filter(fecha_devolucion__isnull=True).exists():
        return JsonResponse({'error': 'Este usuario tiene herramientas sin devolver. '
                                      'Recíbelas antes de eliminar la cuenta.'}, status=400)
    usuario.eliminar()
    return JsonResponse({'ok': True})


@require_POST
@requiere_login(roles=GESTION_USUARIOS)
def restaurarUsuario(request, id):
    """Recupera una cuenta eliminada (queda INACTIVA: hay que activarla a propósito)."""
    usuario = get_object_or_404(Usuario, id=id, eliminado_en__isnull=False)
    if not puede_gestionar(request.user, usuario):
        return sin_permiso('Solo un administrador puede restaurar cuentas de administrador.')
    correo = usuario.email.strip().lower()
    if Usuario.objects.filter(username__iexact=correo).exclude(pk=usuario.pk).exists():
        return JsonResponse({'error': f'Ya existe otra cuenta con el correo {correo}.'}, status=400)
    usuario.username = correo
    usuario.eliminado_en = None
    usuario.save(update_fields=['username', 'eliminado_en'])
    return JsonResponse({'usuario': usuario_a_dict(usuario)})


@require_GET
@requiere_login()   # [Seguridad] antes respondía sin iniciar sesión
def rolesData(request):
    roles = [(v, t) for v, t in Usuario.ROLES
             if not request.user.is_authenticated or puede_asignar_rol(request.user, v)]
    return JsonResponse({'roles': [{'valor': v, 'texto': t} for v, t in roles]})


# ===========================================================================
# BODEGAS  (mismo patrón que empleados: listar / agregar / editar / eliminar)
# ===========================================================================
@require_GET
@requiere_login()
def bodegaData(request):
    bodegas = anotar_bodegas(Bodega.objects.annotate(
        total_ocupado=Coalesce(Sum('stocks__cantidad'), 0),
        items_distintos=Count('stocks__item', filter=Q(stocks__cantidad__gt=0), distinct=True),
    )).order_by('nombre')
    return JsonResponse({'bodegas': [bodega_a_dict(b) for b in bodegas]})


def anotar_bodegas(qs):
    """Capacidad (suma de espacios) y cantidad de estantes/áreas, con subconsultas para no
    multiplicar filas al combinarse con la suma de stock."""
    vivos = Espacio.objects.filter(bodega=OuterRef('pk'))
    def contar(**f):
        return Coalesce(Subquery(vivos.filter(**f).values('bodega').annotate(n=Count('id')).values('n')), 0)
    return qs.annotate(
        capacidad_espacios=Coalesce(Subquery(vivos.values('bodega').annotate(t=Sum('capacidad')).values('t')), 0),
        n_estantes=contar(tipo='estante'), n_areas=contar(tipo='area'),
    )


@require_POST
@requiere_login(roles=['admin'])
def bodegaRegistro(request):
    """Crea la bodega con sus espacios iniciales: N estantes iguales y/o un área libre."""
    form = forms.BodegaNuevaForm(leer_json(request))
    if not form.is_valid():
        return errores(form)
    d = form.cleaned_data
    with transaction.atomic():
        b = form.save()
        for n in range(1, (d.get('estantes') or 0) + 1):
            Espacio.objects.create(bodega=b, tipo='estante', nombre=f'Estante {n}', capacidad=d['capacidad_estante'])
        if d.get('capacidad_area'):
            Espacio.objects.create(bodega=b, tipo='area', nombre='Área libre principal', capacidad=d['capacidad_area'])
    return JsonResponse(bodega_a_dict(anotar_bodegas(Bodega.objects.filter(pk=b.pk)).get()), status=201)


@require_POST
@requiere_login(roles=['admin'])
def editarBodega(request, id):
    bodega = get_object_or_404(Bodega, id=id)
    form = forms.BodegaForm(leer_json(request), instance=bodega)
    if not form.is_valid():
        return errores(form)
    b = form.save()
    return JsonResponse(bodega_a_dict(anotar_bodegas(Bodega.objects.filter(pk=b.pk)).get()))


@require_POST
@requiere_login(roles=['admin'])
def eliminarBodega(request, id):
    bodega = get_object_or_404(Bodega, id=id)
    with transaction.atomic():
        bodega = Bodega.objects.select_for_update().get(pk=bodega.pk)
        if bodega.stocks.filter(cantidad__gt=0).exists():
            return JsonResponse({'error': 'La bodega todavía tiene stock. Muévelo o ajústalo a 0 antes de eliminarla.'},
                                status=400)
        if Prestamo.objects.filter(bodega=bodega, fecha_devolucion__isnull=True).exists():
            return JsonResponse({'error': 'La bodega tiene préstamos activos: las herramientas deben volver a ella. '
                                          'Recíbelas antes de eliminarla.'}, status=400)
        # [Soft delete] La bodega queda en el historial (préstamos, registro de movimientos) pero deja de usarse
        bodega.eliminar(request.user)
        for espacio in bodega.espacios.all():   # sus estantes y áreas también van a la papelera
            espacio.eliminar(request.user)
    return JsonResponse({'ok': True})


# ===========================================================================
# CATEGORÍAS
# ===========================================================================
def categoria_a_dict(c, productos=None, subcategorias=None):
    return {
        'id': c.id, 'nombre': c.nombre, 'prefijo': c.prefijo, 'ruta': c.ruta(),
        'padre_id': c.padre_id, 'padre': c.padre.nombre if c.padre_id else None,
        'tipo': c.tipo, 'tipo_texto': c.get_tipo_display(),
        'unidad_medida': c.unidad_medida, 'unidad': simbolo_unidad(c.unidad_medida) if c.unidad_medida else '',
        'productos': productos if productos is not None else c.items.count(),
        'subcategorias': subcategorias if subcategorias is not None else c.subcategorias.count(),
    }


def unidades_medida_data():
    return [{'grupo': grupo, 'opciones': [{'valor': v, 'texto': texto, 'simbolo': simbolo_unidad(v)}
                                          for v, texto in opciones]}
            for grupo, opciones in UNIDADES_MEDIDA]


def ids_categoria_y_subcategorias(categoria_id):
    return [categoria_id, *Categoria.objects.filter(padre_id=categoria_id).values_list('id', flat=True)]


@require_GET
@requiere_login()
def categoriaData(request):
    categorias = (Categoria.objects.select_related('padre').annotate(
        n_productos=Count('items', filter=Q(items__eliminado_en__isnull=True), distinct=True),
        n_subcategorias=Count('subcategorias', filter=Q(subcategorias__eliminado_en__isnull=True), distinct=True))
        .order_by('nombre'))
    lista = [categoria_a_dict(c, c.n_productos, c.n_subcategorias) for c in categorias]
    principales = sorted((c for c in lista if not c['padre_id']), key=lambda c: c['nombre'].lower())
    hijas = {}
    for c in lista:
        if c['padre_id']:
            hijas.setdefault(c['padre_id'], []).append(c)
    ordenadas = []
    for c in principales:
        ordenadas.append(c)
        ordenadas.extend(sorted(hijas.get(c['id'], []), key=lambda x: x['nombre'].lower()))
    return JsonResponse({'categorias': ordenadas, 'unidades_medida': unidades_medida_data()})


@require_POST
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def categoriaRegistro(request):
    form = forms.CategoriaForm(leer_json(request))
    if not form.is_valid():
        return errores(form)
    c = form.save()
    return JsonResponse(categoria_a_dict(c, 0, 0), status=201)


@require_POST
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def editarCategoria(request, id):
    categoria = get_object_or_404(Categoria, id=id)
    data = {'prefijo': categoria.prefijo, 'padre': categoria.padre_id, 'tipo': categoria.tipo,
            'unidad_medida': categoria.unidad_medida, **leer_json(request)}
    form = forms.CategoriaForm(data, instance=categoria)
    if not form.is_valid():
        return errores(form)
    c = form.save()
    return JsonResponse(categoria_a_dict(c))


@require_POST
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def eliminarCategoria(request, id):
    categoria = get_object_or_404(Categoria, id=id)
    if categoria.items.exists():
        return JsonResponse({'error': 'No puedes eliminar una categoría con productos asociados.'}, status=400)
    if categoria.subcategorias.exists():
        return JsonResponse({'error': 'Esta categoría tiene subcategorías: elimínalas o muévelas primero.'}, status=400)
    categoria.eliminar(request.user)
    return JsonResponse({'ok': True})


# ===========================================================================
# ÍTEMS / CATÁLOGO
# ===========================================================================
@require_GET
@requiere_login()
def itemData(request):
    """
    Catálogo. [Rendimiento] Filtra en MySQL (antes React recibía TODO y filtraba en el navegador).
    Filtros: q (nombre o SKU; un código de herramienta escaneado busca su SKU), categoria, tipo,
             bodega, estado (Disponible / Stock bajo / Crítico / Sin stock / alerta).
    Paginación opcional: ?page=1&page_size=25. Sin "page" responde la lista completa
    (lo usan los formularios y el catálogo del trabajador).
    """
    p = request.GET
    items = (Item.objects.select_related('categoria__padre').prefetch_related('stocks__bodega', 'stocks__espacio')
             .annotate(total=total_stock_subquery()))
    q = p.get('q', '').strip()[:100]
    if q:
        codigo = normalizar_codigo(q)
        sku_de_unidad = codigo.rsplit('-', 1)[0] if codigo and codigo.count('-') == 2 else None
        filtro = Q(nombre__icontains=q) | Q(sku__istartswith=q)
        if sku_de_unidad:
            filtro |= Q(sku=sku_de_unidad)
        items = items.filter(filtro)
    if p.get('categoria', '').isdigit():
        items = items.filter(categoria_id__in=ids_categoria_y_subcategorias(int(p['categoria'])))
    if p.get('tipo') in dict(Item.TIPOS):
        items = items.filter(tipo=p['tipo'])
    if p.get('bodega', '').isdigit():
        items = items.filter(stocks__bodega_id=p['bodega'], stocks__cantidad__gt=0).distinct()
    estado = p.get('estado')
    if estado in ESTADOS_STOCK or estado == 'alerta':
        items = anotar_estado(items).filter(
            estado_calc__in=ESTADOS_ALERTA if estado == 'alerta' else [estado])
    orden = {'nombre': 'nombre', 'sku': 'sku', 'stock': 'total', '-stock': '-total'}.get(p.get('orden'), 'nombre')
    items = items.order_by(orden, 'id')

    if 'page' not in p:
        return JsonResponse({'items': [item_a_dict(i) for i in items]})

    try:
        tamano = min(max(int(p.get('page_size', 25)), 1), 100)
    except ValueError:
        tamano = 25
    pagina = Paginator(items, tamano).get_page(p.get('page'))
    # Contadores por estado sobre TODO el catálogo (para las tarjetas de colores)
    conteo = dict(anotar_estado(Item.objects.annotate(total=total_stock_subquery()))
                  .values('estado_calc').annotate(n=Count('id')).values_list('estado_calc', 'n'))
    return JsonResponse({
        'items': [item_a_dict(i) for i in pagina.object_list],
        'total': pagina.paginator.count,
        'pagina': pagina.number,
        'paginas': pagina.paginator.num_pages,
        'conteo_estados': {e: conteo.get(e, 0) for e in ESTADOS_STOCK},
    })


@require_GET
@requiere_login()
def itemDetalle(request, sku):
    item = get_object_or_404(Item, sku=sku)
    return JsonResponse({'item': item_a_dict(item)})


@require_POST
@requiere_login(roles=['admin', 'bodeguero'])
def itemRegistro(request):
    form = forms.ItemForm(leer_json(request))
    if not form.is_valid():
        return errores(form)
    try:
        with transaction.atomic():
            item = form.save()
            cantidad, espacio = form.cleaned_data['stock'], form.cleaned_data.get('espacio')
            if cantidad:
                # [Registro + capacidad con bloqueo] el ingreso inicial pasa por el servicio de stock
                servicio_stock.sumar(item, espacio, cantidad, 'ingreso', request.user, 'Stock inicial al registrar')
                if item.tipo == 'herramienta':
                    crear_unidades(item, espacio, cantidad)
    except CapacidadExcedida as e:
        return JsonResponse({'errores': {'stock': [str(e)]}}, status=400)
    return JsonResponse({'item': item_a_dict(item), 'unidades_creadas': item.unidades.count()}, status=201)


@require_POST
@requiere_login(roles=['admin', 'bodeguero'])
def editarItem(request, sku):
    item = get_object_or_404(Item, sku=sku)
    data = {
        'categoria': item.categoria_id, 'tipo': item.tipo, 'stock_minimo': item.stock_minimo,
        'unidad_medida': item.unidad_medida,
        **leer_json(request),
    }
    form = forms.ItemForm(data, instance=item)
    if not form.is_valid():
        return errores(form)
    try:
        with transaction.atomic():
            item = form.save()
            # Si mandan bodega + stock, se AJUSTA el stock de esa bodega.
            # [Concurrencia] Antes se sobrescribía con update_or_create sin bloqueo: una entrega
            # hecha mientras el formulario estaba abierto se perdía. Ahora la fila se bloquea,
            # se compara con lo que vio el usuario (stock_esperado) y queda registrado en el registro de movimientos.
            espacio = form.cleaned_data.get('espacio')
            if espacio:
                servicio_stock.fijar(item, espacio, form.cleaned_data['stock'], request.user,
                                     esperado=form.cleaned_data.get('stock_esperado'),
                                     motivo=str(data.get('motivo') or 'Ajuste desde el formulario del ítem'))
                if item.tipo == 'herramienta':
                    ajustar_unidades(item, espacio, form.cleaned_data['stock'])
    except CapacidadExcedida as e:
        return JsonResponse({'errores': {'stock': [str(e)]}}, status=400)
    except StockDesactualizado as e:
        return JsonResponse({'error': str(e), 'conflicto': True}, status=409)
    item = Item.objects.select_related('categoria__padre').prefetch_related('stocks__bodega', 'stocks__espacio').get(pk=item.pk)
    return JsonResponse({'item': item_a_dict(item)})


@require_POST
@requiere_login(roles=['admin'])
def eliminarItem(request, sku):
    """[Soft delete] El ítem desaparece del catálogo pero sigue en préstamos, solicitudes y registro de movimientos."""
    with transaction.atomic():
        item = get_object_or_404(Item.objects.select_for_update(), sku=sku)
        if Stock.objects.filter(item=item, cantidad__gt=0).exists():
            return JsonResponse({'error': 'El ítem todavía tiene stock. Ajústalo a 0 antes de eliminarlo.'}, status=400)
        if item.prestamos.filter(fecha_devolucion__isnull=True).exists():
            return JsonResponse({'error': 'El ítem tiene préstamos sin devolver.'}, status=400)
        if item.solicitudes.filter(estado='Pendiente').exists():
            return JsonResponse({'error': 'El ítem tiene solicitudes pendientes de entrega.'}, status=400)
        item.eliminar(request.user)
    return JsonResponse({'ok': True})


@require_GET
@requiere_login(roles=['admin', 'bodeguero'])
def itemUnidades(request, sku):
    item = get_object_or_404(Item, sku=sku)
    unidades = item.unidades.select_related('bodega', 'espacio', 'item').prefetch_related('prestamos__trabajador')
    if request.GET.get('estado'):
        unidades = unidades.filter(estado=request.GET['estado'])
    return JsonResponse({
        'item': item_a_dict(item),
        'unidades': [unidad_a_dict(u, prestamo_activo_de(u)) for u in unidades],
    })


def espacio_de(unidad):
    """Espacio de una herramienta (las antiguas sin espacio usan el de por defecto de su bodega)."""
    if not unidad.espacio_id:
        unidad.espacio = unidad.bodega.espacio_por_defecto()
        unidad.save(update_fields=['espacio'])
    return unidad.espacio


def no_existe_codigo(codigo):
    return JsonResponse({'error': f'No existe una herramienta con el código {str(codigo)[:30]}.'}, status=404)


def buscar_unidad(codigo, bloquear=False):
    """[Validación] Normaliza el código (mayúsculas, sin espacios, formato válido) ANTES de buscar.
    Antes la consulta distinguía mayúsculas en unas pantallas y en otras no."""
    codigo = normalizar_codigo(codigo)
    if not codigo:
        return None
    qs = Unidad.objects.select_related('bodega', 'espacio', 'item')
    if bloquear:
        qs = qs.select_for_update()
    return qs.filter(codigo=codigo).first()


@require_GET
@requiere_login(roles=['admin', 'bodeguero'])
def unidadDetalle(request, codigo):
    unidad = buscar_unidad(codigo)
    if not unidad:
        return no_existe_codigo(codigo)
    return JsonResponse({'unidad': unidad_a_dict(unidad, prestamo_activo_de(unidad))})


@require_POST
@requiere_login(roles=['admin', 'bodeguero'])
def bajaUnidad(request, codigo):
    try:
        with transaction.atomic():
            unidad = buscar_unidad(codigo, bloquear=True)
            if not unidad:
                return no_existe_codigo(codigo)
            if unidad.estado == 'Prestada':
                return JsonResponse({'error': 'La herramienta está prestada: primero debe devolverse.'}, status=400)
            if unidad.estado == 'De baja':
                return JsonResponse({'error': 'La herramienta ya estaba dada de baja.'}, status=400)
            unidad.estado = 'De baja'
            unidad.save(update_fields=['estado'])
            # [Consistencia] Antes: "if stock > 0: -1" y si no alcanzaba, se ignoraba en silencio
            # (stock y códigos quedaban descuadrados). Ahora si no cuadra, se revierte todo.
            servicio_stock.restar(unidad.item, espacio_de(unidad), 1, 'baja', request.user,
                                  str(leer_json(request).get('motivo') or 'Baja de herramienta'), unidad=unidad)
    except StockInsuficiente:
        return JsonResponse({'error': 'El stock de esta herramienta no cuadra con sus códigos. '
                                      'Revisa el inventario de la bodega.'}, status=409)
    return JsonResponse({'unidad': unidad_a_dict(unidad)})


@require_POST
@requiere_login(roles=['admin', 'bodeguero'])
def reactivarUnidad(request, codigo):
    try:
        with transaction.atomic():
            unidad = buscar_unidad(codigo, bloquear=True)
            if not unidad:
                return no_existe_codigo(codigo)
            if unidad.estado != 'De baja':
                return JsonResponse({'error': 'Solo se pueden reactivar herramientas dadas de baja.'}, status=400)
            # [Capacidad con bloqueo] sumar() bloquea la bodega antes de verificar el espacio
            servicio_stock.sumar(unidad.item, espacio_de(unidad), 1, 'reactivacion', request.user,
                                 'Reactivación de herramienta', unidad=unidad)
            unidad.estado = 'Disponible'
            unidad.save(update_fields=['estado'])
    except CapacidadExcedida as e:
        return JsonResponse({'error': str(e)}, status=400)
    return JsonResponse({'unidad': unidad_a_dict(unidad)})


# ===========================================================================
# SOLICITUDES
# ===========================================================================
@require_GET
@requiere_login()
def solicitudData(request):
    solicitudes = (Solicitud.objects.select_related('trabajador', 'item__categoria__padre', 'bodeguero')
                   .prefetch_related('item__stocks').order_by('-fecha'))
    if request.user.rol not in VEN_TODA_LA_BODEGA or request.GET.get('mias') == '1':
        solicitudes = solicitudes.filter(trabajador=request.user)  # solo las suyas
    lista, total_historial = con_historial_reciente(solicitudes, Q(estado='Pendiente'))
    return JsonResponse({'solicitudes': [solicitud_a_dict(s) for s in lista], 'total_historial': total_historial,
                         'limite_historial': LIMITE_HISTORIAL})


@require_POST
@requiere_login()
def solicitudRegistro(request):
    data = leer_json(request)
    # React manda el SKU; el formulario necesita el id del ítem
    item = Item.objects.filter(sku=data.get('sku')).first()
    data['item'] = item.id if item else None
    form = forms.SolicitudForm(data)
    if not form.is_valid():
        return errores(form)
    solicitud = form.save(commit=False)
    solicitud.trabajador = request.user
    # [CRUD admin] El administrador puede registrar una solicitud a nombre de un trabajador
    if request.user.rol == 'admin' and str(data.get('trabajador') or '').isdigit():
        trabajador = Usuario.objects.filter(pk=data['trabajador'], eliminado_en__isnull=True, is_active=True).first()
        if not trabajador:
            return JsonResponse({'errores': {'trabajador': ['Elige un trabajador activo.']}}, status=400)
        solicitud.trabajador = trabajador
    solicitud.stock_al_solicitar = form.stock_disponible
    solicitud.save()
    return JsonResponse({'solicitud': solicitud_a_dict(solicitud)}, status=201)


@require_POST
@requiere_login(roles=['admin', 'bodeguero'])
def entregarSolicitud(request, id):
    """El bodeguero entrega: se descuenta stock y, si es herramienta, nace un préstamo.

    [Concurrencia - corrección crítica] Antes el stock disponible se leía SIN bloqueo y, tras
    descontar, nadie verificaba que se hubiera sacado todo: con dos entregas simultáneas la
    segunda podía quedar "Despachada" habiendo descontado menos de lo pedido.
    Ahora: 1) se bloquean TODAS las filas de stock del ítem, 2) se calcula el disponible sobre
    esas filas bloqueadas, 3) cualquier faltante lanza StockInsuficiente y se revierte TODO.
    """
    try:
        with transaction.atomic():
            solicitud = get_object_or_404(Solicitud.objects.select_for_update(), id=id)
            if solicitud.estado != 'Pendiente':
                return JsonResponse({'error': 'Esta solicitud ya fue entregada.'}, status=400)

            item = solicitud.item
            filas = servicio_stock.bloquear_filas_item(item)        # ← bloqueo antes de leer
            disponible = sum(f.cantidad for f in filas)
            if disponible < solicitud.cantidad:
                return JsonResponse({'error': f'No hay stock suficiente: se piden {solicitud.cantidad} y hay {disponible}. '
                                              f'Faltan {solicitud.cantidad - disponible} unidades; repón stock '
                                              f'desde "Catálogo y stock" antes de entregar.'}, status=400)
            motivo = f'Solicitud #{solicitud.id} de {solicitud.trabajador.nombre_completo()}'

            if item.tipo == 'herramienta':
                elegidas, error = elegir_unidades(item, solicitud.cantidad, leer_json(request).get('unidades'))
                if error:
                    return JsonResponse({'error': error}, status=400)
                por_espacio = {f.espacio_id: f for f in filas}
                for unidad in elegidas:
                    fila = por_espacio.get(espacio_de(unidad).pk)
                    if fila is None:
                        raise StockInsuficiente(f'{unidad.codigo} no tiene stock registrado en {unidad.espacio}.')
                    servicio_stock.mover(fila, -1, 'entrega', request.user, motivo, solicitud=solicitud, unidad=unidad)
                    unidad.estado = 'Prestada'
                    unidad.save(update_fields=['estado'])
                bodega_principal = elegidas[0].bodega
            else:
                faltan = solicitud.cantidad
                bodega_principal = None
                for fila in sorted(filas, key=lambda f: -f.cantidad):   # primero la bodega con más stock
                    if faltan == 0:
                        break
                    sacar = min(faltan, fila.cantidad)
                    if sacar:
                        servicio_stock.mover(fila, -sacar, 'entrega', request.user, motivo, solicitud=solicitud)
                        bodega_principal = bodega_principal or fila.bodega
                        faltan -= sacar
                if faltan:   # [Stock negativo / entrega parcial] nunca se despacha a medias
                    raise StockInsuficiente(f'Faltan {faltan} unidades para completar la entrega.')

            solicitud.estado = 'Despachada'
            solicitud.bodeguero = request.user
            solicitud.save(update_fields=['estado', 'bodeguero'])

            if item.tipo == 'herramienta':
                prestamo = Prestamo.objects.create(
                    solicitud=solicitud, item=item, trabajador=solicitud.trabajador,
                    responsable=request.user, bodega=bodega_principal, cantidad=solicitud.cantidad,
                )
                prestamo.unidades.set(elegidas)
                MovimientoStock.objects.filter(solicitud=solicitud).update(prestamo=prestamo)
    except StockInsuficiente as e:
        return JsonResponse({'error': f'No se entregó nada: {e}'}, status=409)
    return JsonResponse({'solicitud': solicitud_a_dict(solicitud)})


def elegir_unidades(item, cantidad, codigos):
    disponibles = servicio_stock.solo_esta_tabla(Unidad.objects.select_related('bodega').filter(item=item, estado='Disponible'))
    if codigos is None:
        return None, 'Escanea el código de barras de cada herramienta que entregas.'
    if not isinstance(codigos, list) or not all(isinstance(c, str) for c in codigos):
        return None, 'Envía la lista de códigos de las herramientas que se entregan.'
    codigos = [c.strip().upper() for c in codigos]
    if len(set(codigos)) != len(codigos):
        return None, 'Hay códigos repetidos en la entrega.'
    if len(codigos) != cantidad:
        return None, f'Debes elegir exactamente {cantidad} herramienta(s); elegiste {len(codigos)}.'
    elegidas = list(disponibles.filter(codigo__in=codigos))
    if len(elegidas) != len(codigos):
        validos = {u.codigo for u in elegidas}
        malos = ', '.join(c for c in codigos if c not in validos)
        return None, f'Estos códigos no están disponibles para {item.nombre}: {malos}.'
    return elegidas, None


# ===========================================================================
# PRÉSTAMOS
# ===========================================================================
@require_GET
@requiere_login()
def prestamoData(request):
    prestamos = (Prestamo.objects.select_related('item__categoria__padre', 'trabajador', 'responsable', 'bodega')
                 .prefetch_related('unidades').order_by('-fecha_entrega'))
    if request.user.rol not in VEN_TODA_LA_BODEGA or request.GET.get('mias') == '1':
        prestamos = prestamos.filter(trabajador=request.user)
    lista, total_historial = con_historial_reciente(prestamos, Q(fecha_devolucion__isnull=True, anulado=False))
    return JsonResponse({'prestamos': [prestamo_a_dict(p) for p in lista], 'total_historial': total_historial,
                         'limite_historial': LIMITE_HISTORIAL})


@require_GET
@requiere_login()
def prestamoDetalle(request, id):
    prestamo = get_object_or_404(Prestamo, id=id)
    if request.user.rol not in VEN_TODA_LA_BODEGA and prestamo.trabajador != request.user:
        return sin_permiso()
    return JsonResponse({'prestamo': prestamo_a_dict(prestamo)})


@require_POST
@requiere_login()
def devolverPrestamo(request, id):
    with transaction.atomic():
        prestamo = get_object_or_404(Prestamo.objects.select_for_update(), id=id)
        if prestamo.trabajador != request.user:
            if request.user.rol in VEN_TODA_LA_BODEGA:
                return JsonResponse({'error': 'Para recibir la herramienta de otro trabajador usa "Recibir" en Préstamos '
                                              'y escanea su código.'}, status=400)
            return sin_permiso()
        if not prestamo.activo():
            return JsonResponse({'error': 'Este préstamo ya fue devuelto.'}, status=400)
        if prestamo.estado_devolucion:
            return JsonResponse({'error': 'Ya avisaste esta devolución: entrega la herramienta en bodega.'}, status=400)

        form = forms.DevolucionForm(leer_json(request), instance=prestamo)
        if not form.is_valid():
            return errores(form)
        prestamo = form.save()
    return JsonResponse({'prestamo': prestamo_a_dict(prestamo)})


@require_POST
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def recibirPrestamo(request, id):
    data = leer_json(request)
    with transaction.atomic():
        prestamo = get_object_or_404(Prestamo.objects.select_for_update(), id=id)
        if not prestamo.activo():
            return JsonResponse({'error': 'Este préstamo ya fue recibido.'}, status=400)

        unidades = list(prestamo.unidades.select_for_update().filter(estado='Prestada'))
        esperados = {u.codigo for u in unidades}
        codigos = data.get('unidades')
        if not isinstance(codigos, list) or not all(isinstance(c, str) for c in codigos):
            return JsonResponse({'error': 'Escanea el código de barras de cada herramienta que recibes.'}, status=400)
        codigos = {c.strip().upper() for c in codigos}
        ajenos = codigos - esperados
        if ajenos:
            return JsonResponse({'error': f'Estos códigos no son de este préstamo: {", ".join(sorted(ajenos))}.'}, status=400)
        faltan = esperados - codigos
        if faltan:
            return JsonResponse({'error': f'Falta escanear: {", ".join(sorted(faltan))}.'}, status=400)

        if not prestamo.estado_devolucion:
            form = forms.DevolucionForm(data, instance=prestamo)
            if not form.is_valid():
                return errores(form)
            prestamo = form.save(commit=False)
        prestamo.fecha_devolucion = timezone.now()
        prestamo.save()

        # [Concurrencia - corrección crítica] Antes: get_or_create + "cantidad += 1" sin bloqueo.
        # Dos recepciones simultáneas leían el mismo saldo y se perdía una unidad.
        # Ahora la fila se bloquea y el movimiento queda en el registro de movimientos. No se verifica capacidad:
        # la herramienta ya ocupaba ese lugar antes de prestarse y físicamente está de vuelta.
        motivo = f'Préstamo #{prestamo.id} devuelto por {prestamo.trabajador.nombre_completo()}'
        if prestamo.estado_devolucion == 'Con falla':
            for unidad in unidades:
                unidad.estado = 'De baja'
                unidad.save(update_fields=['estado'])
        elif unidades:
            for unidad in unidades:
                unidad.estado = 'Disponible'
                unidad.save(update_fields=['estado'])
                servicio_stock.sumar(prestamo.item, espacio_de(unidad), 1, 'devolucion', request.user, motivo,
                                     verificar_capacidad=False, prestamo=prestamo, unidad=unidad)
        else:
            servicio_stock.sumar(prestamo.item, prestamo.bodega.espacio_por_defecto(), prestamo.cantidad,
                                 'devolucion', request.user,
                                 motivo, verificar_capacidad=False, prestamo=prestamo)
    return JsonResponse({'prestamo': prestamo_a_dict(prestamo)})


# ===========================================================================
# NOTIFICACIONES: lo que cada rol tiene pendiente de revisar
# Devuelve grupos: {tipo, titulo, cantidad, nivel, enlace, items[]} (solo los que tienen algo)
# ===========================================================================
MAX_ITEMS_NOTIF = 4  # cuántos ejemplos se muestran por grupo


def grupo_notif(tipo, titulo, nivel, enlace, consulta, item):
    """Arma un grupo con el total y los primeros ejemplos (2 consultas por grupo)."""
    cantidad = consulta.count()
    if not cantidad:
        return None
    return {
        'tipo': tipo, 'titulo': titulo, 'nivel': nivel, 'enlace': enlace, 'cantidad': cantidad,
        'items': [item(x) for x in consulta[:MAX_ITEMS_NOTIF]],
    }


def cuanto_falta(dt):
    """'vence en 5 h' / 'venció hace 3 días'."""
    horas = int((dt - timezone.now()).total_seconds() // 3600)
    if horas >= 0:
        return f'vence en {horas} h'
    dias = max(1, -horas // 24)
    return f'venció hace {dias} día' + ('s' if dias > 1 else '')


@require_GET
@requiere_login()
def notificaciones(request):
    u = request.user
    ahora = timezone.now()
    en_48h = ahora + timezone.timedelta(hours=48)
    prestamos = (Prestamo.objects.filter(fecha_devolucion__isnull=True)
                 .select_related('item', 'trabajador').order_by('fecha_limite'))
    texto_prestamo = lambda p: {'texto': f'{p.item.nombre} · {p.trabajador.nombre_completo()}',
                                'detalle': cuanto_falta(p.fecha_limite)}
    grupos = []

    if u.rol == 'trabajador':
        mios = prestamos.filter(trabajador=u)
        texto_mio = lambda p: {'texto': p.item.nombre, 'detalle': cuanto_falta(p.fecha_limite)}
        grupos += [
            grupo_notif('vencidos', 'Herramientas vencidas: devuélvelas', 'danger', '/prestamos',
                        mios.filter(fecha_limite__lt=ahora), texto_mio),
            grupo_notif('por_vencer', 'Herramientas que vencen pronto', 'warning', '/prestamos',
                        mios.filter(fecha_limite__gte=ahora, fecha_limite__lte=en_48h), texto_mio),
            grupo_notif('recibidas', 'Herramientas entregadas en los últimos 3 días', 'success', '/prestamos',
                        Prestamo.objects.filter(trabajador=u, fecha_entrega__gte=ahora - timezone.timedelta(days=3))
                        .select_related('item').order_by('-fecha_entrega'),
                        lambda p: {'texto': p.item.nombre, 'detalle': f'entregada el {fecha_cl(p.fecha_entrega)}'}),
            grupo_notif('mis_pendientes', 'Solicitudes esperando entrega', 'info', '/prestamos?vista=pendientes',
                        Solicitud.objects.filter(trabajador=u, estado='Pendiente').select_related('item').order_by('-fecha'),
                        lambda s: {'texto': f'{s.item.nombre} × {s.cantidad}', 'detalle': f'pedida el {fecha_cl(s.fecha)}'}),
        ]
    elif u.rol == 'rrhh':
        grupos += [
            grupo_notif('vencidos', 'Trabajadores con herramientas vencidas', 'danger',
                        '/reportes?tipo=prestamos&estado=vencidos', prestamos.filter(fecha_limite__lt=ahora),
                        lambda p: {'texto': p.trabajador.nombre_completo(),
                                   'detalle': f'{p.item.nombre} · {cuanto_falta(p.fecha_limite)}'}),
        ]
    else:
        # Misma regla que el inicio y el catálogo: Sin stock + Crítico
        criticos = (anotar_estado(Item.objects.annotate(total=total_stock_subquery()))
                    .filter(estado_calc__in=ESTADOS_ALERTA).order_by('total', 'nombre'))
        grupos += [
            grupo_notif('solicitudes', 'Solicitudes por entregar', 'warning', '/solicitudes',
                        Solicitud.objects.filter(estado='Pendiente').select_related('item', 'trabajador').order_by('fecha'),
                        lambda s: {'texto': f'{s.trabajador.nombre_completo()} · {s.item.nombre} × {s.cantidad}',
                                   'detalle': f'pedida el {fecha_cl(s.fecha)}'
                                              + (' · supera el stock' if s.excede_stock() else '')}),
            grupo_notif('por_recibir', 'Herramientas por recibir en bodega', 'primary', '/prestamos',
                        prestamos.exclude(estado_devolucion=''), texto_prestamo),
            grupo_notif('vencidos', 'Préstamos vencidos', 'danger', '/prestamos',
                        prestamos.filter(fecha_limite__lt=ahora), texto_prestamo),
            grupo_notif('por_vencer', 'Préstamos que vencen en 48 h', 'warning', '/prestamos',
                        prestamos.filter(fecha_limite__gte=ahora, fecha_limite__lte=en_48h), texto_prestamo),
            grupo_notif('stock', 'Ítems en stock crítico o sin stock', 'danger', '/catalogo', criticos,
                        lambda i: {'texto': f'{i.sku} · {i.nombre}',
                                   'detalle': 'sin stock' if i.total == 0 else f'quedan {i.total} (mín. {i.stock_minimo})'}),
        ]
    if u.rol == 'admin':
        grupos.append(grupo_notif(
            'pedidos', 'Pedidos al administrador por responder', 'warning', '/pedidos?estado=Pendiente',
            PedidoAdmin.objects.filter(estado='Pendiente').select_related('solicitante', 'item').order_by('fecha'),
            lambda x: {'texto': f'{x.solicitante.nombre_completo()} · {x.producto()} × {x.cantidad}',
                       'detalle': f'{x.get_prioridad_display().lower()} · pedido el {fecha_cl(x.fecha)}'}))
    else:
        grupos.append(grupo_notif(
            'pedidos_respondidos', 'Respuestas del administrador a tus pedidos', 'info', '/pedidos',
            PedidoAdmin.objects.filter(solicitante=u, estado__in=['Aprobado', 'Rechazado'],
                                       fecha_respuesta__gte=ahora - timezone.timedelta(days=7))
            .select_related('item').order_by('-fecha_respuesta'),
            lambda x: {'texto': f'{x.producto()} × {x.cantidad}', 'detalle': x.estado.lower()}))
    if u.rol in GESTION_USUARIOS:
        grupos += [
            grupo_notif('claves', 'Usuarios que no han cambiado su clave temporal', 'info', '/usuarios',
                        Usuario.objects.filter(is_active=True, debe_cambiar_password=True).order_by('first_name'),
                        lambda x: {'texto': x.nombre_completo(), 'detalle': x.email}),
            grupo_notif('nuevos', 'Cuentas creadas en los últimos 7 días', 'success', '/usuarios',
                        Usuario.objects.filter(date_joined__gte=ahora - timezone.timedelta(days=7),
                                               eliminado_en__isnull=True).order_by('-date_joined'),
                        lambda x: {'texto': x.nombre_completo(), 'detalle': dict(Usuario.ROLES).get(x.rol, x.rol)}),
        ]

    grupos = [g for g in grupos if g]
    return JsonResponse({'total': sum(g['cantidad'] for g in grupos), 'grupos': grupos})


# ===========================================================================
# REPORTES (solo administrador)
# ===========================================================================
class FiltroInvalido(Exception):
    pass


def fecha_hora(dt):
    """Formato AAAA-MM-DD HH:MM: se lee bien y DataTables lo ordena correctamente."""
    return timezone.localtime(dt).strftime('%Y-%m-%d %H:%M') if dt else '—'


def leer_fecha(texto, nombre):
    if not texto:
        return None
    try:
        return date.fromisoformat(texto)
    except ValueError:
        raise FiltroInvalido(f'La fecha "{nombre}" no es válida (usa AAAA-MM-DD).')


def filtrar_rango(qs, campo, params, etiqueta, filtros):
    desde = leer_fecha(params.get('desde'), 'desde')
    hasta = leer_fecha(params.get('hasta'), 'hasta')
    if desde and hasta and desde > hasta:
        raise FiltroInvalido('La fecha "desde" no puede ser posterior a "hasta".')
    if desde:
        qs = qs.filter(**{f'{campo}__gte': timezone.make_aware(datetime.combine(desde, time.min))})
    if hasta:
        qs = qs.filter(**{f'{campo}__lt': timezone.make_aware(datetime.combine(hasta + timedelta(days=1), time.min))})
    if desde or hasta:
        a = desde.strftime('%d-%m-%Y') if desde else 'el inicio'
        b = hasta.strftime('%d-%m-%Y') if hasta else 'hoy'
        filtros.append(f'{etiqueta}: {a} a {b}')
    return qs


def leer_id(params, nombre, modelo, etiqueta, filtros, texto=str):
    valor = params.get(nombre)
    if not valor:
        return None
    obj = modelo.objects.filter(pk=valor).first() if str(valor).isdigit() else None
    if obj is None:
        raise FiltroInvalido(f'El filtro "{etiqueta}" no es válido.')
    filtros.append(f'{etiqueta}: {texto(obj)}')
    return obj


def tarjeta(titulo, valor, tono=None):
    return {'titulo': titulo, 'valor': valor, 'tono': tono}


def reporte_usuarios(p):
    filtros = []
    roles = dict(Usuario.ROLES)
    usuarios = Usuario.objects.filter(eliminado_en__isnull=True).annotate(
        activos=Count('prestamos', filter=Q(prestamos__fecha_devolucion__isnull=True), distinct=True),
        n_solicitudes=Count('solicitudes', distinct=True),
    )
    estado = p.get('estado') or 'activos'
    if estado == 'activos':
        usuarios = usuarios.filter(is_active=True)
        filtros.append('Estado: activos')
    elif estado == 'inactivos':
        usuarios = usuarios.filter(is_active=False)
        filtros.append('Estado: inactivos')
    if p.get('rol') in roles:
        usuarios = usuarios.filter(rol=p['rol'])
        filtros.append(f'Rol: {roles[p["rol"]]}')
    if p.get('q'):
        q = p['q'].strip()
        usuarios = usuarios.filter(Q(first_name__icontains=q) | Q(last_name__icontains=q)
                                   | Q(email__icontains=q) | Q(telefono__icontains=q))
        filtros.append(f'Búsqueda: "{q}"')
    usuarios = filtrar_rango(usuarios, 'date_joined', p, 'Creados', filtros)
    usuarios = list(usuarios.order_by('first_name', 'last_name'))

    por_rol = {r: sum(1 for u in usuarios if u.rol == r) for r in roles}
    return {
        'titulo': 'Usuarios',
        'columnas': ['Nombre', 'Correo', 'Teléfono', 'Rol', 'Estado', 'Creado', 'Último acceso',
                     'Solicitudes', 'Préstamos activos'],
        'filas': [
            [u.nombre_completo(), u.email, u.telefono or '—', roles.get(u.rol, u.rol),
             'Activo' if u.is_active else 'Inactivo', fecha_hora(u.date_joined), fecha_hora(u.last_login),
             u.n_solicitudes, u.activos]
            for u in usuarios
        ],
        'resumen': [
            tarjeta('Usuarios', len(usuarios)),
            tarjeta('Administradores', por_rol['admin']),
            tarjeta('Bodegueros', por_rol['bodeguero']),
            tarjeta('Trabajadores', por_rol['trabajador']),
            tarjeta('Recursos humanos', por_rol['rrhh']),
            tarjeta('Con préstamos activos', sum(1 for u in usuarios if u.activos), 'warning'),
        ],
        'filtros': filtros,
    }


def reporte_bodegas(p):
    filtros = []
    suma_stock = (Stock.objects.filter(bodega=OuterRef('pk')).values('bodega')
                  .annotate(t=Sum('cantidad')).values('t'))
    activos = (Prestamo.objects.filter(bodega=OuterRef('pk'), fecha_devolucion__isnull=True)
               .values('bodega').annotate(n=Count('id')).values('n'))
    bodegas = anotar_bodegas(Bodega.objects.annotate(
        total_ocupado=Coalesce(Subquery(suma_stock), 0),
        items_distintos=Count('stocks__item', filter=Q(stocks__cantidad__gt=0), distinct=True),
        prestamos_activos=Coalesce(Subquery(activos), 0),
    )).order_by('nombre')
    bodega = leer_id(p, 'bodega', Bodega, 'Bodega', filtros)
    if bodega:
        bodegas = bodegas.filter(pk=bodega.pk)
    if p.get('q'):
        q = p['q'].strip()
        bodegas = bodegas.filter(Q(nombre__icontains=q) | Q(ubicacion__icontains=q))
        filtros.append(f'Búsqueda: "{q}"')
    bodegas = list(bodegas)
    ocupacion = p.get('ocupacion')
    if ocupacion == 'alta':
        bodegas = [b for b in bodegas if b.porcentaje_ocupado() >= 80]
        filtros.append('Ocupación: 80 % o más')
    elif ocupacion == 'con_espacio':
        bodegas = [b for b in bodegas if b.porcentaje_ocupado() < 80]
        filtros.append('Ocupación: menos de 80 %')

    capacidad = sum(b.capacidad_total() for b in bodegas)
    ocupado = sum(b.ocupado() for b in bodegas)
    return {
        'titulo': 'Bodegas',
        'columnas': ['Bodega', 'Ubicación', 'Superficie (m²)', 'Estantes', 'Áreas libres', 'Unidades en stock',
                     'Capacidad', 'Espacio disponible', '% ocupación', 'Ítems distintos', 'Préstamos activos'],
        'filas': [
            [b.nombre, b.ubicacion or '—', float(b.area_m2), b.n_estantes, b.n_areas, b.ocupado(),
             b.capacidad_total(), b.disponible(), b.porcentaje_ocupado(), b.items_distintos, b.prestamos_activos]
            for b in bodegas
        ],
        'resumen': [
            tarjeta('Bodegas', len(bodegas)),
            tarjeta('Superficie total', f'{sum(float(b.area_m2) for b in bodegas):,.0f} m²'.replace(',', '.')),
            tarjeta('Capacidad total', capacidad),
            tarjeta('Unidades guardadas', ocupado),
            tarjeta('Espacio disponible', max(capacidad - ocupado, 0), 'success'),
            tarjeta('Ocupación', f'{round(ocupado * 100 / capacidad) if capacidad else 0} %'),
        ],
        'filtros': filtros,
    }


ESTADOS_ITEM = ['Disponible', 'Stock bajo', 'Crítico', 'Sin stock']


def reporte_items(p):
    filtros = []
    items = Item.objects.select_related('categoria__padre').prefetch_related('stocks').order_by('nombre')
    categoria = leer_id(p, 'categoria', Categoria, 'Categoría', filtros)
    if categoria:
        items = items.filter(categoria_id__in=ids_categoria_y_subcategorias(categoria.id))
    tipos = dict(Item.TIPOS)
    if p.get('tipo') in tipos:
        items = items.filter(tipo=p['tipo'])
        filtros.append(f'Tipo: {tipos[p["tipo"]]}')
    bodega = leer_id(p, 'bodega', Bodega, 'Bodega', filtros)
    if bodega:
        items = items.filter(stocks__bodega=bodega, stocks__cantidad__gt=0).distinct()
    if p.get('q'):
        q = p['q'].strip()
        items = items.filter(Q(nombre__icontains=q) | Q(sku__icontains=q))
        filtros.append(f'Búsqueda: "{q}"')
    items = list(items)
    if p.get('estado') in ESTADOS_ITEM:
        items = [i for i in items if i.estado() == p['estado']]
        filtros.append(f'Estado: {p["estado"]}')

    bodegas = [bodega] if bodega else list(Bodega.objects.order_by('nombre'))
    filas = []
    for i in items:
        por_bodega = stock_por_bodega(i, clave=lambda s: s.bodega_id)
        filas.append(
            [i.sku, i.nombre, i.categoria.ruta(), i.get_tipo_display()]
            + [por_bodega.get(b.id, 0) for b in bodegas]
            + [i.stock_total(), i.stock_minimo, i.estado()]
        )
    return {
        'titulo': 'Materiales y herramientas',
        'columnas': ['SKU', 'Nombre', 'Categoría', 'Tipo'] + [b.nombre for b in bodegas]
                    + ['Total', 'Stock mínimo', 'Estado'],
        'filas': filas,
        'resumen': [
            tarjeta('Ítems', len(items)),
            tarjeta('Unidades' + (f' en {bodega.nombre}' if bodega else ''),
                    sum(f[4] if bodega else f[-3] for f in filas)),
            tarjeta('Stock bajo', sum(1 for i in items if i.estado() == 'Stock bajo'), 'warning'),
            tarjeta('Críticos', sum(1 for i in items if i.estado() == 'Crítico'), 'danger'),
            tarjeta('Sin stock', sum(1 for i in items if i.estado() == 'Sin stock'), 'secondary'),
        ],
        'filtros': filtros,
    }


def reporte_prestamos(p):
    filtros = []
    ahora = timezone.now()
    prestamos = (Prestamo.objects.select_related('item', 'trabajador', 'responsable', 'bodega')
                 .prefetch_related('unidades'))
    prestamos = filtrar_rango(prestamos, 'fecha_entrega', p, 'Entregados', filtros)
    estado = p.get('estado')
    if estado == 'activos':
        prestamos = prestamos.filter(fecha_devolucion__isnull=True)
        filtros.append('Estado: sin devolver')
    elif estado == 'vencidos':
        prestamos = prestamos.filter(fecha_devolucion__isnull=True, fecha_limite__lt=ahora)
        filtros.append('Estado: vencidos')
    elif estado == 'devueltos':
        prestamos = prestamos.filter(fecha_devolucion__isnull=False)
        filtros.append('Estado: devueltos')
    if p.get('condicion') in dict(Prestamo.ESTADOS_DEVOLUCION):
        prestamos = prestamos.filter(estado_devolucion=p['condicion'])
        filtros.append(f'Devuelto en estado: {p["condicion"]}')
    trabajador = leer_id(p, 'trabajador', Usuario, 'Trabajador', filtros, lambda u: u.nombre_completo())
    if trabajador:
        prestamos = prestamos.filter(trabajador=trabajador)
    bodega = leer_id(p, 'bodega', Bodega, 'Bodega', filtros)
    if bodega:
        prestamos = prestamos.filter(bodega=bodega)
    prestamos = list(prestamos.order_by('-fecha_entrega'))

    def situacion(x):
        if x.fecha_devolucion:
            return f'Devuelto ({x.estado_devolucion})' if x.estado_devolucion else 'Devuelto'
        if x.estado_devolucion:
            return 'Por recibir'
        return 'Vencido' if x.fecha_limite < ahora else 'En préstamo'

    return {
        'titulo': 'Préstamos de herramientas',
        'columnas': ['SKU', 'Herramienta', 'Códigos', 'Trabajador', 'Bodega', 'Entregado por', 'Entrega',
                     'Fecha límite', 'Devolución', 'Estado'],
        'filas': [
            [x.item.sku, x.item.nombre, ', '.join(u.codigo for u in x.unidades.all()) or '—',
             x.trabajador.nombre_completo(), x.bodega.nombre,
             x.responsable.nombre_completo(), fecha_hora(x.fecha_entrega), fecha_hora(x.fecha_limite),
             fecha_hora(x.fecha_devolucion), situacion(x)]
            for x in prestamos
        ],
        'resumen': [
            tarjeta('Préstamos', len(prestamos)),
            tarjeta('Sin devolver', sum(1 for x in prestamos if not x.fecha_devolucion), 'primary'),
            tarjeta('Vencidos', sum(1 for x in prestamos if not x.fecha_devolucion and x.fecha_limite < ahora),
                    'danger'),
            tarjeta('Devueltos', sum(1 for x in prestamos if x.fecha_devolucion), 'success'),
            tarjeta('Devueltos con falla', sum(1 for x in prestamos if x.estado_devolucion == 'Con falla'),
                    'warning'),
        ],
        'filtros': filtros,
    }


def reporte_solicitudes(p):
    filtros = []
    solicitudes = Solicitud.objects.select_related('trabajador', 'item', 'bodeguero')
    solicitudes = filtrar_rango(solicitudes, 'fecha', p, 'Solicitadas', filtros)
    if p.get('estado') in dict(Solicitud.ESTADOS):
        solicitudes = solicitudes.filter(estado=p['estado'])
        filtros.append(f'Estado: {p["estado"]}')
    tipos = dict(Item.TIPOS)
    if p.get('tipo') in tipos:
        solicitudes = solicitudes.filter(item__tipo=p['tipo'])
        filtros.append(f'Tipo: {tipos[p["tipo"]]}')
    trabajador = leer_id(p, 'trabajador', Usuario, 'Trabajador', filtros, lambda u: u.nombre_completo())
    if trabajador:
        solicitudes = solicitudes.filter(trabajador=trabajador)
    if p.get('excede') == 'si':
        solicitudes = solicitudes.filter(stock_al_solicitar__isnull=False, cantidad__gt=F('stock_al_solicitar'))
        filtros.append('Solo las que superan el stock')
    solicitudes = list(solicitudes.order_by('-fecha'))

    return {
        'titulo': 'Solicitudes de materiales y herramientas',
        'columnas': ['Fecha', 'Trabajador', 'SKU', 'Producto', 'Tipo', 'Cantidad', 'Stock al pedir',
                     'Supera stock', 'Motivo', 'Estado', 'Entregado por'],
        'filas': [
            [fecha_hora(x.fecha), x.trabajador.nombre_completo(), x.item.sku, x.item.nombre,
             x.item.get_tipo_display(), x.cantidad,
             x.stock_al_solicitar if x.stock_al_solicitar is not None else '—',
             'Sí' if x.excede_stock() else 'No', x.motivo or '—', x.estado,
             x.bodeguero.nombre_completo() if x.bodeguero else '—']
            for x in solicitudes
        ],
        'resumen': [
            tarjeta('Solicitudes', len(solicitudes)),
            tarjeta('Pendientes', sum(1 for x in solicitudes if x.estado == 'Pendiente'), 'primary'),
            tarjeta('Despachadas', sum(1 for x in solicitudes if x.estado == 'Despachada'), 'success'),
            tarjeta('Superan el stock', sum(1 for x in solicitudes if x.excede_stock()), 'danger'),
            tarjeta('Unidades pedidas', sum(x.cantidad for x in solicitudes)),
        ],
        'filtros': filtros,
    }


REPORTES = {
    'usuarios': reporte_usuarios,
    'bodegas': reporte_bodegas,
    'items': reporte_items,
    'prestamos': reporte_prestamos,
    'solicitudes': reporte_solicitudes,
}


REPORTES_POR_ROL = {
    'admin': set(REPORTES),
    'rrhh': {'usuarios', 'prestamos', 'solicitudes'},
}


@require_GET
@requiere_login(roles=list(REPORTES_POR_ROL))
def reporte(request, tipo):
    if tipo not in REPORTES:
        return JsonResponse({'error': 'Reporte no existe.'}, status=404)
    if tipo not in REPORTES_POR_ROL[request.user.rol]:
        return sin_permiso('Este reporte no está disponible para tu rol.')
    try:
        data = REPORTES[tipo](request.GET)
    except FiltroInvalido as e:
        return JsonResponse({'error': str(e)}, status=400)
    data['generado'] = fecha_hora(timezone.now())
    data['graficos'] = graficos_de(tipo, data)   # gráficos con los mismos filtros
    return JsonResponse(data)


# ===========================================================================
# REGISTRO DE MOVIMIENTOS: historial de movimientos de stock (nuevo)
# ===========================================================================
@require_GET
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def movimientoData(request):
    """Filtros: sku, bodega, tipo, desde, hasta. Paginado (?page=, page_size<=100)."""
    p = request.GET
    filtros = []
    movimientos = MovimientoStock.objects.select_related('item', 'bodega', 'espacio', 'usuario', 'reversion')
    if p.get('sku'):
        movimientos = movimientos.filter(item__sku=str(p['sku']).strip().upper()[:10])
    if p.get('bodega', '').isdigit():
        movimientos = movimientos.filter(bodega_id=p['bodega'])
    if p.get('tipo') in dict(MovimientoStock.TIPOS):
        movimientos = movimientos.filter(tipo=p['tipo'])
    try:
        movimientos = filtrar_rango(movimientos, 'fecha', p, 'Fecha', filtros)
    except FiltroInvalido as e:
        return JsonResponse({'error': str(e)}, status=400)
    try:
        # page_size hasta 2000: la tabla (DataTables) pagina y busca en el navegador
        tamano = min(max(int(p.get('page_size', 50)), 1), 2000)
    except ValueError:
        tamano = 50
    pagina = Paginator(movimientos, tamano).get_page(p.get('page'))
    tipos = dict(MovimientoStock.TIPOS)
    return JsonResponse({
        'movimientos': [{
            'id': m.id, 'fecha': fecha_hora(m.fecha), 'tipo': m.tipo, 'tipo_texto': tipos.get(m.tipo, m.tipo),
            'sku': m.item.sku, 'item': m.item.nombre, 'bodega': m.bodega.nombre,
            'espacio': m.espacio.nombre if m.espacio_id else '—', 'cantidad': m.cantidad,
            'saldo': m.saldo, 'usuario': m.usuario.nombre_completo() if m.usuario else 'Sistema', 'motivo': m.motivo,
            # Solo los movimientos manuales de MATERIALES se revierten aquí (las herramientas
            # tienen códigos y se corrigen desde "Códigos")
            'revertible': (m.item.tipo == 'material' and m.revierte_id is None and not hasattr_reversion(m)
                           and m.tipo in ('ingreso', 'ajuste', 'salida')),
            'revertido': hasattr_reversion(m), 'es_reversion': m.revierte_id is not None,
        } for m in pagina.object_list],
        'total': pagina.paginator.count, 'pagina': pagina.number, 'paginas': pagina.paginator.num_pages,
    })


# ===========================================================================
# DASHBOARD: datos para los gráficos de CoreUI (nuevo)
# ===========================================================================
@require_GET
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def dashboard(request):
    dias = 14
    hoy = timezone.localdate()
    inicio = timezone.make_aware(datetime.combine(hoy - timedelta(days=dias - 1), time.min))
    etiquetas = [(hoy - timedelta(days=dias - 1 - i)) for i in range(dias)]

    def por_dia(qs, campo):
        conteo = {}
        for momento in qs.filter(**{f'{campo}__gte': inicio}).values_list(campo, flat=True):
            dia = timezone.localtime(momento).date()
            conteo[dia] = conteo.get(dia, 0) + 1
        return [conteo.get(d, 0) for d in etiquetas]

    bodegas = (anotar_bodegas(Bodega.objects.annotate(ocupado_total=Coalesce(Sum('stocks__cantidad'), 0)))
               .order_by('nombre').values('nombre', 'capacidad_espacios', 'ocupado_total'))
    categorias = (Categoria.objects.annotate(unidades=Coalesce(Sum('items__stocks__cantidad',
                                                                   filter=Q(items__eliminado_en__isnull=True)), 0))
                  .order_by('-unidades').values('nombre', 'unidades'))
    estados = dict(anotar_estado(Item.objects.annotate(total=total_stock_subquery()))
                   .values('estado_calc').annotate(n=Count('id')).values_list('estado_calc', 'n'))
    top = (Prestamo.objects.filter(fecha_entrega__gte=timezone.now() - timedelta(days=90))
           .values('item__nombre').annotate(n=Count('id')).order_by('-n')[:5])
    ahora = timezone.now()
    activos = Prestamo.objects.filter(fecha_devolucion__isnull=True)
    return JsonResponse({
        'dias': [d.strftime('%d-%m') for d in etiquetas],
        'solicitudes_por_dia': por_dia(Solicitud.objects, 'fecha'),
        'prestamos_por_dia': por_dia(Prestamo.objects, 'fecha_entrega'),
        'devoluciones_por_dia': por_dia(Prestamo.objects.filter(fecha_devolucion__isnull=False), 'fecha_devolucion'),
        'bodegas': [{'nombre': b['nombre'], 'capacidad': b['capacidad_espacios'], 'ocupado': b['ocupado_total']}
                    for b in bodegas],
        'categorias': list(categorias),
        'estados_stock': {e: estados.get(e, 0) for e in ESTADOS_STOCK},
        'top_prestados': [{'nombre': t['item__nombre'], 'prestamos': t['n']} for t in top],
        'prestamos': {
            'en_plazo': activos.filter(fecha_limite__gte=ahora).count(),
            'vencidos': activos.filter(fecha_limite__lt=ahora).count(),
            'devueltos_30d': Prestamo.objects.filter(fecha_devolucion__gte=ahora - timedelta(days=30)).count(),
        },
        'movimientos_7d': MovimientoStock.objects.filter(fecha__gte=ahora - timedelta(days=7)).count(),
    })


# ===========================================================================
# CRUD COMPLETO DEL ADMINISTRADOR (nuevo)
# ===========================================================================
@require_POST
@requiere_login(roles=['admin'])
def editarSolicitud(request, id):
    """El admin corrige cantidad o motivo de una solicitud que aún no se entrega."""
    data = leer_json(request)
    with transaction.atomic():
        s = get_object_or_404(servicio_stock.solo_esta_tabla(Solicitud.objects.select_related('item', 'trabajador')), id=id)
        if s.estado != 'Pendiente':
            return JsonResponse({'error': 'Solo se pueden editar solicitudes pendientes.'}, status=400)
        try:
            cantidad = int(data.get('cantidad'))
        except (TypeError, ValueError):
            cantidad = None
        maximo = forms.SolicitudForm.MAX_CANTIDAD
        if cantidad is None or not 1 <= cantidad <= maximo:
            return JsonResponse({'errores': {'cantidad': [f'Ingresa un número entero entre 1 y {maximo}.']}}, status=400)
        s.cantidad = cantidad
        s.motivo = str(data.get('motivo') or '').strip()[:2000]
        s.stock_al_solicitar = s.item.stock_total()
        s.save(update_fields=['cantidad', 'motivo', 'stock_al_solicitar'])
    return JsonResponse({'solicitud': solicitud_a_dict(s)})


@require_POST
@requiere_login()
def cancelarSolicitud(request, id):
    """El admin cancela cualquier solicitud pendiente; el trabajador, solo las suyas.
    No se borra: queda como "Cancelada" en el historial."""
    with transaction.atomic():
        s = get_object_or_404(Solicitud.objects.select_for_update(), id=id)
        if request.user.rol != 'admin' and s.trabajador_id != request.user.id:
            return sin_permiso()
        if s.estado != 'Pendiente':
            return JsonResponse({'error': 'Solo se pueden cancelar solicitudes pendientes.'}, status=400)
        s.estado = 'Cancelada'
        s.save(update_fields=['estado'])
    return JsonResponse({'solicitud': solicitud_a_dict(s)})


@require_POST
@requiere_login(roles=['admin'])
def editarPrestamo(request, id):
    """El admin extiende o corrige la fecha límite y el comentario de un préstamo."""
    data = leer_json(request)
    with transaction.atomic():
        p = get_object_or_404(servicio_stock.solo_esta_tabla(Prestamo.objects.select_related('item', 'trabajador', 'responsable')),
                              id=id)
        errores_ = {}
        if 'fecha_limite' in data:
            if not p.activo():
                errores_['fecha_limite'] = ['El préstamo ya fue devuelto: su plazo no se puede cambiar.']
            else:
                try:
                    dia = date.fromisoformat(str(data['fecha_limite']))
                except ValueError:
                    dia = None
                entrega = timezone.localtime(p.fecha_entrega).date()
                if dia is None:
                    errores_['fecha_limite'] = ['Usa una fecha válida (AAAA-MM-DD).']
                elif dia < entrega or dia > entrega + timedelta(days=365):
                    errores_['fecha_limite'] = ['Debe estar entre la fecha de entrega y un año después.']
                else:
                    p.fecha_limite = timezone.make_aware(datetime.combine(dia, time(23, 59)))
        if 'comentario' in data:
            p.comentario = str(data.get('comentario') or '').strip()[:2500]
        if errores_:
            return JsonResponse({'errores': errores_}, status=400)
        p.save(update_fields=['fecha_limite', 'comentario'])
    return JsonResponse({'prestamo': prestamo_a_dict(p)})


# ---- Papelera: bodegas, categorías e ítems eliminados (soft delete) ----------
MODELOS_PAPELERA = {'bodegas': Bodega, 'categorias': Categoria, 'items': Item}
SUFIJO_ELIMINADO = re.compile(r' ·eliminado \d+$')


def nombre_original(obj):
    return SUFIJO_ELIMINADO.sub('', obj.nombre)


@require_GET
@requiere_login(roles=['admin'])
def papelera(request):
    datos = {}
    for tipo, modelo in MODELOS_PAPELERA.items():
        qs = modelo.todos.filter(eliminado_en__isnull=False).select_related('eliminado_por').order_by('-eliminado_en')
        datos[tipo] = [{
            'id': o.id, 'nombre': nombre_original(o), 'sku': getattr(o, 'sku', None),
            'eliminado': fecha_hora(o.eliminado_en),
            'eliminado_por': o.eliminado_por.nombre_completo() if o.eliminado_por else '—',
        } for o in qs[:200]]
    return JsonResponse(datos)


@require_POST
@requiere_login(roles=['admin'])
def restaurar(request, tipo, id):
    modelo = MODELOS_PAPELERA.get(tipo)
    if not modelo:
        return JsonResponse({'error': 'Tipo no válido.'}, status=404)
    with transaction.atomic():
        obj = get_object_or_404(modelo.todos.select_for_update(), pk=id, eliminado_en__isnull=False)
        if tipo == 'items' and obj.categoria.eliminado_en:
            return JsonResponse({'error': f'Primero restaura la categoría "{nombre_original(obj.categoria)}".'},
                                status=400)
        if tipo == 'categorias' and obj.padre_id and obj.padre.eliminado_en:
            return JsonResponse({'error': f'Primero restaura la categoría principal "{nombre_original(obj.padre)}".'},
                                status=400)
        campos = ['eliminado_en', 'eliminado_por']
        if modelo.CAMPO_NOMBRE_UNICO:
            original = nombre_original(obj)
            if modelo.objects.filter(nombre=original).exists():
                return JsonResponse({'error': f'Ya existe otro registro llamado "{original}". '
                                              f'Renómbralo antes de restaurar este.'}, status=400)
            obj.nombre = original
            campos.append('nombre')
        obj.eliminado_en = None
        obj.eliminado_por = None
        obj.save(update_fields=campos)
    return JsonResponse({'ok': True})


# ===========================================================================
# GRÁFICOS DE LOS REPORTES (nuevo)
# Se calculan a partir de las MISMAS filas del reporte, así que siempre reflejan
# los filtros que el usuario eligió.
# ===========================================================================
def _contar(valores, limite=None):
    conteo = {}
    for v in valores:
        conteo[v] = conteo.get(v, 0) + 1
    pares = sorted(conteo.items(), key=lambda x: -x[1])
    return pares[:limite] if limite else pares


def _sumar(pares, limite=None):
    total = {}
    for etiqueta, valor in pares:
        total[etiqueta] = total.get(etiqueta, 0) + (valor if isinstance(valor, (int, float)) else 0)
    resultado = sorted(total.items(), key=lambda x: -x[1])
    return resultado[:limite] if limite else resultado


def _por_fecha(textos):
    """'2026-11-18 10:30' -> conteo por día (o por mes si hay muchos días)."""
    dias = [t[:10] for t in textos if t and t != '—']
    if len(set(dias)) > 31:
        dias = [d[:7] for d in dias]
    return sorted(_contar(dias))


def grafico(titulo, tipo, pares, color=None, etiqueta='Cantidad'):
    return {'titulo': titulo, 'tipo': tipo, 'etiqueta': etiqueta, 'color': color,
            'etiquetas': [str(e) for e, _ in pares], 'datos': [v for _, v in pares]}


def graficos_de(tipo, data):
    filas, cols = data['filas'], data['columnas']

    def col(nombre):
        i = cols.index(nombre)
        return [f[i] for f in filas]

    if not filas:
        return []
    if tipo == 'items':
        i_tipo, i_total = cols.index('Tipo'), cols.index('Total')
        bodegas = cols[i_tipo + 1:i_total]
        return [
            grafico('Ítems por estado de stock', 'doughnut', _contar(col('Estado'))),
            grafico('Unidades por categoría', 'bar', _sumar(zip(col('Categoría'), col('Total'))), 'primario', 'Unidades'),
            grafico('Unidades por bodega', 'bar',
                    [(b, sum(f[i_tipo + 1 + n] for f in filas)) for n, b in enumerate(bodegas)], 'info', 'Unidades'),
        ]
    if tipo == 'bodegas':
        return [
            grafico('Unidades guardadas por bodega', 'bar', list(zip(col('Bodega'), col('Unidades en stock'))),
                    'primario', 'Unidades'),
            grafico('Espacio disponible por bodega', 'bar', list(zip(col('Bodega'), col('Espacio disponible'))),
                    'exito', 'Unidades libres'),
            grafico('Préstamos activos por bodega', 'doughnut', list(zip(col('Bodega'), col('Préstamos activos')))),
        ]
    if tipo == 'prestamos':
        situaciones = [s.split(' (')[0] for s in col('Estado')]
        return [
            grafico('Préstamos por estado', 'doughnut', _contar(situaciones)),
            grafico('Préstamos entregados en el tiempo', 'line', _por_fecha(col('Entrega')), 'info', 'Préstamos'),
            grafico('Herramientas más prestadas', 'bar', _contar(col('Herramienta'), 8), 'primario', 'Préstamos'),
            grafico('Préstamos por bodega', 'bar', _contar(col('Bodega')), 'exito', 'Préstamos'),
        ]
    if tipo == 'solicitudes':
        return [
            grafico('Solicitudes por estado', 'doughnut', _contar(col('Estado'))),
            grafico('Solicitudes en el tiempo', 'line', _por_fecha(col('Fecha')), 'primario', 'Solicitudes'),
            grafico('Productos más pedidos (unidades)', 'bar', _sumar(zip(col('Producto'), col('Cantidad')), 8),
                    'info', 'Unidades'),
            grafico('Trabajadores que más piden', 'bar', _contar(col('Trabajador'), 8), 'exito', 'Solicitudes'),
        ]
    if tipo == 'usuarios':
        return [
            grafico('Usuarios por rol', 'doughnut', _contar(col('Rol'))),
            grafico('Activos e inactivos', 'doughnut', _contar(col('Estado'))),
            grafico('Usuarios con más solicitudes', 'bar',
                    [p for p in _sumar(zip(col('Nombre'), col('Solicitudes')), 8) if p[1]], 'primario', 'Solicitudes'),
        ]
    return []


# ===========================================================================
# ESPACIOS: estantes y áreas libres de cada bodega (nuevo)
# ===========================================================================
def espacio_a_dict(e):
    return {
        'id': e.id, 'bodega_id': e.bodega_id, 'bodega': e.bodega.nombre, 'tipo': e.tipo,
        'tipo_texto': e.get_tipo_display(), 'nombre': e.nombre, 'capacidad': e.capacidad,
        'niveles': e.niveles, 'area_m2': float(e.area_m2) if e.area_m2 is not None else None,
        'ocupado': e.ocupado(), 'disponible': e.disponible(),
        'porcentaje': round(e.ocupado() * 100 / e.capacidad) if e.capacidad else 0,
        'items': getattr(e, 'items_distintos', None),
    }


def espacios_anotados(qs):
    return (qs.select_related('bodega')
            .annotate(total_ocupado=Coalesce(Sum('stocks__cantidad'), 0),
                      items_distintos=Count('stocks__item', filter=Q(stocks__cantidad__gt=0), distinct=True)))


@require_GET
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def espacioData(request):
    """Todos los espacios (para elegir dónde guardar un ítem). Filtro opcional: ?bodega=<id>."""
    qs = Espacio.objects.filter(bodega__eliminado_en__isnull=True)
    if request.GET.get('bodega', '').isdigit():
        qs = qs.filter(bodega_id=request.GET['bodega'])
    return JsonResponse({'espacios': [espacio_a_dict(e) for e in espacios_anotados(qs).order_by('bodega__nombre',
                                                                                             'tipo', 'nombre')]})


@require_GET
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def espacioDetalle(request, id):
    """Qué hay guardado en un estante o área."""
    espacio = get_object_or_404(espacios_anotados(Espacio.objects.all()), id=id)
    stocks = (Stock.objects.filter(espacio=espacio, cantidad__gt=0).select_related('item', 'item__categoria')
              .order_by('item__nombre'))
    return JsonResponse({'espacio': espacio_a_dict(espacio), 'contenido': [
        {'sku': s.item.sku, 'nombre': s.item.nombre, 'categoria': s.item.categoria.nombre, 'tipo': s.item.tipo,
         'cantidad': s.cantidad} for s in stocks]})


@require_POST
@requiere_login(roles=['admin'])
def espacioRegistro(request, bodega_id):
    bodega = get_object_or_404(Bodega, id=bodega_id)
    form = forms.EspacioForm(leer_json(request), bodega=bodega)
    if not form.is_valid():
        return errores(form)
    espacio = form.save(commit=False)
    espacio.bodega = bodega
    espacio.save()
    return JsonResponse({'espacio': espacio_a_dict(espacios_anotados(Espacio.objects.all()).get(pk=espacio.pk))},
                        status=201)


@require_POST
@requiere_login(roles=['admin'])
def editarEspacio(request, id):
    espacio = get_object_or_404(Espacio, id=id)
    form = forms.EspacioForm(leer_json(request), instance=espacio)
    if not form.is_valid():
        return errores(form)
    form.save()
    return JsonResponse({'espacio': espacio_a_dict(espacios_anotados(Espacio.objects.all()).get(pk=id))})


@require_POST
@requiere_login(roles=['admin'])
def eliminarEspacio(request, id):
    with transaction.atomic():
        espacio = get_object_or_404(Espacio.objects.select_for_update(), id=id)
        if Stock.objects.filter(espacio=espacio, cantidad__gt=0).exists():
            return JsonResponse({'error': f'{espacio.nombre} todavía tiene stock. Trasládalo a otro espacio antes '
                                          f'de eliminarlo.'}, status=400)
        if espacio.unidades.filter(estado='Prestada').exists():
            return JsonResponse({'error': f'Hay herramientas prestadas que deben volver a {espacio.nombre}.'},
                                status=400)
        espacio.eliminar(request.user)   # [Soft delete]
    return JsonResponse({'ok': True})


@require_POST
@requiere_login(roles=VEN_TODA_LA_BODEGA)
def trasladarStock(request, sku):
    """Mueve stock de un estante/área a otro (incluso a otra bodega).
    En herramientas también se mueven sus códigos (las unidades disponibles)."""
    data = leer_json(request)
    item = get_object_or_404(Item, sku=sku)
    try:
        cantidad = int(data.get('cantidad'))
    except (TypeError, ValueError):
        cantidad = 0
    if cantidad < 1:
        return JsonResponse({'errores': {'cantidad': ['Ingresa una cantidad mayor que 0.']}}, status=400)
    origen = Espacio.objects.select_related('bodega').filter(pk=data.get('origen')).first() \
        if str(data.get('origen', '')).isdigit() else None
    destino = Espacio.objects.select_related('bodega').filter(pk=data.get('destino')).first() \
        if str(data.get('destino', '')).isdigit() else None
    if not origen or not destino:
        return JsonResponse({'errores': {'destino': ['Elige el espacio de origen y el de destino.']}}, status=400)
    try:
        with transaction.atomic():
            servicio_stock.trasladar(item, origen, destino, cantidad, request.user,
                                     str(data.get('motivo') or '')[:200])
            if item.tipo == 'herramienta':
                ids = list(Unidad.objects.select_for_update().filter(item=item, espacio=origen, estado='Disponible')
                           .order_by('id').values_list('id', flat=True)[:cantidad])
                if len(ids) < cantidad:
                    raise StockInsuficiente(f'Solo hay {len(ids)} herramienta(s) disponible(s) en {origen.nombre}.')
                Unidad.objects.filter(id__in=ids).update(espacio=destino, bodega=destino.bodega)
    except (StockInsuficiente, CapacidadExcedida) as e:
        return JsonResponse({'error': str(e)}, status=400)
    item = Item.objects.select_related('categoria__padre').prefetch_related('stocks__bodega', 'stocks__espacio').get(pk=item.pk)
    return JsonResponse({'item': item_a_dict(item)})


# ===========================================================================
# CRUD COMPLETO DEL ADMINISTRADOR (2): anular préstamos, movimientos manuales,
# revertir movimientos y eliminar definitivamente desde la papelera
# ===========================================================================
def hasattr_reversion(m):
    try:
        return m.reversion is not None
    except MovimientoStock.DoesNotExist:
        return False


@require_POST
@requiere_login(roles=['admin'])
def anularPrestamo(request, id):
    """Anula un préstamo activo registrado por error: las herramientas vuelven a su lugar,
    la solicitud queda Cancelada y el préstamo sigue en el historial como Anulado."""
    motivo_usuario = str(leer_json(request).get('motivo') or '').strip()[:200]
    with transaction.atomic():
        prestamo = get_object_or_404(servicio_stock.solo_esta_tabla(Prestamo.objects.select_related('item', 'bodega', 'solicitud')),
                                     id=id)
        if not prestamo.activo():
            return JsonResponse({'error': 'Solo se pueden anular préstamos que aún no se devuelven.'}, status=400)
        motivo = f'Préstamo #{prestamo.id} anulado' + (f': {motivo_usuario}' if motivo_usuario else '')
        unidades = list(prestamo.unidades.select_for_update().filter(estado='Prestada'))
        for unidad in unidades:
            unidad.estado = 'Disponible'
            unidad.save(update_fields=['estado'])
            servicio_stock.sumar(prestamo.item, espacio_de(unidad), 1, 'devolucion', request.user, motivo,
                                 verificar_capacidad=False, prestamo=prestamo, unidad=unidad)
        if not unidades:
            servicio_stock.sumar(prestamo.item, prestamo.bodega.espacio_por_defecto(), prestamo.cantidad, 'devolucion',
                                 request.user, motivo, verificar_capacidad=False, prestamo=prestamo)
        prestamo.anulado = True
        prestamo.fecha_devolucion = timezone.now()
        prestamo.comentario = (prestamo.comentario + '\n' if prestamo.comentario else '') + motivo
        prestamo.save(update_fields=['anulado', 'fecha_devolucion', 'comentario'])
        prestamo.solicitud.estado = 'Cancelada'
        prestamo.solicitud.save(update_fields=['estado'])
    return JsonResponse({'prestamo': prestamo_a_dict(prestamo)})


@require_POST
@requiere_login(roles=['admin'])
def movimientoRegistro(request):
    """Movimiento manual de un MATERIAL: ingreso (llegó mercadería), salida (consumo, merma)
    o ajuste (inventario físico: deja el stock en la cantidad contada)."""
    data = leer_json(request)
    item = Item.objects.filter(sku=str(data.get('sku') or '').strip().upper()).first()
    espacio = Espacio.objects.filter(pk=data.get('espacio')).first() if str(data.get('espacio', '')).isdigit() else None
    tipo = data.get('tipo')
    errores_ = {}
    if not item:
        errores_['sku'] = ['Elige un ítem.']
    elif item.tipo != 'material':
        errores_['sku'] = ['Las herramientas tienen un código por unidad: ajusta su stock desde "Editar ítem".']
    if not espacio:
        errores_['espacio'] = ['Elige el estante o área.']
    if tipo not in ('ingreso', 'salida', 'ajuste'):
        errores_['tipo'] = ['Elige ingreso, salida o ajuste.']
    try:
        cantidad = int(data.get('cantidad'))
    except (TypeError, ValueError):
        cantidad = -1
    if cantidad < (0 if tipo == 'ajuste' else 1) or cantidad > forms.MAX_CANTIDAD:
        errores_['cantidad'] = ['Ingresa una cantidad válida.']
    motivo = str(data.get('motivo') or '').strip()[:200]
    if len(motivo) < 3:
        errores_['motivo'] = ['Escribe el motivo (ej. factura 123, merma, inventario de fin de mes).']
    if errores_:
        return JsonResponse({'errores': errores_}, status=400)
    try:
        with transaction.atomic():
            if tipo == 'ingreso':
                servicio_stock.sumar(item, espacio, cantidad, 'ingreso', request.user, motivo)
            elif tipo == 'salida':
                servicio_stock.restar(item, espacio, cantidad, 'salida', request.user, motivo)
            else:
                servicio_stock.fijar(item, espacio, cantidad, request.user, motivo=motivo)
    except (StockInsuficiente, CapacidadExcedida) as e:
        return JsonResponse({'errores': {'cantidad': [str(e)]}}, status=400)
    return JsonResponse({'ok': True}, status=201)


@require_POST
@requiere_login(roles=['admin'])
def revertirMovimiento(request, id):
    """Deshace un movimiento manual creando el movimiento contrario (el original no se borra)."""
    try:
        with transaction.atomic():
            m = get_object_or_404(servicio_stock.solo_esta_tabla(MovimientoStock.objects.select_related('item', 'espacio')), id=id)
            if m.item.tipo != 'material' or m.tipo not in ('ingreso', 'ajuste', 'salida'):
                return JsonResponse({'error': 'Este movimiento no se puede revertir desde aquí.'}, status=400)
            if m.revierte_id or hasattr_reversion(m):
                return JsonResponse({'error': 'Este movimiento ya fue revertido o es una reversión.'}, status=400)
            fila = servicio_stock.bloquear_fila(m.item, m.espacio)
            tipo = 'salida' if m.cantidad > 0 else 'ingreso'
            servicio_stock.mover(fila, -m.cantidad, tipo, request.user, f'Reversión del movimiento #{m.id}',
                                 verificar_capacidad=m.cantidad < 0, revierte=m)
    except (StockInsuficiente, CapacidadExcedida) as e:
        return JsonResponse({'error': f'No se pudo revertir: {e}'}, status=400)
    return JsonResponse({'ok': True})


@require_POST
@requiere_login(roles=['admin'])
def eliminarDefinitivo(request, tipo, id):
    """Borra de verdad algo que está en la papelera. Solo se puede si NO tiene historial
    (préstamos, solicitudes, movimientos): en ese caso se queda en la papelera."""
    modelos = {**MODELOS_PAPELERA, 'usuarios': Usuario}
    modelo = modelos.get(tipo)
    if not modelo:
        return JsonResponse({'error': 'Tipo no válido.'}, status=404)
    gestor = modelo.todos if hasattr(modelo, 'todos') else modelo.objects
    obj = get_object_or_404(gestor, pk=id, eliminado_en__isnull=False)
    if tipo == 'usuarios' and obj == request.user:
        return sin_permiso()
    nombre = nombre_original(obj) if hasattr(obj, 'nombre') else obj.nombre_completo()
    try:
        with transaction.atomic():
            if tipo == 'bodegas':
                Stock.objects.filter(bodega=obj, cantidad=0).delete()
                Espacio.todos.filter(bodega=obj).delete()
            obj.delete()   # borrado físico real (solo llega aquí lo que ya estaba en la papelera)
    except ProtectedError:
        return JsonResponse({'error': f'"{nombre}" tiene historial (préstamos, solicitudes o movimientos) y no se puede '
                                      f'borrar definitivamente. Queda en la papelera.'}, status=400)
    return JsonResponse({'ok': True})


def pedido_a_dict(p):
    return {
        'id': p.id,
        'solicitante': p.solicitante.nombre_completo(),
        'solicitante_id': p.solicitante_id,
        'rol_solicitante': p.solicitante.get_rol_display(),
        'tipo': p.tipo,
        'tipo_texto': p.get_tipo_display(),
        'sku': p.item.sku if p.item_id else None,
        'producto': p.producto(),
        'descripcion': p.descripcion,
        'cantidad': p.cantidad,
        'unidad': p.item.simbolo_unidad() if p.item_id else '',
        'stock_actual': p.item.stock_total() if p.item_id else None,
        'bodega': p.bodega.nombre if p.bodega_id else None,
        'bodega_id': p.bodega_id,
        'motivo': p.motivo,
        'prioridad': p.prioridad,
        'prioridad_texto': p.get_prioridad_display(),
        'estado': p.estado,
        'fecha': fecha_hora(p.fecha),
        'respuesta': p.respuesta,
        'atendido_por': p.atendido_por.nombre_completo() if p.atendido_por_id else None,
        'fecha_respuesta': fecha_hora(p.fecha_respuesta) if p.fecha_respuesta else None,
    }


@require_GET
@requiere_login()
def pedidoData(request):
    pedidos = PedidoAdmin.objects.select_related('solicitante', 'item', 'bodega', 'atendido_por').prefetch_related(
        'item__stocks')
    if request.user.rol != 'admin':
        pedidos = pedidos.filter(solicitante=request.user)
    if request.GET.get('estado') in dict(PedidoAdmin.ESTADOS):
        pedidos = pedidos.filter(estado=request.GET['estado'])
    return JsonResponse({'pedidos': [pedido_a_dict(p) for p in pedidos[:1000]]})


@require_POST
@requiere_login(roles=['bodeguero', 'trabajador', 'rrhh'])
def pedidoRegistro(request):
    data = leer_json(request)
    if data.get('sku'):
        item = Item.objects.filter(sku=str(data['sku']).strip().upper()).first()
        data['item'] = item.id if item else -1
    form = forms.PedidoAdminForm(data)
    if not form.is_valid():
        return errores(form)
    pedido = form.save(commit=False)
    pedido.solicitante = request.user
    pedido.save()
    return JsonResponse({'pedido': pedido_a_dict(pedido)}, status=201)


@require_POST
@requiere_login(roles=['admin'])
def responderPedido(request, id):
    data = leer_json(request)
    estado = data.get('estado')
    respuesta = ' '.join(str(data.get('respuesta') or '').split())[:1000]
    if estado not in ('Aprobado', 'Rechazado'):
        return JsonResponse({'errores': {'estado': ['Elige aprobar o rechazar.']}}, status=400)
    if estado == 'Rechazado' and len(respuesta) < 5:
        return JsonResponse({'errores': {'respuesta': ['Explica por qué se rechaza (mínimo 5 caracteres).']}},
                            status=400)
    with transaction.atomic():
        pedido = get_object_or_404(PedidoAdmin.objects.select_for_update(), id=id)
        if pedido.estado != 'Pendiente':
            return JsonResponse({'error': f'Este pedido ya está {pedido.estado.lower()}.'}, status=400)
        pedido.estado = estado
        pedido.respuesta = respuesta
        pedido.atendido_por = request.user
        pedido.fecha_respuesta = timezone.now()
        pedido.save(update_fields=['estado', 'respuesta', 'atendido_por', 'fecha_respuesta'])
    return JsonResponse({'pedido': pedido_a_dict(pedido)})


@require_POST
@requiere_login()
def cancelarPedido(request, id):
    with transaction.atomic():
        pedido = get_object_or_404(PedidoAdmin.objects.select_for_update(), id=id)
        if pedido.solicitante != request.user:
            return sin_permiso()
        if pedido.estado != 'Pendiente':
            return JsonResponse({'error': f'Este pedido ya está {pedido.estado.lower()}.'}, status=400)
        pedido.estado = 'Cancelado'
        pedido.save(update_fields=['estado'])
    return JsonResponse({'pedido': pedido_a_dict(pedido)})
