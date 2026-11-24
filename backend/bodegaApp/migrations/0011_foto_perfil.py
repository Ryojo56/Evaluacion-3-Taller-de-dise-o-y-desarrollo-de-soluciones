import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bodegaApp", "0010_unidades_subcategorias_pedidos"),
    ]

    operations = [
        migrations.AddField(
            model_name="usuario",
            name="foto_actualizada",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.CreateModel(
            name="FotoPerfil",
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
                ("imagen", models.BinaryField()),
                (
                    "tipo",
                    models.CharField(
                        choices=[
                            ("image/jpeg", "JPEG"),
                            ("image/png", "PNG"),
                            ("image/webp", "WebP"),
                        ],
                        max_length=20,
                    ),
                ),
                ("actualizada", models.DateTimeField(auto_now=True)),
                (
                    "usuario",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="foto_perfil",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
