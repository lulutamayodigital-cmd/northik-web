# Northik AI · northik.ai

Sitio web de Northik AI, publicado en **Cloudflare Workers con archivos estáticos** en https://northik.ai.

## Cómo está armado

- **Páginas** (HTML, CSS y JS estáticos, sin compilación): `index.html`, `contacto/`, `agenda/`, `creadores/`, `datos/`, `terminos/`, `cookies/`, `reembolsos/`. Fuentes en `fuentes/`, imágenes en `img/`.
- **Programa del sitio** (`worker/index.js`): atiende solo `/api/*` y `/admin/*`; todo lo demás se sirve directo como archivo estático.
  - `/api/contacto`: formulario «Cuéntanos tu proyecto» (base D1 `northik-formularios` y aviso por correo).
  - `/api/agenda/*`: agenda de llamadas con Google Calendar (ver abajo).
  - `/api/creadores`: registro de creadores de Northik Match (ver abajo).
  - `/admin/*.csv` y `/admin/creadores/*`: descargas y pantallazos protegidos con Cloudflare Access.
- **Configuración de Cloudflare**: `wrangler.jsonc` (bindings, límite de envíos, cron mensual).
- `_headers`: cabeceras de seguridad (CSP) de las páginas estáticas.
- `.assetsignore`: lo que **no** se publica como archivo (por ejemplo `worker/`, `README.md`, `wrangler.jsonc`).

## Publicar

```bash
npx wrangler deploy
```

Para probar en el computador: `npx wrangler dev` (abre http://localhost:8787).

## Agenda (`/agenda/`)

- Reglas de disponibilidad (horarios, duración, anticipación, festivos y días sin citas propios en `diasSinCitas`): `worker/agenda-config.js`. Cada cambio requiere `npx wrangler deploy`.
- Secretos en Cloudflare, nunca en el repositorio:
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  npx wrangler secret put GOOGLE_REFRESH_TOKEN
  ```
  El ID de cliente (`GOOGLE_CLIENT_ID`) va en `vars` de `wrangler.jsonc` porque no es secreto.
- Para obtener el refresh token (una sola vez, con la cuenta northik.admin@gmail.com): `node scripts/token-google.mjs`.
- Cada reserva crea el evento en Google Calendar (con la marca privada `creadoPor=northik-agenda`) y agrega una fila a la hoja privada «Northik · Agenda», pestaña «Citas» (ID en `AGENDA_SHEET_ID`). Si la hoja falla, la cita igual se crea y llega un aviso al correo de avisos.
- El cron mensual (día 1) borra las filas y los eventos marcados de /agenda con más de 24 meses.
- En Google Cloud deben estar activas las APIs de Calendar y Sheets. Permisos del token: `calendar.events`, `calendar.freebusy` y `spreadsheets`.
- Vuelve a correr `node scripts/token-google.mjs` si cambias el client secret, si quitas el permiso de la app en Google o si cambian los permisos que pide.
- Las citas no se guardan en D1.

## Registro de creadores (`/creadores/`)

La documentación técnica está en el repositorio privado de Northik Match.

- Página: `creadores/index.html`. Opciones del formulario (nichos, tarifas) y rangos del resumen: `creadores/config.js`.
  Los rangos de interacción por tamaño son los de Northik Match (`influencer-intelligence`: `ii/metrics.py`, `TAMANOS` y `RANGO_ER`). Si cambian allá, cámbialos aquí.
- El resumen del perfil se calcula en el navegador del creador, solo con las cifras que escribió (`creadores/resumen.js`).
- Enlaces con origen: `northik.ai/creadores/?origen=match`, `?origen=instagram`… (queda en la columna «Origen»).
- Antispam igual que la agenda: campo trampa, 5 envíos por minuto por dirección, solo campos conocidos y pantallazos revisados por sus primeros bytes (JPG, PNG o WEBP, hasta 4 de 5 MB).
- Cada registro agrega una fila a la hoja privada «Northik · Creadores», pestaña «Registros». Si `CREADORES_SHEET_ID` está vacío en `wrangler.jsonc`, la web crea la hoja sola con el primer registro (en el Drive de northik.admin, sin compartir) y guarda su ID en D1, tabla `ajustes`.
- Pantallazos: bucket privado de R2 `northik-creadores`, en una carpeta por registro (el «ID del registro» de la hoja). Los enlaces de la hoja (`/admin/creadores/…`) solo abren pasando por Cloudflare Access.
- Si la hoja falla, el registro se guarda en D1 (tabla `creadores_respaldo`) y llega un aviso por correo con todos los datos para copiarlos a mano.
- La prueba de la autorización queda en D1, tabla `aceptaciones` (medio «Registro de creadores northik.ai/creadores»).
- Borrado: el cron mensual borra filas, pantallazos y respaldos con más de 24 meses desde el registro. Si un creador pide que lo borren antes: borra su fila en la hoja, su carpeta en R2 (Cloudflare → R2 → `northik-creadores` → carpeta con su ID del registro) y, si existe, su fila en `creadores_respaldo`.
- Antes de la primera publicación (una sola vez):
  ```bash
  npx wrangler r2 bucket create northik-creadores
  ```
  y en Cloudflare Zero Trust → Access, que la aplicación protegida cubra también `northik.ai/admin/creadores/*`.
- Para probar en el computador sin tocar Google (`GOOGLE_MOCK` en `.dev.vars`), las filas simuladas se ven en http://localhost:8787/api/creadores/simulado. Para simular que la hoja falla: `npx wrangler dev --var GOOGLE_MOCK_FALLA_HOJA:1`.
