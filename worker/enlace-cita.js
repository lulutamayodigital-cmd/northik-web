// Enlace único para cambiar o cancelar una cita: northik.ai/agenda/cita/#<idDelEvento>.<firma>
// La firma es un HMAC-SHA256 del ID del evento con el secreto AGENDA_FIRMA (solo en Cloudflare).
// Sin el secreto nadie puede fabricar un enlace válido, y no se guarda nada en ninguna base de datos.
const codificar = new TextEncoder();
const LARGO_FIRMA = 32; // caracteres base64url (192 bits)

async function clave(secreto) {
  return crypto.subtle.importKey("raw", codificar.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function base64url(buffer) {
  let s = "";
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ID propio para el evento, en el formato que acepta Google Calendar (letras a-v y números, «base32hex»).
export function nuevoIdEvento() {
  const abc = "abcdefghijklmnopqrstuv0123456789";
  return [...crypto.getRandomValues(new Uint8Array(26))].map((b) => abc[b & 31]).join("");
}

export const hayFirma = (env) => typeof env.AGENDA_FIRMA === "string" && env.AGENDA_FIRMA.length >= 16;

export async function firmar(env, idEvento) {
  const firma = await crypto.subtle.sign("HMAC", await clave(env.AGENDA_FIRMA), codificar.encode("cita:" + idEvento));
  return `${idEvento}.${base64url(firma).slice(0, LARGO_FIRMA)}`;
}

// Devuelve el ID del evento si la firma es válida; si no, null.
export async function verificar(env, codigo) {
  if (!hayFirma(env) || typeof codigo !== "string" || codigo.length > 120) return null;
  const m = /^([a-v0-9]{5,64})\.([A-Za-z0-9_-]+)$/.exec(codigo);
  if (!m || m[2].length !== LARGO_FIRMA) return null;
  const esperado = await firmar(env, m[1]);
  // Comparación en tiempo constante.
  let distinto = 0;
  for (let i = 0; i < esperado.length; i++) distinto |= esperado.charCodeAt(i) ^ codigo.charCodeAt(i);
  return distinto === 0 ? m[1] : null;
}

export async function enlaceCita(env, origen, idEvento) {
  return `${origen}/agenda/cita/#${await firmar(env, idEvento)}`;
}
