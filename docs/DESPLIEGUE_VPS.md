# Despliegue en una VPS

Esta guía está pensada para la persona o empresa que reciba el repositorio desde GitHub y deba publicar la aplicación en una VPS. El despliegue usa Docker Compose, PostgreSQL y un proxy HTTPS.

## 1. Qué se entrega por cada canal

GitHub debe contener únicamente el código, las migraciones, `compose.yaml`, `.env.example` y la documentación.

Nunca deben subirse a GitHub:

- `.env`;
- `data/config.json` ni `data/sessions/`;
- `secrets/google-service-account.json`;
- dumps de PostgreSQL de `backups/`;
- tokens de Cloudflare, claves SSH o contraseñas.

Para migrar la instalación actual, el responsable del sistema debe entregar por un canal cifrado y distinto de GitHub:

1. un dump reciente de PostgreSQL;
2. `data/config.json`;
3. `secrets/google-service-account.json`;
4. los valores de producción para `.env`;
5. el dominio que se publicará.

No es necesario trasladar `data/sessions/`: al estrenar servidor es preferible que todos vuelvan a iniciar sesión.

## 2. Requisitos de la VPS

- Ubuntu 22.04/24.04 o una distribución Linux equivalente;
- Docker Engine y el plugin Docker Compose actualizados;
- mínimo recomendado: 2 vCPU, 2 GB de RAM y 20 GB SSD;
- un dominio apuntando mediante DNS a la IP de la VPS;
- puertos `22`, `80` y `443` permitidos en el firewall;
- acceso saliente HTTPS hacia Google APIs y GitHub.

Comprobar la instalación:

```bash
docker --version
docker compose version
git --version
```

## 3. Descargar el código

Para un repositorio privado, usar una deploy key de solo lectura o un token limitado al repositorio:

```bash
sudo mkdir -p /opt/partes-serendipia
sudo chown "$USER":"$USER" /opt/partes-serendipia
git clone git@github.com:ORGANIZACION/REPOSITORIO.git /opt/partes-serendipia
cd /opt/partes-serendipia
```

No ejecutar la aplicación como `root` salvo las operaciones concretas que requieran `sudo`.

## 4. Configurar producción

Crear la configuración privada:

```bash
cp .env.example .env
chmod 600 .env
mkdir -p data/sessions secrets backups
chmod 700 data data/sessions secrets backups
```

Generar valores aleatorios independientes:

```bash
openssl rand -hex 32
openssl rand -hex 24
```

Usar el primero como `SESSION_SECRET` y el segundo como `POSTGRES_PASSWORD`. Al ser hexadecimales pueden incluirse en `DATABASE_URL` sin codificación adicional.

Ejemplo de `.env` para `partes.example.com`:

```dotenv
APP_URL=https://partes.example.com
FRONTEND_URL=https://partes.example.com
PORT=3012
BIND_ADDRESS=127.0.0.1
APP_TIMEZONE=Europe/Madrid

SESSION_SECRET=VALOR_ALEATORIO_DE_64_CARACTERES
COOKIE_SECURE=true
DEV_AUTH_BYPASS=false
DEMO_MODE=false

POSTGRES_DB=partes_serendipia
POSTGRES_USER=partes_app
POSTGRES_PASSWORD=CONTRASENA_HEXADECIMAL
POSTGRES_PORT=5434
DATABASE_URL=postgresql://partes_app:CONTRASENA_HEXADECIMAL@db:5432/partes_serendipia

GOOGLE_SPREADSHEET_ID=ID_DEL_DOCUMENTO

SHEET_SYNC_HOUR=23
SHEET_SYNC_MINUTE=55
SHEET_SYNC_INTERVAL_DAYS=15
SHEET_SYNC_ANCHOR_DATE=2026-08-07
```

Sustituir `SHEET_SYNC_ANCHOR_DATE` por la fecha real desde la que se quiera contar el ciclo. El programador es interno a la aplicación; no hay que crear un cron adicional en Linux.

Guardar la clave de la cuenta de servicio en:

```text
secrets/google-service-account.json
```

La cuenta de servicio debe tener permiso de Editor sobre el spreadsheet. El archivo debe permanecer con permisos restrictivos:

```bash
chmod 600 secrets/google-service-account.json
```

## 5. Elegir: instalación nueva o migración

### Opción A: instalación nueva

Validar y arrancar:

```bash
docker compose config
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 app
```

Crear el primer administrador sin incluir la contraseña en el historial del shell:

```bash
read -rsp 'Contraseña inicial: ' ADMIN_PASSWORD
printf '%s' "$ADMIN_PASSWORD" | docker compose run --rm -T app node scripts/create-local-admin.js "Administrador" admin
unset ADMIN_PASSWORD
docker compose restart app
```

La contraseña debe tener al menos 12 caracteres. Después, entrar en Administración, revisar Google Sheets y pulsar **Crear o verificar pestañas**.

### Opción B: trasladar la instalación existente

En el servidor de origen, crear un dump consistente:

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U partes_app -d partes_serendipia -Fc > backups/partes-$(date +%F).dump
```

Transferir por SSH/SCP el dump, `data/config.json`, `.env` y la clave de Google. No subirlos al repositorio.

En la VPS nueva:

```bash
docker compose up -d db
docker compose ps db
docker compose exec -T db pg_restore -U partes_app -d partes_serendipia --clean --if-exists < backups/partes-FECHA.dump
docker compose up --build -d
```

Si `pg_restore` avisa de objetos inexistentes durante `--clean` en una base vacía, revisar el final de la salida y confirmar que la restauración de tablas y datos terminó correctamente.

## 6. Publicar con HTTPS

La aplicación debe exponerse mediante HTTPS. Con `BIND_ADDRESS=127.0.0.1`, el puerto `3012` solo es accesible desde la VPS y el proxy inverso.

### Ejemplo con Caddy

```caddyfile
partes.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3012
}
```

Caddy obtiene y renueva automáticamente el certificado cuando el DNS y los puertos 80/443 son correctos.

### Ejemplo con Nginx

```nginx
server {
    listen 80;
    server_name partes.example.com;

    location / {
        proxy_pass http://127.0.0.1:3012;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Después hay que añadir TLS con Certbot o el sistema de certificados elegido. `proxy_buffering off` permite que los eventos en directo del equipo mediante SSE lleguen sin retraso.

## 7. Comprobaciones de entrega

```bash
docker compose ps
curl -fsS http://127.0.0.1:3012/api/health
curl -I https://partes.example.com
docker compose logs --tail=100 app
```

La salud normal es:

```json
{"status":"ok","database":"ok","sheetsFallback":true}
```

Comprobar manualmente:

1. login de trabajador, jefe y administrador;
2. apertura y cierre de una jornada de prueba;
3. parte visible en el historial;
4. firma del empleado y firma posterior del jefe;
5. presencia del equipo actualizada;
6. volcado manual a Google Sheets en la pestaña configurada;
7. cierre de sesión y nueva entrada;
8. reinicio de `app` sin pérdida de datos.

## 8. Actualizaciones desde GitHub

Antes de actualizar, crear un backup. Después:

```bash
cd /opt/partes-serendipia
git fetch --prune
git pull --ff-only
docker compose up --build -d
docker compose ps
curl -fsS http://127.0.0.1:3012/api/health
```

Las migraciones pendientes se ejecutan automáticamente al arrancar la aplicación. No eliminar el volumen `postgres_data` durante una actualización.

Para operación, backups, restauración y diagnóstico, continuar en [OPERACION_Y_BACKUPS.md](OPERACION_Y_BACKUPS.md).
