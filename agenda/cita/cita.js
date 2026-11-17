// Cambiar o cancelar una cita · northik.ai/agenda/cita/#<código>
// El código va después del «#»: el navegador no lo envía al cargar la página ni a otros sitios.
// Solo se manda al worker en el cuerpo de las peticiones a /api/agenda/cita.
import { crearSelector } from "../selector.js";

const $ = (id) => document.getElementById(id);
const WHATSAPP = "https://wa.me/573054670254?text=Hola%2C%20quiero%20cambiar%20o%20cancelar%20mi%20llamada%20con%20Northik%20AI";
const MSG_CARGA = "No pudimos cargar tu cita. Intenta de nuevo o escríbenos por WhatsApp.";
const MSG_GUARDAR = "No pudimos guardar el cambio. Intenta de nuevo o escríbenos por WhatsApp.";
const VISTAS = ["v-cargando", "v-cita", "v-cambiar", "v-listo", "v-aviso"];

const codigo = decodeURIComponent(location.hash.slice(1));
let cita = null; // { dia, hora }

const enlace = (href, texto, nueva = false) =>
  Object.assign(document.createElement("a"), { href, textContent: texto, ...(nueva ? { target: "_blank", rel: "noopener" } : {}) });
const otraCita = () => ["entra a ", enlace("/agenda/", "northik.ai/agenda"), " o ", enlace(WHATSAPP, "escríbenos por WhatsApp", true), "."];

function mostrar(id) {
  VISTAS.forEach((v) => { $(v).hidden = v !== id; });
  $("volver").hidden = id !== "v-cambiar";
  window.scrollTo({ top: 0, behavior: "auto" });
}

function aviso(...partes) {
  $("v-aviso").replaceChildren(...partes);
  mostrar("v-aviso");
  $("titulo").focus({ preventScroll: true });
}

function avisoEstado(estado) {
  if (estado === "pasada") return aviso("Esta llamada ya pasó. Si quieres agendar otra, ", ...otraCita());
  if (estado === "cancelada") return aviso("Esta llamada ya fue cancelada. Si quieres agendar otra, ", ...otraCita());
  if (estado === "invalido") return aviso("Este enlace no es válido. Revisa que lo hayas copiado completo o ", enlace(WHATSAPP, "escríbenos por WhatsApp", true), ".");
  return aviso("No pudimos cargar tu cita. Intenta de nuevo o ", enlace(WHATSAPP, "escríbenos por WhatsApp", true), ".");
}

async function pedir(accion, extra = {}) {
  const r = await fetch("/api/agenda/cita", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ codigo, accion, ...extra }),
  });
  return { r, j: await r.json().catch(() => ({})) };
}

// ---------- Ver la cita ----------
function pintarCita() {
  const fecha = document.createElement("strong");
  fecha.textContent = `${cita.dia} a las ${cita.hora}`;
  $("cita-texto").replaceChildren(fecha, " (hora de Colombia). Dura 20 minutos, por Google Meet.");
  $("opciones-cita").hidden = false;
  $("pregunta-cancelar").hidden = true;
  $("msg-cita").className = "msg"; $("msg-cita").textContent = "";
  mostrar("v-cita");
}

async function cargar() {
  if (!/^[a-v0-9]{5,64}\.[A-Za-z0-9_-]{20,}$/.test(codigo)) return avisoEstado("invalido");
  try {
    const { r, j } = await pedir("ver");
    if (r.ok && j.ok && j.estado === "activa") { cita = { dia: j.dia, hora: j.hora }; return pintarCita(); }
    if (j.estado) return avisoEstado(j.estado);
    if (r.status === 429 && j.error) return aviso(j.error);
    avisoEstado("error");
  } catch {
    avisoEstado("error");
  }
}

// ---------- Cancelar ----------
$("ir-cancelar").addEventListener("click", () => {
  $("pregunta-texto").textContent = `¿Seguro que quieres cancelar la llamada del ${cita.dia} a las ${cita.hora}?`;
  $("opciones-cita").hidden = true;
  $("pregunta-cancelar").hidden = false;
  $("si-cancelar").focus();
});
$("no-cancelar").addEventListener("click", () => { pintarCita(); $("ir-cancelar").focus(); });

$("si-cancelar").addEventListener("click", async () => {
  const btn = $("si-cancelar"), m = $("msg-cita");
  btn.disabled = true; $("no-cancelar").disabled = true;
  m.className = "msg"; m.textContent = "";
  try {
    const { r, j } = await pedir("cancelar");
    if (r.ok && j.ok) {
      listo("Listo, tu llamada quedó cancelada.", ["Si quieres agendar otra, ", ...otraCita()]);
    } else if (j.estado && j.estado !== "activa") {
      avisoEstado(j.estado);
    } else {
      m.className = "msg err"; m.textContent = j.error || MSG_GUARDAR;
    }
  } catch {
    m.className = "msg err"; m.textContent = MSG_GUARDAR;
  }
  btn.disabled = false; $("no-cancelar").disabled = false;
});

// ---------- Cambiar la hora ----------
const selector = crearSelector($("selector"), (inicio) => { $("confirmar-cambio").disabled = !inicio; });

async function cargarHorarios(mensaje = "") {
  const m = $("msg-cambiar");
  m.className = mensaje ? "msg err" : "msg"; m.textContent = mensaje;
  let hay;
  try {
    hay = await selector.cargar();
  } catch (e) {
    m.className = "msg err"; m.textContent = (e && e.message) || MSG_CARGA;
    return;
  }
  $("confirmar-cambio").hidden = !hay;
  if (!hay) $("selector").innerHTML = '<p class="vacio">Por ahora no hay espacios. Escríbenos por WhatsApp y buscamos una hora.</p>';
}

$("ir-cambiar").addEventListener("click", () => {
  mostrar("v-cambiar");
  $("titulo").focus({ preventScroll: true });
  cargarHorarios();
});
$("volver").addEventListener("click", () => { pintarCita(); $("ir-cambiar").focus(); });

$("confirmar-cambio").addEventListener("click", async () => {
  const inicio = selector.hora;
  if (!inicio) return;
  const btn = $("confirmar-cambio"), m = $("msg-cambiar");
  btn.disabled = true; btn.textContent = "Confirmando…";
  m.className = "msg"; m.textContent = "";
  try {
    const { r, j } = await pedir("cambiar", { inicio });
    if (r.ok && j.ok) {
      cita = { dia: j.dia, hora: j.hora };
      listo(`Listo. Tu llamada quedó para el ${j.dia} a las ${j.hora}.`,
        ["Google Calendar te envió la invitación actualizada. El enlace de Google Meet es el mismo."]);
    } else if (r.status === 409 || j.ocupada) {
      await cargarHorarios(j.error || "Esa hora se acaba de ocupar. Elige otra.");
    } else if (j.estado && j.estado !== "activa") {
      avisoEstado(j.estado);
    } else {
      m.className = "msg err"; m.textContent = j.error || MSG_GUARDAR;
    }
  } catch {
    m.className = "msg err"; m.textContent = MSG_GUARDAR;
  }
  btn.textContent = "Confirmar cambio";
  btn.disabled = !selector.hora;
});

// ---------- Listo ----------
function listo(titulo, partes) {
  $("listo-titulo").textContent = titulo;
  $("listo-texto").replaceChildren(...partes);
  mostrar("v-listo");
  $("listo-titulo").focus({ preventScroll: true });
}

cargar();
