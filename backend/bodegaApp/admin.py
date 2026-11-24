from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from bodegaApp.models import Bodega, Categoria, Item, Prestamo, Solicitud, Stock, Usuario


class UsuarioAdmin(UserAdmin):
    list_display = ['username', 'first_name', 'last_name', 'rol', 'telefono']
    list_filter = ['rol']
    fieldsets = UserAdmin.fieldsets + (
        ('Datos de bodega', {'fields': ('telefono', 'rol', 'debe_cambiar_password')}),
    )


class BodegaAdmin(admin.ModelAdmin):
    list_display = ['id', 'nombre']


class CategoriaAdmin(admin.ModelAdmin):
    list_display = ['nombre', 'prefijo']


class StockInline(admin.TabularInline):

    model = Stock
    extra = 1


class ItemAdmin(admin.ModelAdmin):
    list_display = ['sku', 'nombre', 'categoria', 'tipo', 'stock_total', 'estado']
    list_filter = ['categoria', 'tipo']
    search_fields = ['sku', 'nombre']
    readonly_fields = ['sku']
    inlines = [StockInline]


class SolicitudAdmin(admin.ModelAdmin):
    list_display = ['trabajador', 'item', 'cantidad', 'fecha', 'estado']
    list_filter = ['estado']


class PrestamoAdmin(admin.ModelAdmin):
    list_display = ['item', 'trabajador', 'fecha_entrega', 'fecha_limite', 'fecha_devolucion', 'estado_devolucion']


# Register your models here.
admin.site.register(Usuario, UsuarioAdmin)
admin.site.register(Bodega, BodegaAdmin)
admin.site.register(Categoria, CategoriaAdmin)
admin.site.register(Item, ItemAdmin)
admin.site.register(Solicitud, SolicitudAdmin)
admin.site.register(Prestamo, PrestamoAdmin)
