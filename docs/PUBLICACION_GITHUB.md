# Publicación segura en GitHub

El repositorio debería ser **privado**, porque es una aplicación interna de control horario aunque el código no contenga datos reales.

## 1. Revisar antes de crear el repositorio

Los siguientes elementos están excluidos mediante `.gitignore` y nunca deben aparecer en un commit:

```text
.env
data/config.json
data/sessions/
secrets/google-service-account.json
backups/*.dump
backend/node_modules/
frontend/node_modules/
frontend/dist/
```

Si alguno se publicó alguna vez, borrarlo del último commit no es suficiente: hay que retirarlo del historial y rotar inmediatamente las claves, contraseñas o tokens afectados.

## 2. Crear el repositorio local

Desde la raíz del proyecto:

```bash
git init --initial-branch=main
git status --short --ignored
```

Antes de añadir archivos, confirmar que `.env`, `data/config.json`, la clave de Google y los dumps aparecen como ignorados.

Preparar el primer commit:

```bash
git add .
git diff --cached --name-only
```

Revisar detenidamente la lista. Si aparece cualquier secreto o dato real, ejecutar `git restore --staged RUTA`, corregir `.gitignore` y volver a comprobar.

Cuando la lista sea segura:

```bash
git commit -m "Preparar aplicación de partes para despliegue"
```

## 3. Crear el repositorio remoto

Desde la web de GitHub:

1. crear un repositorio privado vacío;
2. no añadir README, `.gitignore` ni licencia desde GitHub, porque ya existen localmente;
3. copiar la URL SSH del repositorio.

Conectar y publicar:

```bash
git remote add origin git@github.com:ORGANIZACION/REPOSITORIO.git
git push -u origin main
```

Como alternativa, con GitHub CLI autenticado:

```bash
gh repo create ORGANIZACION/REPOSITORIO --private --source=. --remote=origin --push
```

No pegar tokens personales dentro de `.env`, scripts o documentación.

## 4. Dar acceso al proveedor de la VPS

Opciones recomendadas:

- añadir a la persona como colaborador temporal del repositorio privado;
- crear una deploy key SSH de solo lectura en la VPS;
- usar un GitHub App con acceso exclusivo a este repositorio.

Evitar compartir una cuenta personal o un token con permisos sobre todos los repositorios.

Los secretos de producción deben entregarse aparte mediante un gestor de contraseñas, un secreto de un solo uso o una sesión SSH. GitHub Issues, Pull Requests y el propio repositorio no son canales adecuados.

## 5. Flujo recomendado para cambios

```bash
git switch -c cambio/descripción-corta
# editar y verificar
git add RUTAS_MODIFICADAS
git commit -m "Descripción del cambio"
git push -u origin cambio/descripción-corta
```

Abrir una Pull Request, esperar a que pase el CI y revisar el cambio antes de unirlo a `main`. La VPS debería desplegar únicamente commits revisados de `main` o tags de versión.

Para marcar entregas estables:

```bash
git tag -a v1.0.0 -m "Primera versión desplegable"
git push origin v1.0.0
```

## 6. Lista final antes del primer push

- [ ] El repositorio remoto es privado.
- [ ] `.env` no está versionado.
- [ ] No hay claves JSON, tokens ni contraseñas.
- [ ] No hay dumps, sesiones ni `data/config.json`.
- [ ] `.env.example` contiene solo valores ficticios.
- [ ] `npm test` pasa en `backend/`.
- [ ] `npm run build` pasa en `frontend/`.
- [ ] `docker compose config` es válido.
- [ ] La guía [DESPLIEGUE_VPS.md](DESPLIEGUE_VPS.md) se ha entregado al proveedor.
