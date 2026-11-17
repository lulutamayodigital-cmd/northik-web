// Registro de creadores · northik.ai/creadores/
// Paso 1: formulario · Paso 2: registro listo y resumen del perfil.
// El registro se envía a /api/creadores (worker). El resumen se calcula aquí, solo con las cifras escritas.
import { PAISES } from "../agenda/paises.js";
import { NICHOS, TARIFAS, PANTALLAZOS, RANGO_ER } from "./config.js";
import { resumen } from "./resumen.js";

const $ = (id) => document.getElementById(id);
const MSG_ERROR = "No pudimos enviar tu registro. Revisa tu conexión e intenta de nuevo, o escríbenos a hola@northik.ai.";

// Origen: ?origen=match, ?origen=instagram… Si no viene, «web».
const origenUrl = new URLSearchParams(location.search).get("origen") || "";
const origen = /^[a-zA-Z0-9_-]{1,40}$/.test(origenUrl) ? origenUrl.toLowerCase() : "web";

const opciones = (lista) => lista.map((o) => `<option>${o}</option>`).join("");
$("nicho").insertAdjacentHTML("beforeend", opciones(NICHOS));
$("tarifa").insertAdjacentHTML("beforeend", opciones(TARIFAS));
$("pais").innerHTML = PAISES.map((p) => `<option value="${p.codigo}">${p.codigo} +${p.prefijo}</option>`).join("");
$("pais").value = "CO";

// ---------- Usuarios y cifras ----------
const usuario = (v) => String(v || "").trim().replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\/@?/i, "").replace(/^@+/, "").replace(/[/?#].*$/, "");
const cifra = (v) => { const n = String(v || "").replace(/\D/g, ""); return n ? Number(n) : 0; };
for (const id of ["seguidores", "vistas", "interacciones"]) {
  $(id).addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^\d]/g, ""); });
}

// ---------- Pantallazos ----------
let archivos = [];
$("pantallazos").addEventListener("change", (e) => {
  const m = $("msg");
  m.className = "msg"; m.textContent = "";
  for (const f of e.target.files) {
    if (archivos.length >= PANTALLAZOS.maximo) { avisar(`Puedes subir hasta ${PANTALLAZOS.maximo} pantallazos.`); break; }
    if (!PANTALLAZOS.tipos.includes(f.type)) { avisar(`«${f.name}» no es una imagen JPG, PNG o WEBP.`); continue; }
    if (f.size > PANTALLAZOS.maxBytes) { avisar(`«${f.name}» pesa más de 5 MB.`); continue; }
    archivos.push(f);
  }
  e.target.value = "";
  pintarArchivos();
});
function pintarArchivos() {
  const ul = $("archivos");
  ul.innerHTML = "";
  archivos.forEach((f, i) => {
    const li = document.createElement("li");
    const img = document.createElement("img");
    img.alt = "";
    const lector = new FileReader();
    lector.onload = () => { img.src = lector.result; };
    lector.readAsDataURL(f);
    const n = Object.assign(document.createElement("span"), { className: "n", textContent: f.name });
    const quitar = Object.assign(document.createElement("button"), { type: "button", textContent: "Quitar" });
    quitar.setAttribute("aria-label", `Quitar ${f.name}`);
    quitar.addEventListener("click", () => { archivos.splice(i, 1); pintarArchivos(); });
    li.append(img, n, quitar);
    ul.append(li);
  });
}
function avisar(t) { const m = $("msg"); m.className = "msg err"; m.textContent = t; }

// ---------- Envío ----------
function leer() {
  const d = new FormData($("formulario"));
  return {
    nombre: (d.get("nombre") || "").trim(),
    instagram: usuario(d.get("instagram")),
    tiktok: usuario(d.get("tiktok")),
    ciudad: (d.get("ciudad") || "").trim(),
    nicho: d.get("nicho") || "",
    tarifa: d.get("tarifa") || "",
    correo: (d.get("correo") || "").trim(),
    pais: d.get("pais"),
    telefono: (d.get("telefono") || "").replace(/\D/g, ""),
    red_cifras: d.get("red_cifras") || "Instagram",
    seguidores: cifra(d.get("seguidores")),
    vistas: cifra(d.get("vistas")),
    interacciones: cifra(d.get("interacciones")),
    mayor_edad: $("mayor_edad").checked,
    autorizo: $("autorizo").checked,
    sitio_web: d.get("sitio_web") || "",
    origen,
  };
}

$("formulario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = leer();
  const falta = [];
  if (d.nombre.length < 2) falta.push("tu nombre");
  if (!d.instagram && !d.tiktok) falta.push("tu usuario de Instagram o TikTok");
  if (d.ciudad.length < 2) falta.push("tu ciudad");
  if (!d.nicho) falta.push("tu nicho");
  if (!d.tarifa) falta.push("tu rango de tarifa");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.correo)) falta.push("un correo válido");
  if (d.telefono.length < 6) falta.push("tu WhatsApp");
  if (!d.seguidores) falta.push("tus seguidores");
  if (!d.vistas) falta.push("tu promedio de vistas por reel o video");
  if (!d.interacciones) falta.push("tu promedio de interacciones por publicación");
  if (!archivos.length) falta.push("al menos un pantallazo de tu audiencia");
  if (!d.mayor_edad) falta.push("confirmar que eres mayor de 18 años");
  if (!d.autorizo) falta.push("autorizar el tratamiento de tus datos");
  if (falta.length) { avisar("Te falta: " + falta.join(", ") + "."); return; }
  if (d.interacciones > d.seguidores) {
    avisar("Tus interacciones por publicación no pueden ser más que tus seguidores. Revisa las cifras."); return;
  }

  const btn = $("enviar");
  btn.disabled = true; btn.textContent = "Enviando…";
  $("msg").className = "msg"; $("msg").textContent = "";
  const cuerpo = new FormData();
  cuerpo.append("datos", JSON.stringify(d));
  archivos.forEach((f) => cuerpo.append("pantallazos", f, f.name));
  try {
    const r = await fetch("/api/creadores", { method: "POST", body: cuerpo });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) mostrarResumen(d);
    else avisar(j.error || MSG_ERROR);
  } catch {
    avisar(MSG_ERROR);
  }
  btn.disabled = false; btn.textContent = "Registrarme gratis";
});

// ---------- Resumen ----------
const fmt = (n) => n.toLocaleString("es-CO");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function mostrarResumen(d) {
  const r = resumen({ ...d, pantallazos: archivos.length });
  const primerNombre = d.nombre.split(/\s+/)[0];
  $("t2").textContent = `Gracias, ${primerNombre}. Tu registro quedó listo.`;
  $("r-red").textContent = r.conCifras ? d.red_cifras : "";
  const partes = [];

  if (r.tasa) {
    const t = r.tasa;
    const [lo, hi] = RANGO_ER[t.tamano];
    // Escala de 0 a 2 veces el techo típico; el punto se queda en el borde si se pasa.
    const tope = hi * 2;
    const x = (v) => Math.min(100, (v / tope) * 100);
    partes.push(`
     <div class="bloque">
      <span class="etq mono">Tasa de interacción</span>
      <div class="cifra"><b>${t.texto}</b><small>${fmt(d.interacciones)} interacciones ÷ ${fmt(d.seguidores)} seguidores</small></div>
      ${t.veredicto ? `<span class="ver" data-nivel="${t.veredicto.nivel}"><i aria-hidden="true"></i>${esc(t.veredicto.texto)}</span>` : ""}
      <div class="escala" aria-hidden="true">
       <span class="riel"></span>
       <span class="tipico" style="left:${x(lo)}%;width:${x(hi) - x(lo)}%"></span>
       <span class="yo" style="left:${x(t.valor)}%"></span>
      </div>
      <div class="escala-txt mono" aria-hidden="true"><span>0 %</span><span>Típico para un ${t.tamano}</span><span>${fmtPct(tope)}</span></div>
      <p class="texto">De cada 100 personas que te siguen, cuántas dan me gusta o comentan una publicación típica.</p>
     </div>`);
    $("r-fuente").textContent = " Los rangos típicos por tamaño son aproximados, de reportes de la industria: úsalos como orientación, no como regla.";
  } else if (r.tamano) {
    partes.push(`
     <div class="bloque">
      <span class="etq mono">Tamaño de tu cuenta</span>
      <div class="cifra"><b>${r.tamano}</b><small>${fmt(r.seguidores)} seguidores</small></div>
      <p class="texto">Para calcular tu tasa de interacción, nos falta tu promedio de interacciones por publicación.</p>
     </div>`);
  }

  if (r.alcance) {
    partes.push(`
     <div class="bloque">
      <span class="etq mono">Vistas frente a seguidores</span>
      <div class="cifra"><b>${r.alcance.texto}</b><small>${fmt(d.vistas)} vistas ÷ ${fmt(d.seguidores)} seguidores</small></div>
      <p class="texto">${r.alcance.lectura}</p>
     </div>`);
  }

  const c = r.completo;
  partes.push(`
   <div class="bloque">
    <span class="etq mono">Qué tan completo quedó tu perfil</span>
    <div class="cifra"><b>${c.porcentaje} %</b></div>
    <div class="avance" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.porcentaje}" aria-label="Perfil completo"><i style="width:${c.porcentaje}%"></i></div>
    ${c.faltan.length
      ? `<p class="texto">Para completarlo, puedes enviarnos:</p><ul class="faltan">${c.faltan.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`
      : `<p class="texto">Tu perfil quedó completo: incluye tus cifras y ${archivos.length === 1 ? "1 pantallazo" : archivos.length + " pantallazos"} de tu audiencia.</p>`}
   </div>`);

  $("r-cuerpo").innerHTML = partes.join("");
  $("paso1").hidden = true;
  $("paso2").hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
  $("t2").focus({ preventScroll: true });
}
const fmtPct = (v) => `${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;
