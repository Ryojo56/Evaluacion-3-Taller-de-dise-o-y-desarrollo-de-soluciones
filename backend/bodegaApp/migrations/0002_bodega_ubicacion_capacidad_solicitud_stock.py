from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bodegaApp", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="bodega",
            name="capacidad",
            field=models.PositiveIntegerField(
                default=1000, help_text="Unidades que caben en la bodega"
            ),
        ),
        migrations.AddField(
            model_name="bodega",
            name="ubicacion",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Dirección o sector, ej: Galpón 2, Av. Los Robles 123",
                max_length=150,
                verbose_name="ubicación",
            ),
        ),
        migrations.AddField(
            model_name="solicitud",
            name="stock_al_solicitar",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
