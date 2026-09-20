# Partes de trabajo · Factoría Serendipia

Aplicación web mobile-first para registrar jornadas y tareas de trabajo sin partes en papel. Los trabajadores usan un nombre de usuario y contraseña, PostgreSQL conserva los datos operativos y Google Sheets recibe una copia programada que puede compartirse y tratarse desde Excel.

Este documento explica el producto, la arquitectura y la operación para que otra persona, desarrollador o IA pueda continuar el proyecto sin depender del historial de conversación.

## Documentación para entrega

- [Despliegue completo en una VPS](docs/DESPLIEGUE_VPS.md)
- [Operación, backups y recuperación](docs/OPERACION_Y_BACKUPS.md)
- [Publicación segura en GitHub](docs/PUBLICACION_GITHUB.md)
- [Estructura de ejemplo para Google Sheets](docs/estructura-sheet.csv)

El repositorio contiene únicamente código y documentación. `.env`, PostgreSQL, `data/`, `secrets/` y `backups/` deben entregarse por un canal seguro y nunca mediante GitHub.

## Qué hace la aplicación

- Inicia y termina una jornada desde el móvil.
- Registra tareas con negocio, descripción, hora de inicio, hora de fin y si han sido en horas extra.
- Calcula duraciones y totales con horas, minutos y segundos.
- Conserva el borrador abierto en el navegador aunque el móvil se bloquee o la app se cierre.
- Permite continuar una jornada del mismo día sin duplicar tareas ya guardadas.
- Agrupa el historial en un parte por trabajador y día, desplegable en sus tareas.
- Muestra en directo quién está trabajando, quién tiene una tarea planificada y qué móviles han perdido conexión reciente.
- Ofrece administración de personas, roles, contraseñas, negocios y Google Sheets.
- Incluye estadísticas por rango de fechas, descarga CSV y volcado manual a Sheets.
- Funciona en modo claro y oscuro con una interfaz React + Tailwind responsive.

## Estado actual de persistencia

La arquitectura actual es deliberadamente híbrida:

- **PostgreSQL es la fuente operativa principal** para usuarios, negocios, jornadas, tareas, presencia, auditoría y cola de sincronización.
- **Google Sheets es la copia programada, el formato compartido y el respaldo de emergencia**.
- Si PostgreSQL no responde, la aplicación puede leer y escribir partes directamente en Sheets.
- Cuando PostgreSQL vuelve, el servidor intenta importar de forma idempotente las filas creadas durante la caída.
- La jornada abierta y las tareas terminadas viven en PostgreSQL; `localStorage` e IndexedDB conservan una copia local de recuperación.
- `data/config.json` conserva el mapeo de la Sheet y una copia ligera de usuarios/negocios para el modo de contingencia. Las sesiones viven en `data/sessions/`.

No debe volver a describirse Google Sheets como la única fuente de verdad: esa fue una fase anterior del proyecto.

## Flujo de trabajo

1. El trabajador pulsa **Iniciar trabajo**. El servidor crea inmediatamente una jornada `open`, registra un evento idempotente y arranca la primera tarea.
2. Inicia una tarea y selecciona un negocio del desplegable.
3. Al finalizarla, añade la descripción del trabajo y confirma las horas.
4. **Finalizar tarea** la guarda inmediatamente en PostgreSQL y devuelve al panel principal de la jornada, con el cronómetro y los totales visibles.
5. La siguiente tarea comienza por defecto a la hora de fin de la anterior.
6. Puede repetir el proceso tantas veces como necesite.
7. **Terminar Día de Trabajo** abre la revisión final. Si existe una tarea en curso, no permite cerrar el día y muestra el aviso correspondiente.
8. Al confirmar la revisión, se guardan las correcciones pendientes y la jornada pasa de `open` a `submitted` dentro de una transacción.
9. Esa transición crea un evento en la cola de sincronización con Google Sheets.

Los comandos de jornada usan claves idempotentes para que un doble toque, reintento o reconexión no duplique entradas ni tareas. Otro dispositivo puede recuperar una jornada abierta desde el servidor. El borrador local sigue protegiendo ediciones aún no confirmadas.

### Tareas futuras y medianoche

El trabajador puede indicar una hora de fin posterior a la hora actual cuando conoce de antemano la duración del trabajo. La siguiente tarea se muestra como **Tarea planificada** y su contador permanece en cero hasta alcanzar la hora de inicio; no se interpreta como una tarea de casi 24 horas.

Los turnos reales que cruzan medianoche sí se calculan correctamente. Las horas nuevas se guardan como `HH:mm:ss`, mientras que el lector sigue admitiendo registros históricos `HH:mm`.

### Cierre automático a las 22:00

Si un trabajador olvida pulsar **Terminar Día de Trabajo**, la jornada se queda `open` indefinidamente y el contador de "Horas en tareas" acumularía tiempo real de varios días. Para evitarlo, el servidor cierra solo cualquier jornada abierta:

- de un día anterior a hoy, en cuanto el servidor lo detecta (sin esperar a las 22:00, porque su corte ya pasó);
- de hoy mismo, en cuanto el reloj local (`APP_TIMEZONE`) llega a las 22:00.

El cierre fija `day_end` a las 22:00, marca la jornada como `submitted` y deja una incidencia `stale_open_day` en **Equipo → Incidencias** para que jefe o administración la revise y corrija si hace falta. Si había una tarea en curso sin terminar, su hora de inicio se descarta **sin inventar negocio ni descripción**: se registra aparte como incidencia `task_left_open` para que se añada manualmente desde el historial si procede. Un turno que empieza, por ejemplo, a las 23:00 no se ve afectado hasta el corte del día siguiente (~23 h de margen), así que los turnos reales que cruzan medianoche descritos arriba siguen funcionando con normalidad.

La comprobación se ejecuta al abrir la app (`GET/POST /api/work-days/...`) y, para quien no vuelve a abrirla, también en el barrido periódico de asistencia cada 15 minutos (`closeStaleWorkDays` en `backend/src/services/incidents.js`).

### Magnitudes que muestra la interfaz

- **Jornada transcurrida:** tiempo real desde la entrada hasta el momento actual.
- **Horas en tareas:** suma de las tareas terminadas y, cuando corresponda, la tarea activa.
- **Jornada total:** diferencia entre entrada y salida durante la revisión final.
- **Horas trabajadas (declaradas):** número que el propio trabajador escribe al cerrar el día (`work_days.declared_hours`), pensado como el total "oficial" de su parte. Es independiente de la suma de tareas y puede no coincidir con ella; el trabajador o un administrador pueden corregirlo después desde Historial. Google Sheets, el CSV de administración y las estadísticas siguen calculando sus totales sumando las tareas, nunca este campo.

### Campo Material

El campo Material se retiró de la interfaz. La hoja de Sheets por defecto (`compact-overtime`, ver más abajo) ya no incluye esa columna; el backend mantiene compatibilidad con las estructuras extendidas anteriores, donde la columna existe pero normalmente queda vacía.

## Roles y permisos

| Capacidad | Trabajador | Jefe | Administrador / RR. HH. |
|---|:---:|:---:|:---:|
| Crear y terminar sus jornadas | Sí | Sí | No |
| Ver sus partes | Sí | Sí | Sí |
| Ver los partes del equipo | No | Sí | Sí |
| Editar sus tareas | Sí | Sí | Sí |
| Editar tareas ajenas | No | No | Sí |
| Firmar partes de trabajadores cerrados | No | Sí | No |
| Borrar tareas y sus horas | No | No | Sí |
| Ver presencia del equipo | No | Sí | Sí |
| Descartar una presencia obsoleta | No | Sí | Sí |
| Administrar personas y negocios | No | No | Sí |
| Ver estadísticas, exportar CSV y sincronizar Sheets | No | No | Sí |

La autorización se comprueba en Express y PostgreSQL, no depende únicamente de ocultar botones en React.

### Historial y borrado administrativo

- Un trabajador recibe exclusivamente sus propias filas desde el backend.
- Jefe y administrador disponen de **Todos los partes**, agrupados por persona y fecha.
- El trabajador firma únicamente su parte; el jefe firma después mediante una casilla visible en los partes cerrados de trabajadores.
- Si el trabajador modifica posteriormente un parte firmado, la firma del jefe se retira y queda pendiente de una nueva revisión.
- El administrador puede editar cualquier tarea.
- Al borrar horas, se elimina la tarea de PostgreSQL, cambian los totales, estadísticas y CSV, y el borrado queda en `audit_log`.
- La limpieza de Google Sheets es idempotente y vacía las celdas de la fila sin eliminarla físicamente, evitando desplazar las referencias inferiores. Se ejecuta en el siguiente volcado programado o manual.

### Presencia en directo

La jornada abierta es la fuente de verdad y la conexión de cada navegador se guarda por separado en `device_presence`. Mientras la jornada está abierta:

- el navegador envía un latido cada 20 segundos con dispositivo, sesión y secuencia monotónica;
- la vista del equipo recibe cambios mediante Server-Sent Events y conserva una consulta de respaldo cada minuto;
- tras 60 segundos sin latido se señala conexión obsoleta, pero la jornada continúa activa;
- cerrar sesión elimina únicamente la conexión de ese dispositivo, nunca la jornada iniciada desde otro;
- el supervisor puede descartar conexiones antiguas sin modificar horas ni cerrar la jornada.

Una tarea futura aparece como planificada y no suma un contador activo hasta alcanzar su hora.

### Modo demostración

Con `DEMO_MODE=true`, el login muestra **Ver diseño sin iniciar sesión**. El visitante obtiene datos ficticios con rol trabajador y no puede modificar PostgreSQL, Google Sheets ni Administración. Debe desactivarse si no se desea acceso público al diseño.

## Arquitectura

```text
Navegador móvil o escritorio
  ├─ React 19 + Tailwind CSS
  ├─ cookie de sesión HTTP-only
  ├─ borrador de jornada en localStorage + IndexedDB
  ├─ service worker y cola offline idempotente
                    │ /api
                    ▼
Node.js 22 + Express 5
  ├─ autenticación local y permisos por rol
  ├─ validación Zod
  ├─ sesiones persistidas en data/sessions
  ├─ configuración de contingencia en data/config.json
  └─ Google Sheets API mediante cuenta de servicio
          │                         │
          ▼                         ▼
PostgreSQL 17                 Google Spreadsheet
  ├─ usuarios/negocios          ├─ Datos Diarios
  ├─ jornadas/tareas            ├─ Resumen diario
  ├─ presencia                  └─ Resumen por negocio
  ├─ eventos de jornada
  ├─ conexiones por dispositivo
  ├─ incidencias revisables
  ├─ auditoría                         ▲
  └─ outbox de sincronización ─────────┘
```

La aplicación está preparada para una sola réplica de Express. Antes de escalar horizontalmente deben sustituirse los bloqueos en memoria de Sheets y el almacenamiento de sesiones en archivos por mecanismos compartidos.

## Tecnologías

- Frontend: React 19, Vite, Tailwind CSS 3 compilado en el build (sin CDN), PWA y Phosphor Icons.
- Backend: Node.js 22, Express 5, Zod y `googleapis`.
- Autenticación: credenciales locales, scrypt con sal aleatoria y sesiones HTTP-only.
- Datos: PostgreSQL 17 y Google Sheets API v4.
- Infraestructura: Docker multi-stage y Docker Compose.
- Seguridad HTTP: Helmet, CORS con origen explícito, SameSite y límite global de peticiones.

La aplicación no solicita ni almacena geolocalización. El origen de un registro identifica el canal técnico, no la ubicación del trabajador.

## Estructura del repositorio

```text
partes-serendipia/
├── backend/
│   ├── scripts/
│   │   ├── create-local-admin.js
│   │   └── import-sheet-to-postgres.js
│   ├── src/
│   │   ├── middleware/auth.js
│   │   ├── routes/                 # auth, partes, presencia y admin
│   │   ├── services/               # PostgreSQL, Sheets, outbox y configuración
│   │   ├── utils/                  # errores y cálculos horarios
│   │   ├── app.js
│   │   ├── config.js
│   │   └── server.js
│   └── test/
├── frontend/
│   ├── public/
│   └── src/
│       ├── components/
│       ├── context/
│       ├── lib/
│       ├── pages/
│       └── main.jsx
├── db/migrations/                  # migraciones SQL automáticas
├── data/                           # configuración y sesiones; no versionar
├── docs/
│   ├── DESPLIEGUE_VPS.md
│   ├── OPERACION_Y_BACKUPS.md
│   ├── PUBLICACION_GITHUB.md
│   └── estructura-sheet.csv
├── secrets/                        # clave Google; no versionar
├── compose.yaml
├── Dockerfile
├── .env.example
└── README.md
```

## Puesta en marcha rápida

### 1. Preparar variables

```bash
cp .env.example .env
nano .env
```

Como mínimo, configurar:

```dotenv
APP_URL=http://localhost:3012
FRONTEND_URL=http://localhost:3012
PORT=3012
BIND_ADDRESS=0.0.0.0
APP_TIMEZONE=Europe/Madrid
SESSION_SECRET=genera-un-valor-largo-y-aleatorio
POSTGRES_PASSWORD=usa-una-contrasena-segura
DATABASE_URL=postgresql://partes_app:usa-una-contrasena-segura@db:5432/partes_serendipia
GOOGLE_SPREADSHEET_ID=id_del_spreadsheet
COOKIE_SECURE=false
DEMO_MODE=false
```

Generar el secreto de sesión:

```bash
openssl rand -hex 32
```

La contraseña indicada dentro de `DATABASE_URL` debe coincidir con `POSTGRES_PASSWORD`. Si contiene caracteres especiales, debe codificarse para una URL.

### 2. Preparar Google Cloud y la Sheet

1. Crear o elegir un proyecto en Google Cloud Console.
2. Habilitar **Google Sheets API**.
3. Crear una cuenta de servicio.
4. Generar una clave JSON y guardarla como `secrets/google-service-account.json`.
5. Copiar el valor `client_email` del JSON.
6. Compartir el spreadsheet con esa dirección como **Editor**.
7. Copiar el ID de la URL de la Sheet a `GOOGLE_SPREADSHEET_ID`.

Ejemplo de URL:

```text
https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
```

Los trabajadores no necesitan cuenta de Google ni permisos sobre el documento. El contenedor monta `secrets/` como solo lectura y utiliza la cuenta de servicio para todas las llamadas.

### 3. Arrancar los contenedores

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 app
```

Compose inicia:

- `app`, publicado en `${PORT}:3000`;
- `db`, PostgreSQL 17 persistido en el volumen `postgres_data` y expuesto solo en `127.0.0.1:${POSTGRES_PORT}`.

Las migraciones de `db/migrations/` se aplican automáticamente al arrancar Express.

### 4. Crear el primer administrador

En una instalación nueva que todavía no tenga usuarios, crear el administrador en la configuración inicial:

```bash
docker compose run --rm app node scripts/create-local-admin.js Marta marta
docker compose restart app
```

El script lee la contraseña desde stdin: escribirla y finalizar la entrada con `Ctrl+D`. Así no aparece como argumento en el historial del shell. La contraseña debe tener al menos 12 caracteres.

Después, iniciar o reiniciar la app para que una base vacía importe ese directorio inicial. En una instalación ya operativa, personas, roles y contraseñas se gestionan desde **Administración → Usuarios autorizados**.

### 5. Inicializar Google Sheets

1. Entrar como administrador.
2. Abrir **Administración**.
3. Revisar Spreadsheet ID, zona horaria y nombres de pestañas.
4. Pulsar **Guardar configuración**.
5. Pulsar **Crear o verificar pestañas**.

La inicialización crea las pestañas ausentes y las fórmulas de resumen. No borra filas existentes; si encuentra cabeceras incompatibles devuelve `SHEET_HEADER_MISMATCH`.

## Variables de entorno

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP publicado por Compose en el host |
| `BIND_ADDRESS` | Dirección donde se publica el puerto; usar `127.0.0.1` detrás de un proxy en una VPS |
| `APP_URL` | URL pública exacta, sin barra final |
| `FRONTEND_URL` | Origen permitido por CORS |
| `APP_TIMEZONE` | Zona horaria funcional, normalmente `Europe/Madrid` |
| `SESSION_SECRET` | Secreto aleatorio para firmar sesiones |
| `COOKIE_SECURE` | `true` cuando la app se sirve por HTTPS |
| `DEMO_MODE` | Activa el acceso público de demostración |
| `DEV_AUTH_BYPASS` | Acceso auxiliar de desarrollo; nunca en producción |
| `GOOGLE_SPREADSHEET_ID` | ID inicial del spreadsheet |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Alternativa a montar el archivo JSON |
| `POSTGRES_DB` | Base de datos creada por el contenedor |
| `POSTGRES_USER` | Usuario de PostgreSQL |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL |
| `POSTGRES_PORT` | Puerto local publicado, por defecto `5434` |
| `DATABASE_URL` | Cadena usada por Express dentro de la red Docker |
| `SHEET_SYNC_HOUR` | Hora local del volcado programado, por defecto `23` |
| `SHEET_SYNC_MINUTE` | Minuto local del volcado programado, por defecto `55` |
| `SHEET_SYNC_INTERVAL_DAYS` | Intervalo en días entre volcados automáticos |
| `SHEET_SYNC_ANCHOR_DATE` | Fecha de referencia del ciclo, en formato `YYYY-MM-DD` |

`GOOGLE_SPREADSHEET_ID` actúa como valor inicial. Después de guardar la configuración desde Administración, prevalece `data/config.json`.

## Estructura de Google Sheets

Pestañas predeterminadas:

- `Datos Diarios`
- `Resumen diario`
- `Resumen por negocio`

El backend detecta cuatro disposiciones compatibles, por si acaso una Sheet antigua sigue con alguna de las anteriores:

- **Compacta `A:K`:** sin Material, firmas, usuario ni horas extra.
- **Compacta con horas extra `A:L`:** recomendada; es la disposición con la que nace una Sheet nueva al pulsar "Crear o verificar pestañas".
- **Extendida `A:O`:** conserva Material, firmas y usuario estable (heredada).
- **Extendida con horas extra `A:P`:** igual que la anterior más la columna de horas extra (heredada).

Una Sheet existente en cualquiera de las disposiciones heredadas sigue funcionando igual; el backend detecta su cabecera automáticamente y no hace falta migrarla. Para pasar una Sheet ya creada a la disposición compacta con horas extra hay que editar la cabecera a mano (borrar las columnas Material, Firma encargado, Firma empleado y Usuario empleado) y volver a pulsar "Crear o verificar pestañas".

La disposición compacta con horas extra es:

| Columna | Cabecera | Contenido |
|---|---|---|
| A | Fecha | `YYYY-MM-DD` |
| B | Día semana | Calculado por el backend |
| C | Empleado | Nombre visible |
| D | Negocio | Nombre conservado en el momento del parte |
| E | Trabajo realizado | Descripción de la tarea |
| F | Hora inicio | `HH:mm:ss` |
| G | Hora fin | `HH:mm:ss` |
| H | Total horas | Número decimal |
| I | Hora entrada día | `HH:mm:ss` |
| J | Hora salida día | `HH:mm:ss` |
| K | Timestamp de registro | Identificador estable de sincronización |
| L | Horas extra | `Sí` / `No` |

Hay una muestra importable en [docs/estructura-sheet.csv](docs/estructura-sheet.csv). Los resúmenes usan fórmulas `QUERY` nativas y se recalculan si alguien modifica el detalle directamente.

## Sincronización y contingencia

### Flujo normal

1. La API guarda la jornada y sus tareas en PostgreSQL.
2. Un trigger añade un evento idempotente a `sheet_sync_outbox` en la misma transacción.
3. El worker procesa la cola según el intervalo configurado; en esta instalación, cada 15 días a las 23:55.
4. Las tareas ya vinculadas se actualizan en su fila; las nuevas reciben una fila libre.
5. La app almacena el número de fila, el identificador de Sheets y la fecha de sincronización.

El botón **Volcar datos ahora** de Administración encola cualquier tarea pendiente y procesa la cola inmediatamente. Puede pulsarse más de una vez sin duplicar filas.

### Si PostgreSQL falla

- `/api/health` responde `degraded`.
- Login, directorio y negocios pueden usar la copia ligera de configuración.
- Lectura, creación y edición de partes usan Google Sheets como respaldo.
- El servidor comprueba PostgreSQL cada minuto.
- Cuando vuelve, importa las filas de Sheets de manera idempotente y retoma el flujo principal.

El borrado administrativo requiere PostgreSQL disponible, porque debe conservar auditoría y consistencia transaccional.

### Importación inicial desde una Sheet existente

```bash
docker compose exec -T app node scripts/import-sheet-to-postgres.js
```

El importador conserva referencias de fila, evita duplicados y crea usuarios históricos desactivados cuando no puede asociar un nombre a un usuario actual.

## API principal

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| GET | `/api/health` | Público | Salud de la API y PostgreSQL |
| GET | `/api/auth/me` | Público | Sesión actual |
| POST | `/api/auth/local` | Público limitado | Login local |
| POST | `/api/auth/demo` | Demo activo | Sesión de demostración |
| POST | `/api/auth/logout` | Sesión | Cerrar sesión |
| GET | `/api/timesheets` | Autenticado | Historial filtrado según permisos |
| GET | `/api/timesheets/today` | Autenticado | Tareas propias del día |
| POST | `/api/timesheets` | Trabajador o jefe | Guardar tareas del parte |
| PATCH | `/api/timesheets/:recordId` | Propietario o admin | Corregir una tarea |
| PATCH | `/api/timesheets/work-days/:id/manager-signature` | Jefe | Firmar o retirar la firma de un parte de trabajador |
| DELETE | `/api/timesheets/:recordId` | Admin | Borrar tarea y horas |
| PUT | `/api/presence` | Autenticado | Actualizar presencia |
| GET | `/api/presence` | Jefe o admin | Estado del equipo |
| DELETE | `/api/presence/:email` | Jefe o admin | Descartar presencia |
| GET | `/api/presence/stream` | Jefe o admin | Eventos SSE del estado del equipo |
| GET | `/api/work-days/current` | Trabajador o jefe | Recuperar la jornada abierta |
| POST | `/api/work-days/start` | Trabajador o jefe | Abrir/reabrir jornada de forma idempotente |
| POST | `/api/work-days/:id/tasks/start` | Propietario | Iniciar la siguiente tarea |
| POST | `/api/work-days/:id/tasks/finish` | Propietario | Persistir una tarea terminada |
| DELETE | `/api/work-days/:id/tasks/:taskId` | Propietario, jornada abierta | Retirar una tarea antes de firmar |
| POST | `/api/work-days/:id/finish` | Propietario | Firmar y cerrar la jornada |
| GET | `/api/incidents` | Jefe o admin | Incidencias detectadas para revisión |
| PATCH | `/api/incidents/:id` | Admin | Resolver o descartar una incidencia |
| GET | `/api/admin/config` | Admin | Personas, negocios y settings |
| GET | `/api/admin/reports/statistics` | Admin | Estadísticas por fechas |
| GET | `/api/admin/reports/export.csv` | Admin | Exportación CSV |
| POST | `/api/admin/sync-sheet` | Admin | Volcado manual idempotente |
| PUT | `/api/admin/settings` | Admin | Configuración de Sheets |
| POST | `/api/admin/initialize-sheet` | Admin | Crear/verificar pestañas |

## Despliegue público con Cloudflare Tunnel

La aplicación confía en un proxy y funciona detrás de HTTPS. Para producción:

```dotenv
APP_URL=https://horarios.factoriaserendipia.com
FRONTEND_URL=https://horarios.factoriaserendipia.com
COOKIE_SECURE=true
DEMO_MODE=false
DEV_AUTH_BYPASS=false
```

El origen del túnel debe apuntar al puerto publicado, por ejemplo `http://host.docker.internal:3012`, a la IP del host o al nombre del servicio si `cloudflared` comparte la red de Compose. `localhost` dentro de un contenedor cloudflared se refiere a ese contenedor, no al contenedor de la app.

Al cambiar de dominio:

- las cookies no se trasladan y los usuarios deben iniciar sesión otra vez;
- `localStorage` tampoco se traslada, por lo que conviene terminar las jornadas abiertas antes del cambio;
- no es necesario volver a compartir la Sheet con la cuenta de servicio.

Nunca guardar el token del túnel en este repositorio o README. Si un token o una clave JSON se expone, debe rotarse.

## Operación diaria

```bash
# Estado
docker compose ps
curl http://localhost:3012/api/health

# Logs
docker compose logs --tail=100 app
docker compose logs --tail=100 db

# Reiniciar solo la aplicación
docker compose restart app

# Reconstruir después de cambios de código
docker compose up --build -d

# Comprobar PostgreSQL
docker compose exec -T db psql -U partes_app -d partes_serendipia -c 'select now();'

# Estado de la cola de Sheets
docker compose exec -T db psql -U partes_app -d partes_serendipia -c \
  "select status, count(*) from sheet_sync_outbox group by status order by status;"
```

### Copias de seguridad

Hay que respaldar al menos:

- el volumen PostgreSQL `postgres_data` mediante `pg_dump`;
- `data/config.json`;
- la clave de servicio, almacenada en un gestor seguro;
- opcionalmente una copia/versionado del spreadsheet.

Ejemplo de volcado lógico:

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U partes_app -d partes_serendipia -Fc > backups/partes.dump
```

No restaure una copia sobre producción sin detener escrituras, verificar el archivo y disponer de una copia adicional recuperable.

## Desarrollo y verificación

Con Node.js 22 o superior:

```bash
cd backend
npm install
npm run dev
```

En otra terminal:

```bash
cd frontend
npm install
npm run dev
```

Antes de entregar cambios:

```bash
cd backend && npm test
cd ../frontend && npm run build
cd .. && docker compose config
docker compose up --build -d
curl http://localhost:${PORT:-3000}/api/health
```

Pruebas manuales recomendadas:

1. Un trabajador inicia jornada, finaliza una tarea y vuelve al cronómetro principal.
2. No puede terminar el día con una tarea abierta.
3. Una tarea futura no acumula 23 horas.
4. Al guardar el día, el historial muestra un único parte desplegable con sus tareas.
5. El trabajador no ve datos de otras personas.
6. El jefe ve el equipo y todos los partes, pero no edita horas ajenas.
7. El administrador no tiene formulario propio y puede gestionar personas, negocios, partes e informes.
8. El borrado administrativo actualiza los totales y crea un evento pendiente para Sheets.
9. El modo oscuro mantiene legibles botones, selects, inputs de hora y avisos.
10. Tras reconstruir los contenedores, sesiones, datos y presencia siguen disponibles según su persistencia.

## Seguridad

- No versionar `.env`, `data/`, `secrets/`, sesiones, contraseñas ni tokens de Cloudflare.
- Usar HTTPS y `COOKIE_SECURE=true` en producción.
- Rotar cualquier secreto que se haya compartido por chat, terminal grabada o repositorio.
- Mantener la Sheet compartida solo con la cuenta de servicio y las personas que realmente la necesiten.
- Revisar usuarios y negocios activos periódicamente.
- Las contraseñas nuevas requieren al menos 12 caracteres y las credenciales iniciales deben cambiarse al entrar.
- La sesión dura hasta 7 días; cerrar sesión invalida el archivo de sesión correspondiente.

## Invariantes para futuras modificaciones

1. PostgreSQL sigue siendo la fuente operativa principal y Sheets el respaldo/exportación.
2. Una caída de Sheets nunca debe impedir guardar en PostgreSQL.
3. Una caída de PostgreSQL debe conservar el borrador y utilizar Sheets cuando sea posible.
4. El usuario estable, no el nombre visible, determina la propiedad de una tarea.
5. Los permisos se aplican siempre en backend.
6. Un trabajador solo ve y edita lo suyo; un jefe observa; RR. HH. administra.
7. El administrador no registra partes propios.
8. Las escrituras múltiples a Sheets se agrupan y deben ser idempotentes.
9. Editar actualiza una fila existente; borrar la vacía sin desplazar otras filas.
10. El borrador local solo se elimina tras confirmar el guardado persistente; la jornada abierta del servidor prevalece sobre la copia local.
11. Las horas nuevas incluyen segundos y las antiguas siguen siendo legibles.
12. Una tarea futura permanece a cero hasta su hora real de inicio.
13. Terminar el día nunca cierra automáticamente una tarea activa.
14. Eliminar una persona o negocio no debe borrar su histórico.
15. Los esquemas de Sheet compacto `A:K`, compacto con horas extra `A:L`, extendido `A:O` y extendido con horas extra `A:P` deben seguir detectándose por cabecera.
16. La jornada se cierra sola de un día anterior, o de hoy a partir de las 22:00, pero nunca inventa negocio ni descripción de una tarea abandonada: solo fija la hora de salida y deja una incidencia para revisión humana.

## Limitaciones conocidas

- La jornada y las tareas persistidas se comparten entre dispositivos; únicamente las ediciones todavía no sincronizadas permanecen locales.
- La vista de Sheets lee un rango completo y puede necesitar paginación con un volumen muy grande.
- El backend no está preparado todavía para varias réplicas concurrentes.
- Las sesiones se almacenan en archivos; para alta disponibilidad conviene migrarlas a Redis o PostgreSQL.
- El fallback depende de que Google Sheets y la cuenta de servicio estén disponibles.
