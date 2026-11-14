# Northik AI · northik.ai

Sitio web de Northik AI, publicado en **Cloudflare Workers con archivos estáticos** en https://northik.ai.

## Cómo está armado

- **Páginas** (HTML, CSS y JS estáticos, sin compilación): `index.html`, `contacto/`, `agenda/`, `datos/`, `terminos/`, `cookies/`, `reembolsos/`. Fuentes en `fuentes/`, imágenes en `img/`.
- **Programa del sitio** (`worker/index.js`): atiende solo `/api/*` y `/admin/*`; todo lo demás se sirve directo como archivo estático.
  - `/api/contacto`: formulario «Cuéntanos tu proyecto» (base D1 `northik-formularios` y aviso por correo).
  - `/api/agenda/*`: agenda de llamadas con Google Calendar (ver abajo).
  - `/admin/*.csv`: descargas protegidas con Cloudflare Access.
- **Configuración de Cloudflare**: `wrangler.jsonc` (bindings, límite de envíos, cron mensual).
- `_headers`: cabeceras de seguridad (CSP) de las páginas estáticas.
- `.assetsignore`: lo que **no** se publica como archivo (por ejemplo `worker/`, `README.md`, `wrangler.jsonc`).

## Publicar

```bash
npx wrangler deploy
```

Para probar en el computador: `npx wrangler dev` (abre http://localhost:8787).

## Agenda (`/agenda/`)

- Reglas de disponibilidad (horarios, duración, anticipación, festivos): `worker/agenda-config.js`.
- Secretos en Cloudflare, nunca en el repositorio:
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  npx wrangler secret put GOOGLE_REFRESH_TOKEN
  ```
  El ID de cliente (`GOOGLE_CLIENT_ID`) va en `vars` de `wrangler.jsonc` porque no es secreto.
- Para obtener el refresh token (una sola vez, con la cuenta northik.admin@gmail.com): `node scripts/token-google.mjs`.
- Las citas no se guardan en D1: solo existen como eventos en Google Calendar.
