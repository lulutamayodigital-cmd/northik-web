// Registro de creadores (/api/creadores) · página northik.ai/creadores/
// - POST /api/creadores: valida el registro, guarda los pantallazos en R2 (privado) y agrega una fila
//   a la hoja privada «Northik · Creadores» (pestaña «Registros»).
//   Si la hoja falla, el registro se guarda en D1 (tabla creadores_respaldo) y llega un aviso por correo.
// - archivoCreador: entrega un pantallazo solo a quien pasó por Cloudflare Access (/admin/creadores/…).
// - borrarCreadoresVencidos: borrado mensual (cron) de filas, pantallazos y respaldos con más de 24 meses.
import { NICHOS, TARIFAS, PANTALLAZOS, TEXTO_CASILLAS, RESIDENCIAS } from "../creadores/config.js";
import { PAISES } from "../agenda/paises.js";
import { agregarFila, leerFilas, borrarFilas, crearHoja, asegurarTitulo } from "./google.js";
import { avisoInterno } from "./aviso.js";
import { VERSION_DOCUMENTOS } from "./documentos.js";

export const HOJA_CREADORES = {
  nombre: "Northik · Creadores",
  pestana: "Registros",
  columnas: ["Fecha de registro", "Nombre", "Instagram", "TikTok", "Ciudad", "Nicho", "Tarifa por publicación",
    "Correo", "WhatsApp", "Red de las cifras", "Seguidores", "Vistas promedio por reel o video",
    "Interacciones promedio por publicación", "Mayor de 18", "Autoriza tratamiento de datos",
    "Versión de la política", "Origen", "Pantallazos", "ID del registro", "País de residencia"],
};
const CONSERVACION_MESES = 24;
const MEDIO = "Registro de creadores northik.ai/creadores";
const URL_DATOS = "https://northik.ai/datos/";
const REMITENTE = "Registro de creadores Northik";

const MSG_ERROR = "No pudimos enviar tu registro. Intenta de nuevo o escríbenos a hola@northik.ai.";
const CAMPOS = new Set(["nombre", "instagram", "tiktok", "residencia", "ciudad", "nicho", "tarifa", "correo", "pais", "telefono",
  "red_cifras", "seguidores", "vistas", "interacciones", "mayor_edad", "autorizo", "origen", "sitio_web"]);
const MAX_CUERPO = PANTALLAZOS.maximo * PANTALLAZOS.maxBytes + 100000;

// ---------- Validación ----------
const limpiar = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const usuario = (v) => {
  const u = limpiar(v, 60).replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\/@?/i, "").replace(/^@+/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(u) ? u.toLowerCase() : "";
};
const cifra = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n) : 0;
};

export function validar(body) {
  const errores = [];
  if (Object.keys(body).some((k) => !CAMPOS.has(k))) errores.push("campos");
  const nombre = limpiar(body.nombre, 80);
  const instagram = usuario(body.instagram);
  const tiktok = usuario(body.tiktok);
  const residencia = RESIDENCIAS.includes(body.residencia) ? body.residencia : "";
  const ciudad = limpiar(body.ciudad, 60);
  const nicho = NICHOS.includes(body.nicho) ? body.nicho : "";
  const tarifa = TARIFAS.includes(body.tarifa) ? body.tarifa : "";
  const correo = limpiar(body.correo, 160).toLowerCase();
  const pais = PAISES.find((p) => p.codigo === body.pais);
  const numero = String(body.telefono ?? "").replace(/\D/g, "");
  const seguidores = cifra(body.seguidores), vistas = cifra(body.vistas), interacciones = cifra(body.interacciones);
  const red_cifras = ["Instagram", "TikTok"].includes(body.red_cifras) ? body.red_cifras : "Instagram";
  const origen = typeof body.origen === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(body.origen) ? body.origen.toLowerCase() : "web";

  if (nombre.length < 2) errores.push("nombre");
  if (!instagram && !tiktok) errores.push("redes");
  if (!residencia) errores.push("residencia");
  if (ciudad.length < 2) errores.push("ciudad");
  if (!nicho) errores.push("nicho");
  if (!tarifa) errores.push("tarifa");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) errores.push("correo");
  if (!pais || numero.length < 6 || (pais.prefijo + numero).length > 15) errores.push("telefono");
  if (!seguidores) errores.push("seguidores");
  if (!vistas) errores.push("vistas");
  if (!interacciones || interacciones > seguidores) errores.push("interacciones");
  if (body.mayor_edad !== true) errores.push("mayor_edad");
  if (body.autorizo !== true) errores.push("autorizo");

  return {
    errores,
    datos: { nombre, instagram, tiktok, residencia, ciudad, nicho, tarifa, correo, whatsapp: `+${pais?.prefijo ?? ""} ${numero}`,
      red_cifras, seguidores, vistas, interacciones, origen },
  };
}

// Revisa los primeros bytes: solo JPG, PNG o WEBP de verdad (no basta con el nombre).
async function tipoImagen(archivo) {
  const b = new Uint8Array(await archivo.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", tipo: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", tipo: "image/png" };
  const txt = String.fromCharCode(...b);
  if (txt.startsWith("RIFF") && txt.slice(8, 12) === "WEBP") return { ext: "webp", tipo: "image/webp" };
  return null;
}

// «2026-11-16 19:45» en hora de Colombia.
function fechaHoraBogota(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// ---------- D1: respaldo, ajustes y prueba de la autorización ----------
let tablasListas = false;
async function prepararTablas(env) {
  if (tablasListas) return;
  await env.DB.batch([
    // Solo se usa cuando la hoja falla. Se borra a los 24 meses (o antes si el creador lo pide).
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS creadores_respaldo (
      id TEXT PRIMARY KEY, fecha_hora TEXT NOT NULL, correo TEXT NOT NULL, fila TEXT NOT NULL, error TEXT)`),
    // Ajustes del sitio, por ejemplo el ID de la hoja «Northik · Creadores» cuando se crea sola.
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)`),
    // Misma tabla de aceptaciones del formulario de contacto (prueba ante la SIC).
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS aceptaciones (
      id TEXT PRIMARY KEY, fecha_hora TEXT NOT NULL, correo TEXT NOT NULL, nombre TEXT NOT NULL,
      terminos INTEGER NOT NULL, privacidad INTEGER NOT NULL, mayor_edad INTEGER NOT NULL, novedades INTEGER NOT NULL,
      version_documentos TEXT NOT NULL, texto_casillas TEXT NOT NULL, url_terminos TEXT NOT NULL,
      url_datos TEXT NOT NULL, medio TEXT NOT NULL)`),
  ]);
  tablasListas = true;
}

// ID de la hoja: el de wrangler.jsonc (CREADORES_SHEET_ID) o el que quedó guardado en D1.
// Si no hay ninguno, la crea (privada, en el Drive de la cuenta de Google conectada) y guarda su ID.
async function hojaCreadores(env, { crear = true } = {}) {
  if (env.CREADORES_SHEET_ID) return env.CREADORES_SHEET_ID;
  await prepararTablas(env);
  const guardado = await env.DB.prepare(`SELECT valor FROM ajustes WHERE clave = 'creadores_sheet_id'`).first();
  if (guardado?.valor) return guardado.valor;
  if (!crear) return null;
  const id = await crearHoja(env, HOJA_CREADORES.nombre, HOJA_CREADORES.pestana, HOJA_CREADORES.columnas);
  await env.DB.prepare(`INSERT OR IGNORE INTO ajustes (clave, valor) VALUES ('creadores_sheet_id', ?)`).bind(id).run();
  const final = await env.DB.prepare(`SELECT valor FROM ajustes WHERE clave = 'creadores_sheet_id'`).first();
  return final.valor;
}

// ---------- Ruta ----------
async function _registrar(request, env, ctx, json) {
  // Mismo límite de envíos del formulario de contacto y de la agenda (5 por minuto por dirección).
  if (env.LIMITE_FORMULARIO) {
    const clave = request.headers.get("cf-connecting-ip") || "sin-ip";
    const { success } = await env.LIMITE_FORMULARIO.limit({ key: clave });
    if (!success) return json({ ok: false, error: "Recibimos varios envíos seguidos. Espera un minuto e intenta de nuevo." }, 429);
  }
  if (!(request.headers.get("content-type") || "").includes("multipart/form-data")) return json({ ok: false, error: MSG_ERROR }, 415);
  if (Number(request.headers.get("content-length") || 0) > MAX_CUERPO) {
    return json({ ok: false, error: "Los pantallazos pesan demasiado. Sube hasta 4 imágenes de 5 MB." }, 413);
  }

  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: MSG_ERROR }, 400); }
  for (const k of form.keys()) if (k !== "datos" && k !== "pantallazos") return json({ ok: false, error: MSG_ERROR }, 400);
  let body;
  try { body = JSON.parse(String(form.get("datos") || "")); } catch { return json({ ok: false, error: MSG_ERROR }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: MSG_ERROR }, 400);

  // Campo trampa: si viene lleno es un robot. Responde como si todo saliera bien y no guarda nada.
  if (body.sitio_web) return json({ ok: true });

  const { errores, datos } = validar(body);
  if (errores.length) return json({ ok: false, campos: errores, error: "Revisa los datos del formulario." }, 400);

  // Pantallazos: máximo 4, de hasta 5 MB, y que de verdad sean imágenes.
  const archivos = form.getAll("pantallazos").filter((f) => typeof f === "object" && f && f.size > 0);
  if (!archivos.length) return json({ ok: false, error: "Sube al menos un pantallazo de tu audiencia (ciudad, edad y género)." }, 400);
  if (archivos.length > PANTALLAZOS.maximo) return json({ ok: false, error: `Sube hasta ${PANTALLAZOS.maximo} pantallazos.` }, 400);
  const imagenes = [];
  for (const f of archivos) {
    if (f.size > PANTALLAZOS.maxBytes) return json({ ok: false, error: "Cada pantallazo debe pesar menos de 5 MB." }, 400);
    const t = await tipoImagen(f);
    if (!t) return json({ ok: false, error: "Los pantallazos deben ser imágenes JPG, PNG o WEBP." }, 400);
    imagenes.push({ archivo: f, ...t });
  }

  const id = crypto.randomUUID();
  const ahora = new Date();
  const problemas = [];

  // Pantallazos en R2 (privado). Los enlaces de la hoja solo abren pasando por Cloudflare Access.
  const enlaces = [];
  if (imagenes.length) {
    const base = new URL(request.url).origin;
    try {
      if (!env.ARCHIVOS_CREADORES) throw new Error("falta el binding ARCHIVOS_CREADORES");
      for (const [i, im] of imagenes.entries()) {
        const clave = `${id}/pantallazo-${i + 1}.${im.ext}`;
        await env.ARCHIVOS_CREADORES.put(clave, im.archivo.stream(), {
          httpMetadata: { contentType: im.tipo },
          customMetadata: { registro: ahora.toISOString() },
        });
        enlaces.push(`${base}/admin/creadores/${clave}`);
      }
    } catch (e) {
      console.error("No se pudieron guardar los pantallazos:", (e && e.stack) || e);
      problemas.push("Los pantallazos no se pudieron guardar: " + String((e && e.message) || e).slice(0, 200));
    }
  }

  const hayCifras = datos.seguidores || datos.vistas || datos.interacciones;
  const fila = [
    fechaHoraBogota(ahora), datos.nombre, datos.instagram ? "@" + datos.instagram : "", datos.tiktok ? "@" + datos.tiktok : "",
    datos.ciudad, datos.nicho, datos.tarifa, datos.correo, datos.whatsapp, hayCifras ? datos.red_cifras : "",
    datos.seguidores || "", datos.vistas || "", datos.interacciones || "", "Sí", "Sí", VERSION_DOCUMENTOS, datos.origen,
    enlaces.join("\n") || (imagenes.length ? "No se pudieron guardar" : ""), id, datos.residencia,
  ].map((v) => String(v));

  // Prueba de la autorización (no bloquea el registro: la fila también la lleva).
  try {
    await prepararTablas(env);
    await env.DB.prepare(`INSERT INTO aceptaciones
        (id, fecha_hora, correo, nombre, terminos, privacidad, mayor_edad, novedades, version_documentos, texto_casillas, url_terminos, url_datos, medio)
        VALUES (?, ?, ?, ?, 0, 1, 1, 0, ?, ?, '', ?, ?)`)
      .bind(id, ahora.toISOString(), datos.correo, datos.nombre, VERSION_DOCUMENTOS, JSON.stringify(TEXTO_CASILLAS), URL_DATOS, MEDIO).run();
  } catch (e) {
    console.error("No se pudo guardar la aceptación:", (e && e.stack) || e);
  }

  // Hoja privada. Si falla: respaldo en D1 y aviso por correo. El registro no se pierde.
  try {
    const hojaId = await hojaCreadores(env);
    // Hojas creadas antes de la columna «País de residencia»: le pone el título una vez (no bloquea el registro).
    const colResidencia = HOJA_CREADORES.columnas.indexOf("País de residencia");
    await asegurarTitulo(env, hojaId, HOJA_CREADORES.pestana, colResidencia, "País de residencia")
      .catch((e) => console.error("No se pudo poner el título de País de residencia:", e));
    await agregarFila(env, hojaId, HOJA_CREADORES.pestana, fila);
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 300);
    console.error("No se pudo escribir en la hoja de creadores:", (e && e.stack) || e);
    let respaldado = false;
    try {
      await prepararTablas(env);
      await env.DB.prepare(`INSERT INTO creadores_respaldo (id, fecha_hora, correo, fila, error) VALUES (?, ?, ?, ?, ?)`)
        .bind(id, ahora.toISOString(), datos.correo, JSON.stringify(fila), error).run();
      respaldado = true;
    } catch (e2) {
      console.error("Tampoco se pudo guardar el respaldo en D1:", (e2 && e2.stack) || e2);
    }
    let avisado = false;
    try {
      await avisoInterno(env, `Creadores: no se guardó en la hoja el registro de ${datos.nombre}`, [
        "Un creador se registró en northik.ai/creadores, pero no se pudo agregar la fila a la hoja «Northik · Creadores».",
        respaldado ? "El registro quedó guardado en la base de la web (tabla creadores_respaldo)." : "Tampoco se pudo guardar en la base de la web: este correo es la única copia.",
        "Agrégalo a mano en la pestaña «Registros»:", "",
        ...HOJA_CREADORES.columnas.map((c, i) => `${c}: ${fila[i] || "—"}`), "",
        "Error: " + error, ...problemas,
      ], REMITENTE);
      avisado = !!(env.EMAIL && env.AVISO_PARA);
    } catch (e3) {
      console.error("Tampoco se pudo enviar el aviso:", (e3 && e3.stack) || e3);
    }
    if (!respaldado && !avisado) return json({ ok: false, error: MSG_ERROR }, 502);
    return json({ ok: true });
  }

  if (problemas.length) {
    const aviso = avisoInterno(env, `Creadores: revisar el registro de ${datos.nombre}`, [
      "El registro quedó en la hoja «Northik · Creadores», pero hubo un problema:", "", ...problemas, "", "ID del registro: " + id,
    ], REMITENTE).catch((e) => console.error("No se pudo enviar el aviso:", e));
    if (ctx?.waitUntil) ctx.waitUntil(aviso); else await aviso;
  }
  return json({ ok: true });
}

// ---------- Pantallazos para el equipo (protegido con Cloudflare Access en index.js) ----------
export async function archivoCreador(env, ruta, cabeceras) {
  const clave = ruta.replace(/^\/admin\/creadores\//, "");
  if (!/^[0-9a-f-]{36}\/pantallazo-[1-9]\.(jpg|png|webp)$/.test(clave) || !env.ARCHIVOS_CREADORES) {
    return new Response("No encontrado.", { status: 404, headers: cabeceras("text/plain; charset=utf-8") });
  }
  const obj = await env.ARCHIVOS_CREADORES.get(clave);
  if (!obj) return new Response("No encontrado.", { status: 404, headers: cabeceras("text/plain; charset=utf-8") });
  const h = cabeceras(obj.httpMetadata?.contentType || "application/octet-stream");
  h["content-disposition"] = "inline";
  return new Response(obj.body, { headers: h });
}

// ---------- Borrado mensual (cron del día 1) ----------
// Borra filas de la hoja, pantallazos y respaldos de creadores registrados hace más de 24 meses.
export async function borrarCreadoresVencidos(env, ahora = new Date()) {
  const limite = new Date(ahora);
  limite.setUTCMonth(limite.getUTCMonth() - CONSERVACION_MESES);
  const limiteFecha = limite.toISOString().slice(0, 10);
  const resumen = { filas: 0, pantallazos: 0, respaldos: 0, errores: [] };

  try {
    const hojaId = await hojaCreadores(env, { crear: false });
    const filas = !hojaId ? [] : await leerFilas(env, hojaId, HOJA_CREADORES.pestana, "A2:A");
    const viejas = filas.map((f, i) => (/^\d{4}-\d{2}-\d{2}/.test(f[0] || "") && f[0].slice(0, 10) < limiteFecha ? i : -1)).filter((i) => i >= 0);
    await borrarFilas(env, hojaId, HOJA_CREADORES.pestana, viejas);
    resumen.filas = viejas.length;
  } catch (e) {
    resumen.errores.push("hoja: " + String((e && e.message) || e).slice(0, 300));
  }

  try {
    if (env.ARCHIVOS_CREADORES) {
      let cursor;
      do {
        const lista = await env.ARCHIVOS_CREADORES.list({ cursor, limit: 1000 });
        const viejos = lista.objects.filter((o) => o.uploaded < limite).map((o) => o.key);
        if (viejos.length) { await env.ARCHIVOS_CREADORES.delete(viejos); resumen.pantallazos += viejos.length; }
        cursor = lista.truncated ? lista.cursor : undefined;
      } while (cursor);
    }
  } catch (e) {
    resumen.errores.push("pantallazos: " + String((e && e.message) || e).slice(0, 300));
  }

  try {
    await prepararTablas(env);
    const r = await env.DB.prepare(`DELETE FROM creadores_respaldo WHERE fecha_hora < ?`).bind(limite.toISOString()).run();
    resumen.respaldos = r.meta?.changes ?? 0;
  } catch (e) {
    resumen.errores.push("respaldo: " + String((e && e.message) || e).slice(0, 300));
  }

  console.log("Borrado mensual de creadores:", JSON.stringify(resumen));
  if (resumen.errores.length) {
    await avisoInterno(env, "Creadores: falló el borrado mensual", [
      `Límite: registros anteriores a ${limiteFecha}.`,
      `Filas borradas: ${resumen.filas}. Pantallazos borrados: ${resumen.pantallazos}. Respaldos borrados: ${resumen.respaldos}.`, "",
      ...resumen.errores,
    ], REMITENTE).catch((e) => console.error("No se pudo enviar el aviso:", e));
  }
  return resumen;
}

// Errores inesperados: mensaje propio del registro.
export async function registrar(request, env, ctx, json) {
  try {
    return await _registrar(request, env, ctx, json);
  } catch (e) {
    console.error("Error en el registro de creadores:", (e && e.stack) || e);
    return json({ ok: false, error: MSG_ERROR }, 500);
  }
}
