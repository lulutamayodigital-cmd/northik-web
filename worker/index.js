// Northik AI · recibe el formulario de contacto de northik.ai
// Guarda cada envío en la base de datos D1 (binding DB) y avisa por correo (binding EMAIL).
import { EmailMessage } from "cloudflare:email";

const SERVICIOS = ["Strategy", "Motion", "Match", "Flow", "No sé todavía"];
const MAX = { nombre: 120, correo: 160, whatsapp: 40, empresa: 160, mensaje: 3000 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contacto") {
      if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
      return contacto(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function contacto(request, env) {
  let datos;
  try {
    const tipo = request.headers.get("content-type") || "";
    datos = tipo.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, error: "No pudimos leer el formulario." }, 400);
  }

  // Trampa para robots: un campo oculto que una persona nunca llena.
  if (datos.sitio_web) return json({ ok: true });

  const v = (k) => String(datos[k] ?? "").trim().slice(0, MAX[k] ?? 200);
  const r = {
    nombre: v("nombre"), correo: v("correo"), whatsapp: v("whatsapp"),
    empresa: v("empresa"), servicio: v("servicio"), mensaje: v("mensaje"),
  };
  const si = (k) => datos[k] === "si" || datos[k] === true || datos[k] === "on";
  const autoriza = si("autorizacion"), terminos = si("acepta_terminos"), mayor = si("mayor_edad");
  const version = String(datos.version_documentos || "").slice(0, 20);

  const faltan = [];
  if (!r.nombre) faltan.push("tu nombre");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.correo)) faltan.push("un correo válido");
  if (!r.mensaje) faltan.push("tu mensaje");
  if (!terminos) faltan.push("aceptar los términos");
  if (!autoriza) faltan.push("la autorización de datos");
  if (!mayor) faltan.push("confirmar que eres mayor de 18 años");
  if (faltan.length) return json({ ok: false, error: "Falta " + faltan.join(", ") + "." }, 400);
  if (!SERVICIOS.includes(r.servicio)) r.servicio = "No sé todavía";

  const fecha = new Date().toISOString();
  const pais = request.cf?.country || "";

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contactos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL, nombre TEXT NOT NULL, correo TEXT NOT NULL,
      whatsapp TEXT, empresa TEXT, servicio TEXT, mensaje TEXT NOT NULL,
      autorizacion_datos TEXT NOT NULL, acepta_terminos TEXT NOT NULL,
      mayor_edad TEXT NOT NULL, version_documentos TEXT, pais TEXT)`).run();
  await env.DB.prepare(`INSERT INTO contactos
      (fecha, nombre, correo, whatsapp, empresa, servicio, mensaje, autorizacion_datos, acepta_terminos, mayor_edad, version_documentos, pais)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(fecha, r.nombre, r.correo, r.whatsapp, r.empresa, r.servicio, r.mensaje, "sí · " + fecha, "sí · " + fecha, "sí", version, pais)
    .run();

  // El aviso por correo no debe impedir que el envío quede guardado.
  try { await avisar(env, r, fecha, version); } catch (e) { console.error("No se pudo enviar el aviso:", e); }

  return json({ ok: true });
}

async function avisar(env, r, fecha, version) {
  if (!env.EMAIL || !env.AVISO_PARA) return;
  const de = env.AVISO_DE || "formulario@northik.ai";
  const hora = new Date(fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" });
  const cuerpo = [
    "Nuevo mensaje desde northik.ai", "",
    "Nombre: " + r.nombre, "Correo: " + r.correo, "WhatsApp: " + (r.whatsapp || "—"),
    "Empresa o marca: " + (r.empresa || "—"), "Servicio: " + r.servicio, "Fecha: " + hora, "",
    "Mensaje:", r.mensaje, "", "Aceptó términos, autorizó el tratamiento de datos y confirmó ser mayor de 18 años (documentos versión " + (version || "—") + ").",
  ].join("\r\n");
  const asunto = "Nuevo contacto: " + r.nombre + " · " + r.servicio;
  const raw = [
    "From: Formulario Northik <" + de + ">",
    "To: " + env.AVISO_PARA,
    "Reply-To: " + r.correo.replace(/[\r\n<>]/g, ""),
    "Subject: =?UTF-8?B?" + b64(asunto) + "?=",
    "Message-ID: <" + crypto.randomUUID() + "@northik.ai>",
    "Date: " + new Date(fecha).toUTCString(),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "", b64(cuerpo).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  await env.EMAIL.send(new EmailMessage(de, env.AVISO_PARA, raw));
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
