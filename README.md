# Northik AI · northik.ai

Sitio web de Northik AI, publicado en **Cloudflare Workers con archivos estáticos** en https://northik.ai.

## Cómo está armado

- **Páginas** (HTML, CSS y JS estáticos, sin compilación): `index.html`, `contacto/`, `agenda/`, `creadores/`, `datos/`, `terminos/`, `cookies/`, `reembolsos/`. Fuentes en `fuentes/`, imágenes en `img/`.
- **Programa del sitio** (`worker/index.js`): atiende solo `/api/*` y `/admin/*`; todo lo demás se sirve directo como archivo estático.
  - `/api/contacto`: formulario «Cuéntanos tu proyecto» (base D1 `northik-formularios` y aviso por correo).
  - `/api/agenda/*`: agenda de llamadas con Google Calendar (ver abajo).
  - `/api/creadores`: registro de creadores de Northik Match (ver abajo).
  - `/admin/*.csv`: descargas protegidas con Cloudflare Access.
- **Configuración de Cloudflare**: `wrangler.jsonc` (bindings, límite de envíos, cron mensual).
- `_headers`: cabeceras de seguridad (CSP) de las páginas estáticas.
- `.assetsignore`: lo que **no** se publica como archivo (por ejemplo `worker/`, `README.md`, `wrangler.jsonc`).

## Publicar

Cloudflare (Workers Builds) está conectado a este repositorio: **cada cambio que llega a `main` se publica solo** en northik.ai. Por eso:

- Cada cambio se trabaja en una rama aparte y entra a `main` con un pull request.
- No uses `npx wrangler deploy` para publicar: el siguiente cambio en `main` pisa lo publicado a mano.
- Los secretos no se publican con el código: se guardan con `npx wrangler secret put NOMBRE`.

Para probar en el computador: `npx wrangler dev` (abre http://localhost:8787).

Dominios: `northik.ai`, `www.northik.ai` y `northik.co` (redirige a northik.ai), todos en Cloudflare.

## Agenda (`/agenda/`)

- Reglas de disponibilidad (horarios, duración, anticipación, festivos y días sin citas propios en `diasSinCitas`): `worker/agenda-config.js`. Cada cambio se publica al llegar a `main`.
- Calendarios en `AGENDA_CALENDARIOS` (`wrangler.jsonc`), separados por coma: el primero recibe las citas y en todos se revisan las horas ocupadas.
- Secretos en Cloudflare, nunca en el repositorio: `GOOGLE_NK_CLIENT_SECRET` y `GOOGLE_NK_REFRESH_TOKEN`. Los guarda el script del token. El ID de cliente (`GOOGLE_CLIENT_ID`) va en `vars` de `wrangler.jsonc` porque no es secreto.
- Para obtener el refresh token (una sola vez): `node scripts/token-google.mjs`. Si `AGENDA_SHEET_ID` o `CREADORES_SHEET_ID` están vacíos, el script crea esas hojas privadas y anota su ID. Al final revisa el acceso a los calendarios. Qué cuenta usar y el paso a paso están en la documentación privada de Northik Match.
- Cada reserva crea el evento en Google Calendar (con la marca privada `creadoPor=northik-agenda`) y agrega una fila a la hoja privada «Northik · Agenda», pestaña «Citas» (ID en `AGENDA_SHEET_ID`). Si la hoja falla, la cita igual se crea y llega un aviso al correo de avisos.
- El cron mensual (día 1) borra las filas y los eventos marcados de /agenda con más de 24 meses.
- En Google Cloud deben estar activas las APIs de Calendar y Sheets. Permisos del token: `calendar.events`, `calendar.freebusy` y `spreadsheets`.
- Vuelve a correr `node scripts/token-google.mjs` si cambias el client secret, si quitas el permiso de la app en Google o si cambian los permisos que pide.
- Las citas no se guardan en D1.
- Caso observado el 26 nov 2026: en la primera reserva de prueba después de publicar el cambio a la cuenta de Workspace, la cita se creó en el calendario pero la fila no llegó a la hoja y tampoco llegó el aviso de «no se guardó en la hoja». Las reservas siguientes sí se guardaron. Si vuelve a pasar: compara el calendario con la hoja, agrega la fila a mano y revisa los registros del worker en Cloudflare (Observability) a la hora de la reserva.

## Registro de creadores (`/creadores/`)

Página donde los creadores de contenido se registran gratis en Northik Match con sus datos, sus cifras y pantallazos de su audiencia, para que su perfil entre en la evaluación cuando una marca o agencia busca creadores como ellos.

La documentación técnica está en el repositorio privado de Northik Match.
