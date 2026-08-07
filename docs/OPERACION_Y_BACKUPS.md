# Operación, backups y recuperación

## Qué datos son importantes

| Recurso | Contenido | Persistencia |
|---|---|---|
| Volumen `postgres_data` | Usuarios, negocios, jornadas, tareas, firmas, auditoría y cola de Sheets | Fuente operativa principal |
| `data/config.json` | Ajustes de Google Sheets y copia de contingencia del directorio | Archivo privado del host |
| `data/sessions/` | Sesiones iniciadas | Prescindible; no migrar por defecto |
| `secrets/google-service-account.json` | Credencial de Google | Secreto crítico |
| Google Sheets | Copia programada y contingencia | No sustituye al backup de PostgreSQL |

## Comandos habituales

```bash
# Estado y salud
docker compose ps
curl -fsS http://127.0.0.1:3012/api/health

# Logs recientes
docker compose logs --tail=100 app
docker compose logs --tail=100 db

# Seguir logs en directo
docker compose logs -f app

# Reiniciar únicamente Node/React
docker compose restart app

# Reconstruir tras actualizar código
docker compose up --build -d
```

No usar `docker compose down -v`: la opción `-v` elimina el volumen que contiene PostgreSQL.

## Sincronización con Google Sheets

El volcado automático se ejecuta cada `SHEET_SYNC_INTERVAL_DAYS` días a la hora `SHEET_SYNC_HOUR:SHEET_SYNC_MINUTE`, usando `SHEET_SYNC_ANCHOR_DATE` como referencia. Reiniciar Docker no cambia el ciclo cuando la fecha de referencia está configurada.

Desde Administración, **Volcar datos ahora** adelanta el proceso sin duplicar filas.

Estado de la cola:

```bash
docker compose exec -T db psql -U partes_app -d partes_serendipia -c \
  "select status, count(*) from sheet_sync_outbox group by status order by status;"
```

Últimos errores:

```bash
docker compose exec -T db psql -U partes_app -d partes_serendipia -c \
  "select aggregate_id, attempts, last_error, next_attempt_at from sheet_sync_outbox where status = 'failed' order by updated_at desc limit 20;"
```

Si Sheets falla, PostgreSQL continúa guardando y la cola queda pendiente. No borrar eventos fallidos manualmente sin analizar primero el error.

## Backup recomendado

Frecuencia mínima sugerida:

- dump diario de PostgreSQL;
- copia diaria de `data/config.json`;
- retención de 7 copias diarias y 4 semanales;
- copia cifrada fuera de la VPS;
- prueba de restauración trimestral.

Crear el dump:

```bash
mkdir -p backups
chmod 700 backups
docker compose exec -T db pg_dump -U partes_app -d partes_serendipia -Fc > backups/partes-$(date +%F-%H%M).dump
cp data/config.json backups/config-$(date +%F-%H%M).json
chmod 600 backups/*
```

Comprobar el dump sin restaurarlo:

```bash
docker compose exec -T db pg_restore --list < backups/partes-FECHA.dump | head
```

Los backups están excluidos por `.gitignore`; GitHub no es un sistema de copias de seguridad.

## Restauración completa

1. Detener temporalmente la aplicación para evitar escrituras:

```bash
docker compose stop app
```

2. Crear una copia de seguridad adicional del estado actual.

3. Restaurar el dump:

```bash
docker compose exec -T db pg_restore -U partes_app -d partes_serendipia --clean --if-exists < backups/partes-FECHA.dump
```

4. Restaurar `data/config.json` si corresponde, mantener la clave de Google en `secrets/` y arrancar:

```bash
docker compose start app
docker compose logs --tail=100 app
curl -fsS http://127.0.0.1:3012/api/health
```

5. Validar usuarios, últimos partes, firmas, negocios y estado de sincronización.

## Actualización y vuelta atrás

Antes de cada versión:

1. crear un dump;
2. anotar el commit actualmente desplegado con `git rev-parse HEAD`;
3. ejecutar pruebas o revisar el CI;
4. actualizar con `git pull --ff-only` y reconstruir;
5. comprobar salud, logs y un flujo de usuario.

Si el código nuevo falla, volver al tag o commit anterior y reconstruir. Las migraciones de base de datos son progresivas; antes de volver a una versión antigua hay que comprobar si esa versión entiende el esquema nuevo. Cuando exista duda, restaurar también el dump previo en una ventana de mantenimiento.

## Diagnóstico rápido

### La web no abre

- comprobar `docker compose ps`;
- comprobar `curl http://127.0.0.1:3012/api/health`;
- revisar proxy, DNS y certificado;
- confirmar que `APP_URL` y `FRONTEND_URL` coinciden exactamente con el dominio.

### El login entra en bucle

- con HTTPS, confirmar `COOKIE_SECURE=true`;
- confirmar que el proxy envía `X-Forwarded-Proto`;
- borrar cookies antiguas tras un cambio de dominio;
- revisar permisos de escritura de `data/sessions/`.

### PostgreSQL no está disponible

- revisar `docker compose logs db`;
- comprobar espacio con `df -h`;
- confirmar que `POSTGRES_PASSWORD` coincide con la contraseña incluida en `DATABASE_URL`;
- no recrear el volumen antes de obtener un backup recuperable.

### Google Sheets no sincroniza

- confirmar que la API de Google Sheets está habilitada;
- confirmar que la Sheet está compartida con el `client_email` de la cuenta de servicio;
- revisar el Spreadsheet ID y el nombre de la hoja en Administración;
- pulsar **Crear o verificar pestañas**;
- revisar la cola y los logs de `app`.

### Una jornada figura activa sin móvil conectado

Esto puede ser correcto: la jornada abierta del servidor es la fuente de verdad. El jefe puede descartar conexiones antiguas, pero debe revisar las horas antes de corregir o cerrar una jornada.
