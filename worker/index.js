// Northik AI · programa del sitio northik.ai
// - /api/contacto: recibe el formulario «Cuéntanos tu proyecto».
//     Guarda el mensaje en la tabla `contactos` y la prueba de aceptación en `aceptaciones`
//     (base D1, binding DB). Avisa por correo (binding EMAIL).
// - /admin/aceptaciones.csv y /admin/contactos.csv: descargas protegidas con Cloudflare Access.
// - Todo lo demás: páginas estáticas del sitio.
import { EmailMessage } from "cloudflare:email";

// Súbela cada vez que cambien los Términos o la Política de datos.
const VERSION_DOCUMENTOS = "2026-11-09";
const MEDIO = "Formulario web northik.ai";
const URL_TERMINOS = "https://northik.ai/terminos/";
const URL_DATOS = "https://northik.ai/datos/";

// Texto exacto de cada casilla, igual al que ve la persona en /contacto/.
// No enviar novedades hasta tener /baja/ y la tabla bajas (Ley 2300, art. 5).
const TEXTO_CASILLAS = {
  terminos: "Acepto los Términos y condiciones",
  privacidad: "Autorizo el tratamiento de mis datos según la Política de datos",
  mayor_edad: "Declaro que soy mayor de 18 años",
  novedades: "Quiero recibir novedades de Northik por correo o WhatsApp",
};

const SERVICIOS = ["Strategy", "Motion", "Match", "Flow", "No sé todavía"];
const PLAZOS = ["", "Lo antes posible", "En 1 mes", "En 2 a 3 meses", "Solo estoy explorando"];
const PRESUPUESTOS = ["", "Menos de $2.000.000", "$2.000.000 a $5.000.000", "$5.000.000 a $10.000.000", "Más de $10.000.000", "Prefiero no decir"];
const ORIGENES = ["", "Instagram", "Recomendación", "Google", "Evento o charla", "Otro"];

// Campos que acepta el formulario y su largo máximo. Cualquier otro campo se rechaza.
const TEXTOS = { nombre: 120, correo: 160, empresa: 160, whatsapp: 40, instagram_web: 200, mensaje: 3000 };
const OPCIONES = { servicio: SERVICIOS, plazo: PLAZOS, presupuesto: PRESUPUESTOS, como_nos_conociste: ORIGENES };
const CASILLAS = ["terminos", "privacidad", "mayor_edad", "novedades"];
const PERMITIDOS = new Set([...Object.keys(TEXTOS), ...Object.keys(OPCIONES), ...CASILLAS, "sitio_web"]);

const ERROR_GENERAL = "No pudimos enviar tu mensaje. Intenta de nuevo o escríbenos a hola@northik.ai.";

export default {
  // Cada mes (día 1): borra a los interesados que llevan más de 24 meses sin escribir (Política de datos).
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(borrarInteresadosVencidos(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/contacto") {
        if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
        return await contacto(request, env);
      }
      if (url.pathname === "/admin/aceptaciones.csv" || url.pathname === "/admin/contactos.csv") {
        return await exportar(request, env, url.pathname.includes("aceptaciones") ? "aceptaciones" : "contactos");
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) {
        return json({ ok: false, error: "No encontrado." }, 404);
      }
    } catch (e) {
      console.error("Error interno:", e && e.stack || e);
      return json({ ok: false, error: ERROR_GENERAL }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

// ---------- Formulario ----------

async function contacto(request, env) {
  // Límite de envíos: máximo 5 por minuto desde la misma dirección (la dirección no se guarda).
  if (env.LIMITE_FORMULARIO) {
    const clave = request.headers.get("cf-connecting-ip") || "sin-ip";
    const { success } = await env.LIMITE_FORMULARIO.limit({ key: clave });
    if (!success) return json({ ok: false, error: "Recibimos varios envíos seguidos. Espera un minuto e intenta de nuevo." }, 429);
  }
  const tipo = request.headers.get("content-type") || "";
  if (!tipo.includes("application/json")) return json({ ok: false, error: ERROR_GENERAL }, 415);
  if (Number(request.headers.get("content-length") || 0) > 20000) return json({ ok: false, error: ERROR_GENERAL }, 413);

  let datos;
  try { datos = await request.json(); } catch { return json({ ok: false, error: ERROR_GENERAL }, 400); }
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return json({ ok: false, error: ERROR_GENERAL }, 400);

  // Solo los campos del formulario.
  for (const k of Object.keys(datos)) if (!PERMITIDOS.has(k)) return json({ ok: false, error: ERROR_GENERAL }, 400);

  // Trampa para robots: un campo oculto que una persona nunca llena.
  if (datos.sitio_web) return json({ ok: true });

  const r = {};
  for (const [k, max] of Object.entries(TEXTOS)) {
    const v = limpiar(datos[k]);
    if (v.length > max) return json({ ok: false, error: "El campo es demasiado largo. Acórtalo e intenta de nuevo." }, 400);
    r[k] = v;
  }
  for (const [k, lista] of Object.entries(OPCIONES)) {
    const v = limpiar(datos[k]);
    r[k] = lista.includes(v) ? v : (k === "servicio" ? "No sé todavía" : "");
  }
  const marca = (k) => datos[k] === true || datos[k] === "si" || datos[k] === "on";
  const c = Object.fromEntries(CASILLAS.map((k) => [k, marca(k)]));

  const faltan = [];
  if (!r.nombre) faltan.push("tu nombre");
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(r.correo)) faltan.push("un correo válido");
  if (!r.mensaje) faltan.push("contarnos qué necesitas");
  if (!c.terminos) faltan.push("aceptar los Términos y condiciones");
  if (!c.privacidad) faltan.push("autorizar el tratamiento de tus datos");
  if (!c.mayor_edad) faltan.push("declarar que eres mayor de 18 años");
  if (faltan.length) return json({ ok: false, error: "Falta " + faltan.join(", ") + "." }, 400);

  const id = crypto.randomUUID();
  const fecha = new Date().toISOString(); // UTC, la pone el servidor
  const casillas = JSON.stringify(TEXTO_CASILLAS);

  await prepararTablas(env);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO contactos
        (id, fecha_hora, nombre, correo, empresa, whatsapp, instagram_web, servicio, mensaje, plazo, presupuesto, como_nos_conociste)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, fecha, r.nombre, r.correo, r.empresa, r.whatsapp, r.instagram_web, r.servicio, r.mensaje, r.plazo, r.presupuesto, r.como_nos_conociste),
    env.DB.prepare(`INSERT INTO aceptaciones
        (id, fecha_hora, correo, nombre, terminos, privacidad, mayor_edad, novedades, version_documentos, texto_casillas, url_terminos, url_datos, medio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, fecha, r.correo, r.nombre, 1, 1, 1, c.novedades ? 1 : 0, VERSION_DOCUMENTOS, casillas, URL_TERMINOS, URL_DATOS, MEDIO),
  ]);

  // El aviso por correo no debe impedir que el envío quede guardado.
  try { await avisar(env, id, fecha, r, c); } catch (e) { console.error("No se pudo enviar el aviso:", e); }

  return json({ ok: true });
}

// ---------- Conservación: borrado a los 24 meses ----------

// Borra los mensajes de quien lleva más de 24 meses sin escribir (cuenta su último mensaje).
// El registro de aceptaciones NO se borra: es la prueba ante la SIC. Queda una línea sin datos personales.
async function borrarInteresadosVencidos(env, ahora = new Date()) {
  await prepararTablas(env);
  const limite = new Date(ahora);
  limite.setUTCMonth(limite.getUTCMonth() - 24);
  const r = await env.DB.prepare(`DELETE FROM contactos WHERE lower(correo) IN (
      SELECT lower(correo) FROM contactos GROUP BY lower(correo) HAVING max(fecha_hora) < ?)`)
    .bind(limite.toISOString()).run();
  const borrados = r.meta?.changes ?? 0;
  await env.DB.prepare(`INSERT INTO borrados_automaticos (fecha, limite, mensajes_borrados) VALUES (?, ?, ?)`)
    .bind(ahora.toISOString(), limite.toISOString(), borrados).run();
  console.log(`Borrado mensual: ${borrados} mensajes anteriores a ${limite.toISOString()}`);
  return borrados;
}

// Quita etiquetas HTML y caracteres de control; recorta espacios.
function limpiar(v) {
  if (v === undefined || v === null) return "";
  return String(v)
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

let tablasListas = false;
async function prepararTablas(env) {
  if (tablasListas) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contactos (
      id TEXT PRIMARY KEY, fecha_hora TEXT NOT NULL, nombre TEXT NOT NULL, correo TEXT NOT NULL,
      empresa TEXT, whatsapp TEXT, instagram_web TEXT, servicio TEXT, mensaje TEXT NOT NULL,
      plazo TEXT, presupuesto TEXT, como_nos_conociste TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS aceptaciones (
      id TEXT PRIMARY KEY, fecha_hora TEXT NOT NULL, correo TEXT NOT NULL, nombre TEXT NOT NULL,
      terminos INTEGER NOT NULL, privacidad INTEGER NOT NULL, mayor_edad INTEGER NOT NULL, novedades INTEGER NOT NULL,
      version_documentos TEXT NOT NULL, texto_casillas TEXT NOT NULL, url_terminos TEXT NOT NULL,
      url_datos TEXT NOT NULL, medio TEXT NOT NULL)`),
    // El registro de aceptaciones nunca se edita.
    env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS aceptaciones_sin_cambios BEFORE UPDATE ON aceptaciones
      BEGIN SELECT RAISE(ABORT, 'El registro de aceptaciones no se puede editar'); END`),
    // Solicitudes de borrado: se borran las respuestas y queda la nota de quién lo pidió y cuándo.
    // Constancia de cada borrado mensual automático (sin datos personales).
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS borrados_automaticos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, limite TEXT NOT NULL, mensajes_borrados INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS solicitudes_borrado (
      id INTEGER PRIMARY KEY AUTOINCREMENT, correo TEXT NOT NULL, fecha_solicitud TEXT NOT NULL,
      fecha_borrado TEXT, nota TEXT)`),
  ]);
  tablasListas = true;
}

async function avisar(env, id, fecha, r, c) {
  if (!env.EMAIL || !env.AVISO_PARA) return;
  const de = env.AVISO_DE || "formulario@northik.ai";
  const hora = new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" });
  const sn = (b) => (b ? "sí" : "no");
  const cuerpo = [
    "Nuevo mensaje desde northik.ai", "",
    "Nombre: " + r.nombre,
    "Correo: " + r.correo,
    "Empresa o marca: " + (r.empresa || "—"),
    "WhatsApp: " + (r.whatsapp || "—"),
    "Instagram o web: " + (r.instagram_web || "—"),
    "Servicio: " + r.servicio,
    "Plazo: " + (r.plazo || "—"),
    "Presupuesto: " + (r.presupuesto || "—"),
    "Cómo nos conoció: " + (r.como_nos_conociste || "—"),
    "Fecha: " + hora, "",
    "Qué necesita:", r.mensaje, "",
    "Casillas: términos " + sn(c.terminos) + " · datos " + sn(c.privacidad) + " · mayor de 18 " + sn(c.mayor_edad) +
      " · novedades " + sn(c.novedades) + " (documentos versión " + VERSION_DOCUMENTOS + ")",
    "ID del envío: " + id,
  ].join("\r\n");
  const asunto = "Nuevo contacto: " + r.nombre + " · " + r.servicio;
  const raw = [
    "From: Formulario Northik <" + de + ">",
    "To: " + env.AVISO_PARA,
    "Reply-To: " + r.correo.replace(/[\r\n<>",]/g, ""),
    "Subject: =?UTF-8?B?" + b64(asunto) + "?=",
    "Message-ID: <" + id + "@northik.ai>",
    "Date: " + new Date(fecha).toUTCString(),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "", b64(cuerpo).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  await env.EMAIL.send(new EmailMessage(de, env.AVISO_PARA, raw));
}

// ---------- Descargas en CSV (protegidas con Cloudflare Access) ----------

async function exportar(request, env, tabla) {
  if (!(await accesoValido(request, env))) {
    return new Response("Acceso restringido.", { status: 403, headers: cabeceras("text/plain; charset=utf-8") });
  }
  await prepararTablas(env);
  let filas, columnas;
  if (tabla === "aceptaciones") {
    const { results } = await env.DB.prepare(`SELECT * FROM aceptaciones ORDER BY fecha_hora`).all();
    columnas = ["Submission ID", "Submitted at", "Nombre", "Correo",
      "Acepto los Términos y condiciones", "Autorizo el tratamiento de mis datos", "Declaro que soy mayor de 18 años",
      "Quiero recibir novedades", "version_documentos", "texto_casillas", "url_terminos", "url_datos", "medio"];
    const sn = (v) => (v ? "true" : "false");
    filas = results.map((a) => [a.id, a.fecha_hora, a.nombre, a.correo, sn(a.terminos), sn(a.privacidad), sn(a.mayor_edad),
      sn(a.novedades), a.version_documentos, a.texto_casillas, a.url_terminos, a.url_datos, a.medio]);
  } else {
    const { results } = await env.DB.prepare(`SELECT * FROM contactos ORDER BY fecha_hora`).all();
    columnas = ["Submission ID", "Submitted at", "Nombre", "Correo", "Empresa o marca", "WhatsApp", "Instagram o web",
      "Servicio", "Qué necesita", "Plazo", "Presupuesto", "Cómo nos conociste"];
    filas = results.map((x) => [x.id, x.fecha_hora, x.nombre, x.correo, x.empresa, x.whatsapp, x.instagram_web,
      x.servicio, x.mensaje, x.plazo, x.presupuesto, x.como_nos_conociste]);
  }
  const csv = "﻿" + [columnas, ...filas].map((f) => f.map(celda).join(",")).join("\r\n") + "\r\n";
  const hoy = new Date().toISOString().slice(0, 10);
  const h = cabeceras("text/csv; charset=utf-8");
  h["content-disposition"] = `attachment; filename="northik-${tabla}-${hoy}.csv"`;
  return new Response(csv, { headers: h });
}

function celda(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas al abrir en Excel o Sheets
  return '"' + s.replace(/"/g, '""') + '"';
}

// Verifica el token que pone Cloudflare Access (Zero Trust) antes de dejar pasar.
// Necesita las variables ACCESS_TEAM_DOMAIN (ej. northik.cloudflareaccess.com) y ACCESS_AUD.
async function accesoValido(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  try {
    const [h64, p64, s64] = token.split(".");
    const header = JSON.parse(texto(h64)), payload = JSON.parse(texto(p64));
    const ahora = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (header.alg !== "RS256" || !aud.includes(env.ACCESS_AUD) || payload.exp < ahora ||
        payload.iss !== "https://" + env.ACCESS_TEAM_DOMAIN) return false;
    const certs = await (await fetch("https://" + env.ACCESS_TEAM_DOMAIN + "/cdn-cgi/access/certs")).json();
    const jwk = (certs.keys || []).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const clave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", clave, bytes(s64), new TextEncoder().encode(h64 + "." + p64));
  } catch {
    return false;
  }
}

// ---------- Utilidades ----------

function bytes(b64url) {
  const b = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
}
function texto(b64url) { return new TextDecoder().decode(bytes(b64url)); }

function b64(s) {
  const bs = new TextEncoder().encode(s);
  let bin = ""; for (const b of bs) bin += String.fromCharCode(b);
  return btoa(bin);
}

function cabeceras(tipo) {
  return {
    "content-type": tipo,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: cabeceras("application/json; charset=utf-8") });
}
