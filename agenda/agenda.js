// Agenda de llamadas · northik.ai/agenda/
// Paso 1: formulario · Paso 2: día y hora · Paso 3: confirmación.
// Todo lo que toca Google pasa por /api/agenda/* (worker). Aquí no hay claves ni tokens.
import { PAISES } from "./paises.js";

const OBJETIVOS = [
  "Aparecer en video sin grabarme (gemelo digital)",
  "Saber qué publicar y a quién (estrategia)",
  "Trabajar con creadores de contenido",
  "Automatizar la atención de mi negocio",
  "Otro",
];
const MSG_ERROR = "No pudimos cargar los horarios. Revisa tu conexión e intenta de nuevo, o escríbenos por WhatsApp.";
const $ = (id) => document.getElementById(id);

// Origen: ?origen=gemelo (ManyChat, etc.). Si no viene, «web».
const origenUrl = new URLSearchParams(location.search).get("origen") || "";
const origen = /^[a-zA-Z0-9_-]{1,40}$/.test(origenUrl) ? origenUrl.toLowerCase() : "web";

// ---------- Paso 1 ----------
const form = $("formulario");
$("pais").innerHTML = PAISES.map((p) => `<option value="${p.codigo}">${p.codigo} +${p.prefijo}</option>`).join("");
$("pais").value = "CO";
$("opciones").innerHTML = OBJETIVOS.map(
  (o, i) => `<label class="opcion"><input type="radio" name="objetivo" value="${o}" ${i === 0 ? "required" : ""}><span>${o}</span></label>`,
).join("");
$("detalle").addEventListener("input", (e) => { $("cuenta").textContent = `${e.target.value.length}/300`; });

function leerFormulario() {
  const d = new FormData(form);
  return {
    nombre: (d.get("nombre") || "").trim(),
    correo: (d.get("correo") || "").trim(),
    pais: d.get("pais"),
    telefono: (d.get("telefono") || "").replace(/\D/g, ""),
    objetivo: d.get("objetivo") || "",
    detalle: (d.get("detalle") || "").trim(),
    autorizo: $("autorizo").checked,
    sitio_web: d.get("sitio_web") || "",
    origen,
  };
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const d = leerFormulario();
  const falta = [];
  if (d.nombre.length < 2) falta.push("tu nombre");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.correo)) falta.push("un correo válido");
  if (d.telefono.length < 6) falta.push("tu WhatsApp");
  if (!d.objetivo) falta.push("elegir qué te gustaría lograr");
  if (!d.autorizo) falta.push("autorizar el tratamiento de tus datos");
  const m = $("msg1");
  if (falta.length) { m.className = "msg err"; m.textContent = "Falta " + falta.join(", ") + "."; return; }
  m.className = "msg"; m.textContent = "";
  irA(2);
  cargarHorarios();
});

// ---------- Paso 2 ----------
let dias = [];
let diaSel = null;
let horaSel = null;

const fmtDia = (fecha, op) => new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", ...op }).format(new Date(fecha + "T12:00:00Z"));
function fmtHora(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  const p = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${p}`;
}

async function cargarHorarios(mensaje = "") {
  const sel = $("selector");
  sel.innerHTML = '<div class="cargando" aria-label="Cargando horarios"><i></i><i></i><i></i><i></i></div>';
  horaSel = null; actualizarConfirmar();
  const m = $("msg2");
  m.className = mensaje ? "msg err" : "msg"; m.textContent = mensaje;
  try {
    const r = await fetch("/api/agenda/horarios", { headers: { accept: "application/json" } });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error);
    dias = j.dias;
  } catch (e) {
    sel.innerHTML = "";
    m.className = "msg err"; m.textContent = (e && e.message) || MSG_ERROR;
    return;
  }
  if (!dias.length) {
    sel.innerHTML = '<p class="vacio">Por ahora no hay espacios. Escríbenos por WhatsApp y buscamos una hora.</p>';
    $("confirmar").hidden = true;
    return;
  }
  $("confirmar").hidden = false;
  if (!dias.some((d) => d.fecha === diaSel)) diaSel = dias[0].fecha;
  pintarSelector();
}

function pintarSelector() {
  const chips = dias.map((d) => `
    <button type="button" class="chip" data-fecha="${d.fecha}" aria-pressed="${d.fecha === diaSel}"
      aria-label="${fmtDia(d.fecha, { weekday: "long", day: "numeric", month: "long" })}">
      <span class="ds">${fmtDia(d.fecha, { weekday: "short" }).replace(".", "")}</span>
      <span class="dn">${fmtDia(d.fecha, { day: "numeric" })}</span>
      <span class="dm">${fmtDia(d.fecha, { month: "short" }).replace(".", "")}</span>
    </button>`).join("");
  const dia = dias.find((d) => d.fecha === diaSel);
  const horas = dia.horas.map((h) => h.ocupada
    ? `<button type="button" class="hora ocupada" disabled aria-label="${fmtHora(h.hora)}, ocupada">${fmtHora(h.hora)}</button>`
    : `<button type="button" class="hora" data-inicio="${h.inicio}" data-hora="${h.hora}" aria-pressed="${h.inicio === horaSel}">${fmtHora(h.hora)}</button>`).join("");
  $("selector").innerHTML = `
    <div class="dias" role="group" aria-label="Días disponibles">${chips}</div>
    <div class="panel" style="gap:12px;margin-top:14px">
      <p class="dia-sel">${fmtDia(diaSel, { weekday: "long", day: "numeric", month: "long" })}</p>
      <div class="horas" role="group" aria-label="Horas">${horas}</div>
      <p class="nota">Horas en hora de Colombia (GMT-5).</p>
    </div>`;
  const activo = $("selector").querySelector('.chip[aria-pressed="true"]');
  if (activo) activo.scrollIntoView({ block: "nearest", inline: "nearest" });
}

$("selector").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) { diaSel = chip.dataset.fecha; horaSel = null; pintarSelector(); actualizarConfirmar(); return; }
  const hora = e.target.closest(".hora:not(.ocupada)");
  if (hora) {
    horaSel = hora.dataset.inicio;
    $("selector").querySelectorAll(".hora").forEach((b) => b.setAttribute("aria-pressed", String(b === hora)));
    actualizarConfirmar();
  }
});

function actualizarConfirmar() { $("confirmar").disabled = !horaSel; }

$("confirmar").addEventListener("click", async () => {
  if (!horaSel) return;
  const btn = $("confirmar"), m = $("msg2");
  btn.disabled = true; btn.textContent = "Confirmando…";
  m.className = "msg"; m.textContent = "";
  const d = leerFormulario();
  try {
    const r = await fetch("/api/agenda/reservar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...d, inicio: horaSel }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      $("t3").textContent = `Listo, ${d.nombre}. Te esperamos el ${j.dia} a las ${j.hora}.`;
      $("ok-texto").innerHTML = "";
      $("ok-texto").append(
        `Te llegó una invitación de Google Calendar a ${d.correo} con el enlace de Google Meet. Si necesitas cambiar la hora, `,
        Object.assign(document.createElement("a"), { href: $("whatsapp").href, target: "_blank", rel: "noopener", textContent: "escríbenos por WhatsApp" }),
        ".",
      );
      irA(3);
    } else if (r.status === 409 || j.ocupada) {
      await cargarHorarios(j.error || "Esa hora se acaba de ocupar. Elige otra.");
    } else if (j.campos) {
      irA(1);
      $("msg1").className = "msg err";
      $("msg1").textContent = "Revisa los datos del formulario.";
    } else {
      m.className = "msg err"; m.textContent = j.error || MSG_ERROR;
    }
  } catch {
    m.className = "msg err"; m.textContent = MSG_ERROR;
  }
  btn.textContent = "Confirmar llamada";
  actualizarConfirmar();
});

// «← Volver» solo cambia de paso: lo escrito en el formulario se conserva.
$("volver").addEventListener("click", () => irA(1));

function irA(n) {
  [1, 2, 3].forEach((i) => { $("paso" + i).hidden = i !== n; });
  window.scrollTo({ top: 0, behavior: "auto" });
  const t = n === 1 ? $("nombre") : $("t" + n);
  t.focus({ preventScroll: true });
}
