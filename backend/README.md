# Bodega - Backend (Django + MySQL)

1. En MySQL Workbench:  CREATE DATABASE bodega_db CHARACTER SET utf8mb4;
2. Revisa USER y PASSWORD en bodegaProyecto/settings.py
3. python -m venv venv   y actívalo (Windows: venv\Scripts\activate)
4. pip install -r requirements.txt
5. python manage.py migrate
6. python manage.py cargar_datos
7. python manage.py runserver
8. Abre http://127.0.0.1:8000/admin  (admin@bodega.cl / Bodega#2026)

Pruebas automáticas: python manage.py test
