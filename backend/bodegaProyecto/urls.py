from django.contrib import admin
from django.urls import path
from bodegaApp import views as v

urlpatterns = [
    path('admin/', admin.site.urls),

    # Sesión
    path('api/csrf/', v.csrf, name='csrf'),
    path('api/login/', v.iniciarSesion, name='login'),
    path('api/logout/', v.cerrarSesion, name='logout'),
    path('api/yo/', v.usuarioActual, name='usuarioActual'),
    path('api/cambiarPassword/', v.cambiarPassword, name='cambiarPassword'),
    path('api/perfil/', v.editarPerfil, name='editarPerfil'),
    path('api/perfil/foto/', v.subirFotoPerfil, name='subirFotoPerfil'),
    path('api/perfil/quitarFoto/', v.quitarFotoPerfil, name='quitarFotoPerfil'),
    path('api/fotoPerfil/<int:id>/', v.fotoPerfil, name='fotoPerfil'),
    path('api/usuarios/<int:id>/', v.usuarioDetalle, name='detalleUsuario'),

    # Home
    path('api/resumen/', v.resumen, name='resumen'),
    # Usuarios
    path('api/usuarios/', v.usuarioData, name='ListaUsuarios'),
    path('api/addUsuario/', v.usuarioRegistro, name='addUsuario'),
    path('api/roles/', v.rolesData, name='roles'),
    path('api/editarUsuario/<int:id>/', v.editarUsuario, name='editarUsuario'),
    path('api/resetPassword/<int:id>/', v.resetPassword, name='resetPassword'),
    path('api/deleteUsuario/<int:id>/', v.eliminarUsuario, name='eliminarUsuario'),
    path('api/restaurarUsuario/<int:id>/', v.restaurarUsuario, name='restaurarUsuario'),


    # Bodegas
    path('api/bodegas/', v.bodegaData, name='ListaBodegas'),
    path('api/addBodega/', v.bodegaRegistro, name='addBodega'),
    path('api/editarBodega/<int:id>/', v.editarBodega, name='editarBodega'),
    path('api/deleteBodega/<int:id>/', v.eliminarBodega, name='eliminarBodega'),

    # Espacios de cada bodega: estantes y áreas libres
    path('api/espacios/', v.espacioData, name='espacios'),
    path('api/espacios/<int:id>/', v.espacioDetalle, name='detalleEspacio'),
    path('api/bodegas/<int:bodega_id>/addEspacio/', v.espacioRegistro, name='addEspacio'),
    path('api/editarEspacio/<int:id>/', v.editarEspacio, name='editarEspacio'),
    path('api/deleteEspacio/<int:id>/', v.eliminarEspacio, name='eliminarEspacio'),

    # Categorías
    path('api/categorias/', v.categoriaData, name='ListaCategorias'),
    path('api/addCategoria/', v.categoriaRegistro, name='addCategoria'),
    path('api/editarCategoria/<int:id>/', v.editarCategoria, name='editarCategoria'),
    path('api/deleteCategoria/<int:id>/', v.eliminarCategoria, name='eliminarCategoria'),

    # Ítems (catálogo y stock)
    path('api/items/', v.itemData, name='ListaItems'),
    path('api/items/<str:sku>/', v.itemDetalle, name='detalleItem'),
    path('api/addItem/', v.itemRegistro, name='addItem'),
    path('api/editarItem/<str:sku>/', v.editarItem, name='editarItem'),
    path('api/deleteItem/<str:sku>/', v.eliminarItem, name='eliminarItem'),
    path('api/trasladarStock/<str:sku>/', v.trasladarStock, name='trasladarStock'),
    path('api/items/<str:sku>/unidades/', v.itemUnidades, name='unidadesItem'),
    path('api/unidades/<str:codigo>/', v.unidadDetalle, name='detalleUnidad'),
    path('api/bajaUnidad/<str:codigo>/', v.bajaUnidad, name='bajaUnidad'),
    path('api/reactivarUnidad/<str:codigo>/', v.reactivarUnidad, name='reactivarUnidad'),

    # Solicitudes
    path('api/solicitudes/', v.solicitudData, name='ListaSolicitudes'),
    path('api/addSolicitud/', v.solicitudRegistro, name='addSolicitud'),
    path('api/entregarSolicitud/<int:id>/', v.entregarSolicitud, name='entregarSolicitud'),
    path('api/editarSolicitud/<int:id>/', v.editarSolicitud, name='editarSolicitud'),
    path('api/cancelarSolicitud/<int:id>/', v.cancelarSolicitud, name='cancelarSolicitud'),

    # Préstamos
    path('api/prestamos/', v.prestamoData, name='ListaPrestamos'),
    path('api/prestamos/<int:id>/', v.prestamoDetalle, name='detallePrestamo'),
    path('api/devolverPrestamo/<int:id>/', v.devolverPrestamo, name='devolverPrestamo'),
    path('api/recibirPrestamo/<int:id>/', v.recibirPrestamo, name='recibirPrestamo'),
    path('api/editarPrestamo/<int:id>/', v.editarPrestamo, name='editarPrestamo'),
    path('api/anularPrestamo/<int:id>/', v.anularPrestamo, name='anularPrestamo'),

    # Reportes (solo admin): usuarios, bodegas o items
    path('api/reportes/<str:tipo>/', v.reporte, name='reporte'),

    path('api/notificaciones/', v.notificaciones, name='notificaciones'),

    path('api/pedidos/', v.pedidoData, name='ListaPedidos'),
    path('api/addPedido/', v.pedidoRegistro, name='addPedido'),
    path('api/responderPedido/<int:id>/', v.responderPedido, name='responderPedido'),
    path('api/cancelarPedido/<int:id>/', v.cancelarPedido, name='cancelarPedido'),

    # Registro de movimientos y dashboard
    path('api/movimientos/', v.movimientoData, name='movimientos'),
    path('api/addMovimiento/', v.movimientoRegistro, name='addMovimiento'),
    path('api/revertirMovimiento/<int:id>/', v.revertirMovimiento, name='revertirMovimiento'),
    path('api/dashboard/', v.dashboard, name='dashboard'),

    # Papelera (admin): restaurar bodegas, categorías e ítems eliminados
    path('api/papelera/', v.papelera, name='papelera'),
    path('api/restaurar/<str:tipo>/<int:id>/', v.restaurar, name='restaurar'),
    path('api/eliminarDefinitivo/<str:tipo>/<int:id>/', v.eliminarDefinitivo, name='eliminarDefinitivo'),
]
