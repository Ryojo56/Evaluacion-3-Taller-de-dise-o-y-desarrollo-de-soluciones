from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bodegaApp", "0002_bodega_ubicacion_capacidad_solicitud_stock"),
    ]

    operations = [
        migrations.AlterField(
            model_name="usuario",
            name="rol",
            field=models.CharField(
                choices=[
                    ("admin", "Administrador"),
                    ("bodeguero", "Bodeguero"),
                    ("trabajador", "Trabajador"),
                    ("rrhh", "Recursos humanos"),
                ],
                default="trabajador",
                max_length=20,
            ),
        ),
    ]
