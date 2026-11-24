import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("bodegaApp", "0009_crud_admin_anular_revertir"),
    ]

    operations = [
        migrations.AddField(
            model_name="categoria",
            name="padre",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="subcategorias",
                to="bodegaApp.categoria",
            ),
        ),
        migrations.AddField(
            model_name="categoria",
            name="tipo",
            field=models.CharField(
                choices=[
                    ("ambos", "Herramientas y materiales"),
                    ("herramienta", "Herramientas"),
                    ("material", "Materiales"),
                ],
                default="ambos",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="categoria",
            name="unidad_medida",
            field=models.CharField(
                blank=True,
                choices=[
                    (
                        "Conteo",
                        [
                            ("unidad", "Unidad"),
                            ("par", "Par"),
                            ("caja", "Caja"),
                            ("paquete", "Paquete"),
                            ("bolsa", "Bolsa"),
                            ("saco", "Saco"),
                            ("rollo", "Rollo"),
                        ],
                    ),
                    ("Peso", [("kg", "Kilogramo"), ("g", "Gramo"), ("t", "Tonelada")]),
                    (
                        "Longitud",
                        [("m", "Metro"), ("cm", "Centímetro"), ("mm", "Milímetro")],
                    ),
                    (
                        "Volumen",
                        [
                            ("l", "Litro"),
                            ("ml", "Mililitro"),
                            ("galon", "Galón"),
                            ("m3", "Metro cúbico"),
                        ],
                    ),
                    ("Superficie", [("m2", "Metro cuadrado")]),
                ],
                default="",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="unidad_medida",
            field=models.CharField(
                choices=[
                    (
                        "Conteo",
                        [
                            ("unidad", "Unidad"),
                            ("par", "Par"),
                            ("caja", "Caja"),
                            ("paquete", "Paquete"),
                            ("bolsa", "Bolsa"),
                            ("saco", "Saco"),
                            ("rollo", "Rollo"),
                        ],
                    ),
                    ("Peso", [("kg", "Kilogramo"), ("g", "Gramo"), ("t", "Tonelada")]),
                    (
                        "Longitud",
                        [("m", "Metro"), ("cm", "Centímetro"), ("mm", "Milímetro")],
                    ),
                    (
                        "Volumen",
                        [
                            ("l", "Litro"),
                            ("ml", "Mililitro"),
                            ("galon", "Galón"),
                            ("m3", "Metro cúbico"),
                        ],
                    ),
                    ("Superficie", [("m2", "Metro cuadrado")]),
                ],
                default="unidad",
                max_length=10,
            ),
        ),
        migrations.CreateModel(
            name="PedidoAdmin",
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
                (
                    "tipo",
                    models.CharField(
                        choices=[
                            ("reposicion", "Reposición de stock"),
                            ("nuevo", "Producto nuevo"),
                            ("otro", "Otro"),
                        ],
                        default="reposicion",
                        max_length=12,
                    ),
                ),
                ("descripcion", models.CharField(blank=True, max_length=150)),
                ("cantidad", models.PositiveIntegerField()),
                ("motivo", models.TextField()),
                (
                    "prioridad",
                    models.CharField(
                        choices=[
                            ("normal", "Normal"),
                            ("alta", "Alta"),
                            ("urgente", "Urgente"),
                        ],
                        default="normal",
                        max_length=10,
                    ),
                ),
                (
                    "estado",
                    models.CharField(
                        choices=[
                            ("Pendiente", "Pendiente"),
                            ("Aprobado", "Aprobado"),
                            ("Rechazado", "Rechazado"),
                            ("Cancelado", "Cancelado"),
                        ],
                        db_index=True,
                        default="Pendiente",
                        max_length=12,
                    ),
                ),
                (
                    "fecha",
                    models.DateTimeField(
                        db_index=True, default=django.utils.timezone.now
                    ),
                ),
                ("respuesta", models.TextField(blank=True)),
                ("fecha_respuesta", models.DateTimeField(blank=True, null=True)),
                (
                    "atendido_por",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pedidos_atendidos",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "bodega",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pedidos_admin",
                        to="bodegaApp.bodega",
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pedidos_admin",
                        to="bodegaApp.item",
                    ),
                ),
                (
                    "solicitante",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pedidos_admin",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-fecha", "-id"],
            },
        ),
    ]
