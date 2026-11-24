import re
from django import forms
from bodegaApp.models import UNIDADES_MEDIDA, Bodega, Categoria, Espacio, Item, PedidoAdmin, Prestamo, Solicitud, Usuario


class BodegaForm(forms.ModelForm):
    """[Bodegas reales] La bodega se describe por su superficie en m². Lo que cabe se define
    en sus ESPACIOS (estantes y áreas libres), no con un número fijo de "unidades"."""
    nombre = forms.CharField(min_length=3, max_length=50)
    ubicacion = forms.CharField(label='Ubicación', min_length=3, max_length=150)
    area_m2 = forms.DecimalField(label='Superficie', min_value=1, max_value=1_000_000, max_digits=10, decimal_places=2)

    class Meta:
        model = Bodega
        fields = ['nombre', 'ubicacion', 'area_m2']


class BodegaNuevaForm(BodegaForm):
    """Al crear una bodega se definen sus espacios iniciales (después se pueden agregar más)."""
    estantes = forms.IntegerField(label='Cantidad de estantes', min_value=0, max_value=200, required=False)
    capacidad_estante = forms.IntegerField(label='Capacidad por estante', min_value=1, max_value=1_000_000,
                                           required=False)
    capacidad_area = forms.IntegerField(label='Capacidad del área libre', min_value=0, max_value=1_000_000,
                                        required=False)

    def clean(self):
        cleaned = super().clean()
        estantes = cleaned.get('estantes') or 0
        if estantes and not cleaned.get('capacidad_estante'):
            self.add_error('capacidad_estante', 'Indica cuántas unidades caben en cada estante.')
        if not estantes and not cleaned.get('capacidad_area'):
            raise forms.ValidationError('La bodega necesita al menos un estante o un área libre para guardar stock.')
        return cleaned


class EspacioForm(forms.ModelForm):
    nombre = forms.CharField(min_length=2, max_length=50)
    capacidad = forms.IntegerField(label='Capacidad', min_value=1, max_value=1_000_000)
    niveles = forms.IntegerField(label='Niveles', min_value=1, max_value=50, required=False)
    area_m2 = forms.DecimalField(label='Superficie', min_value=0, max_value=1_000_000, max_digits=10,
                                 decimal_places=2, required=False)

    class Meta:
        model = Espacio
        fields = ['tipo', 'nombre', 'capacidad', 'niveles', 'area_m2']

    def __init__(self, *args, bodega=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.bodega = bodega or getattr(self.instance, 'bodega', None)

    def clean_nombre(self):
        nombre = ' '.join(self.cleaned_data['nombre'].split())
        repetido = Espacio.objects.filter(bodega=self.bodega, nombre__iexact=nombre).exclude(pk=self.instance.pk)
        if repetido.exists():
            raise forms.ValidationError(f'Ya existe un espacio llamado "{nombre}" en esta bodega.')
        return nombre

    def clean_capacidad(self):
        capacidad = self.cleaned_data['capacidad']
        if self.instance.pk:
            ocupado = self.instance.ocupado()
            if capacidad < ocupado:
                raise forms.ValidationError(
                    f'Este espacio ya tiene {ocupado} unidades guardadas: la capacidad no puede ser menor.')
        return capacidad

    def clean(self):
        cleaned = super().clean()
        # Cada tipo guarda solo el dato que le corresponde
        if cleaned.get('tipo') == 'estante':
            cleaned['area_m2'] = None
        else:
            cleaned['niveles'] = None
        return cleaned


class CategoriaForm(forms.ModelForm):
    nombre = forms.CharField(min_length=3, max_length=50)

    tipo = forms.ChoiceField(choices=Categoria.TIPOS, required=False)
    unidad_medida = forms.ChoiceField(choices=[('', 'Sin unidad por defecto')] + UNIDADES_MEDIDA, required=False)

    class Meta:
        model = Categoria
        fields = ['nombre', 'prefijo', 'padre', 'tipo', 'unidad_medida']

    def clean_prefijo(self):
        prefijo = self.cleaned_data.get('prefijo', '').strip().upper()
        if not re.fullmatch(r'[A-Z]{3}', prefijo):
            raise forms.ValidationError('El prefijo debe tener 3 letras, ej: HRM.')
        return prefijo

    def clean(self):
        cleaned = super().clean()
        actual = self.instance
        padre = cleaned.get('padre')
        tipo = cleaned.get('tipo') or (padre.tipo if padre else 'ambos')
        cleaned['tipo'] = tipo
        if padre:
            if actual.pk and padre.pk == actual.pk:
                self.add_error('padre', 'Una categoría no puede ser subcategoría de sí misma.')
            elif padre.padre_id:
                self.add_error('padre', f'"{padre.nombre}" ya es una subcategoría. Elige una categoría principal.')
            elif actual.pk and actual.subcategorias.exists():
                self.add_error('padre', 'Esta categoría tiene subcategorías, así que no puede quedar dentro de otra.')
            elif padre.tipo != 'ambos' and tipo != padre.tipo:
                self.add_error('tipo', f'"{padre.nombre}" es solo para {padre.get_tipo_display().lower()}: '
                                       f'su subcategoría debe ser del mismo tipo.')
        if actual.pk and tipo != 'ambos':
            otro = 'material' if tipo == 'herramienta' else 'herramienta'
            if actual.items.filter(tipo=otro).exists():
                self.add_error('tipo', f'Esta categoría tiene productos de tipo {otro}: muévelos antes de cambiar el tipo.')
            elif actual.subcategorias.exclude(tipo=tipo).exists():
                self.add_error('tipo', 'Sus subcategorías son de otro tipo: cámbialas primero.')
        if tipo == 'herramienta' and cleaned.get('unidad_medida') not in ('', 'unidad'):
            self.add_error('unidad_medida', 'Las herramientas se cuentan por unidad.')
        return cleaned

    def save(self, commit=True):
        self.instance.tipo = self.cleaned_data.get('tipo') or 'ambos'
        self.instance.unidad_medida = self.cleaned_data.get('unidad_medida') or ''
        return super().save(commit)


MAX_CANTIDAD = 1_000_000   # [Validación] tope razonable para cualquier cantidad


class ItemForm(forms.ModelForm):
    nombre = forms.CharField(min_length=2, max_length=100)
    stock_minimo = forms.IntegerField(min_value=0, max_value=MAX_CANTIDAD)
    bodega = forms.ModelChoiceField(queryset=Bodega.objects.all(), required=False)
    # [Bodegas reales] estante o área libre donde queda el stock (si no se indica, se usa el
    # espacio donde el ítem ya está en esa bodega, o el área libre principal)
    espacio = forms.ModelChoiceField(queryset=Espacio.objects.select_related('bodega'), required=False)
    stock = forms.IntegerField(required=False, initial=0, max_value=MAX_CANTIDAD)
    # [Control optimista] stock que el usuario vio al abrir el formulario (solo al editar)
    stock_esperado = forms.IntegerField(required=False, min_value=0)
    unidad_medida = forms.ChoiceField(choices=UNIDADES_MEDIDA, required=False)

    class Meta:
        model = Item
        fields = ['nombre', 'categoria', 'tipo', 'unidad_medida', 'stock_minimo']

    def clean_nombre(self):
        return ' '.join(self.cleaned_data['nombre'].split())   # sin espacios repetidos

    def clean_stock(self):
        stock = self.cleaned_data.get('stock') or 0
        if stock < 0:
            raise forms.ValidationError('El stock no puede ser negativo.')
        return stock

    def clean_tipo(self):
        tipo = self.cleaned_data['tipo']
        item = self.instance
        if item.pk and tipo != item.tipo and (
            item.stock_total() > 0 or item.prestamos.exists() or item.unidades.exists()
        ):
            raise forms.ValidationError('No se puede cambiar el tipo de un ítem que ya tiene stock, '
                                        'préstamos o códigos de barras.')
        return tipo

    def clean(self):
        cleaned = super().clean()
        bodega, espacio, stock = cleaned.get('bodega'), cleaned.get('espacio'), cleaned.get('stock') or 0
        nombre, categoria = cleaned.get('nombre'), cleaned.get('categoria')
        tipo = cleaned.get('tipo')

        if categoria and tipo and not categoria.admite(tipo):
            self.add_error('categoria', f'"{categoria.ruta()}" es solo para {categoria.get_tipo_display().lower()}.')
        if tipo == 'herramienta':
            if cleaned.get('unidad_medida') not in (None, '', 'unidad'):
                self.add_error('unidad_medida', 'Las herramientas se cuentan por unidad: cada una tiene su código.')
            cleaned['unidad_medida'] = 'unidad'
        elif not cleaned.get('unidad_medida'):
            cleaned['unidad_medida'] = ((categoria.unidad_medida if categoria else '')
                                        or (self.instance.unidad_medida if self.instance.pk else '') or 'unidad')

        # [Catálogo ordenado] No se permiten dos ítems con el mismo nombre en la misma categoría:
        # antes se creaban duplicados y el stock quedaba repartido en filas distintas del catálogo.
        if nombre and categoria:
            repetido = (Item.objects.filter(nombre__iexact=nombre, categoria=categoria)
                        .exclude(pk=self.instance.pk).first())
            if repetido:
                self.add_error('nombre', f'Ya existe "{repetido.nombre}" ({repetido.sku}) en esta categoría. '
                                         f'Agrega el stock a ese ítem en vez de crear uno nuevo.')

        if espacio and bodega and espacio.bodega_id != bodega.pk:
            self.add_error('espacio', 'Ese espacio no pertenece a la bodega elegida.')
        if espacio and not bodega:
            cleaned['bodega'] = bodega = espacio.bodega
        if stock and not bodega:
            raise forms.ValidationError('Indica en qué bodega queda el stock.')
        # [Lógica de inventario] Al EDITAR, mandar la bodega sin el stock dejaba esa bodega en 0
        # sin aviso (el campo vacío se tomaba como 0). Ahora se exige el valor explícito.
        if self.instance.pk and bodega and self.data.get('stock') in (None, ''):
            self.add_error('stock', 'Indica el stock que debe quedar en ese espacio.')
        if bodega and not espacio:
            espacio = resolver_espacio(self.instance if self.instance.pk else None, bodega)
            if espacio is None and stock:
                self.add_error('espacio', f'{bodega.nombre} no tiene estantes ni áreas: créalos en Bodegas.')
            cleaned['espacio'] = espacio
        # Prevalidación para dar un mensaje rápido. La verificación definitiva (con el espacio
        # bloqueado) la hace bodegaApp/stock.py al guardar.
        if espacio and stock:
            actual = 0
            if self.instance.pk:
                fila = self.instance.stocks.filter(espacio=espacio).first()
                actual = fila.cantidad if fila else 0
            libre = espacio.disponible() + actual
            if stock > libre:
                self.add_error('stock', f'{espacio.nombre} ({bodega.nombre}) solo tiene espacio para {libre} '
                                        f'unidades (capacidad {espacio.capacidad}).')
        return cleaned


    def save(self, commit=True):
        self.instance.unidad_medida = self.cleaned_data.get('unidad_medida') or 'unidad'
        return super().save(commit)


def resolver_espacio(item, bodega):
    """Espacio a usar cuando se indica solo la bodega: donde el ítem ya tiene más stock en esa
    bodega; si no está ahí, el área libre principal (o el primer estante)."""
    if item is not None:
        fila = item.stocks.filter(bodega=bodega).select_related('espacio').order_by('-cantidad', 'id').first()
        if fila:
            return fila.espacio
    return bodega.espacio_por_defecto()


class UsuarioForm(forms.ModelForm):
    first_name = forms.CharField(label='Nombre', min_length=2, max_length=50)
    last_name = forms.CharField(label='Apellido', min_length=2, max_length=50)
    email = forms.EmailField(label='Correo')
    password = forms.CharField(label='Contraseña temporal', min_length=8)

    class Meta:
        model = Usuario
        fields = ['first_name', 'last_name', 'email', 'telefono', 'rol']

    def clean_email(self):
        email = self.cleaned_data['email'].strip().lower()
        if Usuario.objects.filter(username=email).exclude(pk=self.instance.pk).exists():
            raise forms.ValidationError('Ya existe un usuario con ese correo.')
        return email

    def clean_telefono(self):
        fono = self.cleaned_data.get('telefono', '').strip()
        if not fono:
            return ''
        fono_limpio = fono.replace(' ', '').replace('-', '')
        patron = r'^(\+?56)?9\d{8}$'
        if not re.fullmatch(patron, fono_limpio):
            raise forms.ValidationError('Ingrese un teléfono móvil chileno válido.')
        if fono_limpio.startswith('+56'):
            return fono_limpio
        if fono_limpio.startswith('56'):
            return '+' + fono_limpio
        return '+56' + fono_limpio

    def save(self, commit=True):
        usuario = super().save(commit=False)
        usuario.username = self.cleaned_data['email']  
        usuario.set_password(self.cleaned_data['password']) 
        usuario.debe_cambiar_password = True
        if commit:
            usuario.save()
        return usuario


class PerfilForm(UsuarioForm):
    password = None  
    class Meta:
        model = Usuario
        fields = ['first_name', 'last_name', 'email', 'telefono']
    def save(self, commit=True):
        usuario = forms.ModelForm.save(self, commit=False)
        usuario.username = self.cleaned_data['email']
        if commit:
            usuario.save()
        return usuario


class UsuarioEditarForm(PerfilForm):
    class Meta:
        model = Usuario
        fields = ['first_name', 'last_name', 'email', 'telefono', 'rol', 'is_active']


class CambiarPasswordForm(forms.Form):
    actual = forms.CharField()
    nueva = forms.CharField()
    confirmar = forms.CharField()

    def __init__(self, *args, usuario=None, **kwargs):
        self.usuario = usuario
        super().__init__(*args, **kwargs)

    def clean_actual(self):
        actual = self.cleaned_data['actual']
        if not self.usuario.check_password(actual):
            raise forms.ValidationError('La contraseña actual no es correcta.')
        return actual

    def clean_nueva(self):
        nueva = self.cleaned_data['nueva']
        if len(nueva) < 9:
            raise forms.ValidationError('Mínimo 9 caracteres.')
        if not re.search(r'[A-Z]', nueva):
            raise forms.ValidationError('Debe tener al menos una mayúscula.')
        if not re.search(r'\d', nueva):
            raise forms.ValidationError('Debe tener al menos un número.')
        if not re.search(r'[^A-Za-z0-9]', nueva):
            raise forms.ValidationError('Debe tener al menos un carácter especial.')
        return nueva

    def clean(self):
        cleaned = super().clean()
        if cleaned.get('nueva') and cleaned.get('nueva') != cleaned.get('confirmar'):
            raise forms.ValidationError('Las contraseñas no coinciden.')
        if cleaned.get('nueva') and cleaned.get('nueva') == cleaned.get('actual'):
            raise forms.ValidationError('La nueva contraseña debe ser distinta de la actual.')
        return cleaned


class SolicitudForm(forms.ModelForm):
    MIN_MOTIVO_SOBRE_STOCK = 10
    MAX_CANTIDAD = 10000

    class Meta:
        model = Solicitud
        fields = ['item', 'cantidad', 'motivo']

    def clean(self):
        cleaned = super().clean()
        item = cleaned.get('item')
        cantidad = cleaned.get('cantidad')
        motivo = (cleaned.get('motivo') or '').strip()
        cleaned['motivo'] = motivo
        if item and cantidad is not None:
            if cantidad < 1:
                self.add_error('cantidad', 'La cantidad mínima es 1.')
            elif cantidad > self.MAX_CANTIDAD:
                self.add_error('cantidad', f'La cantidad máxima por solicitud es {self.MAX_CANTIDAD}.')
            else:
                disponible = item.stock_total()
                if cantidad > disponible and len(motivo) < self.MIN_MOTIVO_SOBRE_STOCK:
                    self.add_error('motivo', f'Pides {cantidad} y hay {disponible} disponibles. Explica por qué '
                                             f'necesitas más (mínimo {self.MIN_MOTIVO_SOBRE_STOCK} caracteres).')
                self.stock_disponible = disponible
        return cleaned


class DevolucionForm(forms.ModelForm):
    estado_devolucion = forms.ChoiceField(choices=Prestamo.ESTADOS_DEVOLUCION)
    comentario = forms.CharField(min_length=2, max_length=2500)

    class Meta:
        model = Prestamo
        fields = ['estado_devolucion', 'comentario']


class PedidoAdminForm(forms.ModelForm):
    cantidad = forms.IntegerField(min_value=1, max_value=MAX_CANTIDAD)
    motivo = forms.CharField(min_length=10, max_length=1000)
    descripcion = forms.CharField(max_length=150, required=False)
    prioridad = forms.ChoiceField(choices=PedidoAdmin.PRIORIDADES, required=False)

    class Meta:
        model = PedidoAdmin
        fields = ['tipo', 'item', 'descripcion', 'cantidad', 'bodega', 'motivo', 'prioridad']

    def clean_descripcion(self):
        return ' '.join((self.cleaned_data.get('descripcion') or '').split())

    def clean_motivo(self):
        return self.cleaned_data['motivo'].strip()

    def clean(self):
        cleaned = super().clean()
        tipo, item, descripcion = cleaned.get('tipo'), cleaned.get('item'), cleaned.get('descripcion')
        cleaned['prioridad'] = cleaned.get('prioridad') or 'normal'
        if tipo == 'reposicion' and not item:
            self.add_error('item', 'Elige el producto que hay que reponer.')
        if tipo in ('nuevo', 'otro') and len(descripcion or '') < 3:
            self.add_error('descripcion', 'Describe qué necesitas (mínimo 3 caracteres).')
        if tipo == 'nuevo':
            cleaned['item'] = None
        return cleaned

    def save(self, commit=True):
        self.instance.prioridad = self.cleaned_data['prioridad']
        self.instance.item = self.cleaned_data.get('item')
        return super().save(commit)
