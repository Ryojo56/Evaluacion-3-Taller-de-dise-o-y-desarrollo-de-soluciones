import django.db.models.deletion
from django.db import migrations, models


def crear_codigos_existentes(apps, schema_editor):
    Item = apps.get_model('bodegaApp', 'Item')
    Stock = apps.get_model('bodegaApp', 'Stock')
    Prestamo = apps.get_model('bodegaApp', 'Prestamo')
    Unidad = apps.get_model('bodegaApp', 'Unidad')
    for item in Item.objects.filter(tipo='herramienta'):
        numero = Unidad.objects.filter(item=item).count()

        def nueva(bodega, estado):
            nonlocal numero
            numero += 1
            return Unidad.objects.create(item=item, bodega=bodega, estado=estado, codigo=f'{item.sku}-{numero:03d}')

        for stock in Stock.objects.filter(item=item, cantidad__gt=0):
            for _ in range(stock.cantidad):
                nueva(stock.bodega, 'Disponible')
        for prestamo in Prestamo.objects.filter(item=item, fecha_devolucion__isnull=True):
            prestamo.unidades.add(*[nueva(prestamo.bodega, 'Prestada') for _ in range(prestamo.cantidad)])


class Migration(migrations.Migration):

    dependencies = [
        ("bodegaApp", "0003_rol_recursos_humanos"),
    ]

    operations = [
        migrations.CreateModel(
            name="Unidad",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("codigo", models.CharField(max_length=30, unique=True)),
                (
                    "estado",
                    models.CharField(
                        choices=[
                            ("Disponible", "Disponible"),
                            ("Prestada", "Prestada"),
                            ("De baja", "De baja"),
                        ],
                        default="Disponible",
                        max_length=20,
                    ),
                ),
                ("creada", models.DateTimeField(auto_now_add=True)),
                (
                    "bodega",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="unidades",
                        to="bodegaApp.bodega",
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="unidades",
                        to="bodegaApp.item",
                    ),
                ),
            ],
            options={
                "ordering": ["codigo"],
            },
        ),
        migrations.AddField(
            model_name="prestamo",
            name="unidades",
            field=models.ManyToManyField(
                blank=True, related_name="prestamos", to="bodegaApp.unidad"
            ),
        ),
        migrations.RunPython(crear_codigos_existentes, migrations.RunPython.noop),
    ]
