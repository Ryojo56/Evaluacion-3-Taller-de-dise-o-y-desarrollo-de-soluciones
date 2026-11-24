import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / 'templates'


# [Seguridad] Los secretos ya NO se escriben en el código: se leen de variables de entorno
# o del archivo backend/.env (que no se sube al repositorio). Ver .env.example.
def _cargar_env(ruta):
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding='utf-8').splitlines():
        linea = linea.strip()
        if linea and not linea.startswith('#') and '=' in linea:
            clave, valor = linea.split('=', 1)
            os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))


_cargar_env(BASE_DIR / '.env')


def env(clave, defecto=None):
    return os.environ.get(clave, defecto)


def env_bool(clave, defecto=False):
    return str(env(clave, defecto)).lower() in ('1', 'true', 'si', 'sí', 'yes')


def env_lista(clave, defecto=''):
    return [x.strip() for x in env(clave, defecto).split(',') if x.strip()]


# [Seguridad] DEBUG apagado por defecto: con DEBUG=True un error 500 muestra código y configuración.
DEBUG = env_bool('DJANGO_DEBUG', True)

SECRET_KEY = env('DJANGO_SECRET_KEY', 'django-insecure-cambia-esta-clave-por-una-propia-bodega-2026')
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError('Falta DJANGO_SECRET_KEY en backend/.env (ver .env.example).')
    SECRET_KEY = 'solo-desarrollo-no-usar-en-produccion'

ALLOWED_HOSTS = env_lista('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1')


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'bodegaApp',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'bodegaProyecto.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [TEMPLATES_DIR],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'bodegaProyecto.wsgi.application'


# Database (MySQL local con Workbench)

import pymysql
pymysql.install_as_MySQLdb()

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': 'gestion_bodega',
        'USER' : 'admin',
        'PASSWORD' : '2026',
    }
}

# Usamos nuestro propio modelo de usuario (con teléfono y rol)
AUTH_USER_MODEL = 'bodegaApp.Usuario'


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 9}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# Internationalization
LANGUAGE_CODE = 'es-cl'
TIME_ZONE = 'America/Santiago'
USE_I18N = True
USE_TZ = True


# Static files
STATIC_URL = 'static/'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# React (Vite) corre en el puerto 5173 y le pide datos a Django por un "proxy".
# Esto permite que Django confíe en los formularios que vienen desde ahí.
CSRF_TRUSTED_ORIGINS = env_lista('DJANGO_CSRF_TRUSTED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
# En desarrollo, Vite usa el siguiente puerto libre (5174, 5175... hasta 5190) si el 5173 está ocupado.
# Sin esto Django rechazaba el login con un 403 de CSRF ("No se pudo conectar con el servidor").
if DEBUG:
    CSRF_TRUSTED_ORIGINS += [f'http://{host}:{puerto}' for host in ('localhost', '127.0.0.1')
                             for puerto in range(5173, 5191)]

# Caché (se usa para limitar intentos de login). En producción conviene Redis o la base de datos.
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}

# [Seguridad] Límite de intentos de login fallidos (anti fuerza bruta)
LOGIN_MAX_INTENTOS = int(env('LOGIN_MAX_INTENTOS', 5))
LOGIN_BLOQUEO_SEGUNDOS = int(env('LOGIN_BLOQUEO_SEGUNDOS', 300))

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'

# [Seguridad] Endurecimiento automático cuando se despliega (DEBUG apagado y HTTPS)
if not DEBUG and env_bool('DJANGO_HTTPS', True):
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = env_bool('DJANGO_SSL_REDIRECT', True)
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'
