
from django.core.management.base import BaseCommand

from bodegaApp.models import Usuario


class Command(BaseCommand):
    help = 'Lista los usuarios y detecta problemas para iniciar sesión'

    def handle(self, *args, **options):
        usuarios = Usuario.objects.all().order_by('id')
        if not usuarios:
            self.stdout.write(self.style.ERROR(
                'No hay usuarios. Ejecuta:  python manage.py cargar_datos'))
            return

        self.stdout.write(f'{"ID":<4}{"USUARIO (para entrar)":<28}{"CORREO":<28}{"ROL":<12}ESTADO')
        for u in usuarios:
            problemas = []
            # Django guarda las contraseñas encriptadas: "pbkdf2_sha256$..."
            if not u.password or u.password.startswith('!'):
                problemas.append('sin contraseña: usa changepassword')
            elif '$' not in u.password:
                problemas.append('contraseña NO encriptada (¿insertada desde Workbench?)')
            if not u.is_active:
                problemas.append('usuario inactivo')
            estado = self.style.ERROR(' / '.join(problemas)) if problemas else self.style.SUCCESS('OK')
            self.stdout.write(f'{u.id:<4}{u.username:<28}{u.email or "-":<28}{u.rol:<12}{estado}')

        self.stdout.write('\nPara poner una contraseña nueva a un usuario:')
        self.stdout.write('  python manage.py changepassword <usuario>')
