// Selector de día y hora de la agenda. Lo usan /agenda/ (reservar) y /agenda/cita/ (cambiar la hora).
// Pide los horarios a /api/agenda/horarios; las horas ocupadas salen tachadas.

export const fmtDia = (fecha, op) => new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", ...op }).format(new Date(fecha + "T12:00:00Z"));

export function fmtHora(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  const p = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${p}`;
}

// `contenedor`: elemento donde se pinta. `alElegir(inicio | null)`: se llama cada vez que cambia la hora elegida.
export function crearSelector(contenedor, alElegir) {
  let dias = [];
  let diaSel = null;
  let horaSel = null;

  const elegir = (inicio) => { horaSel = inicio; alElegir(inicio); };

  function pintar() {
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
    contenedor.innerHTML = `
    <div class="dias" role="group" aria-label="Días disponibles">${chips}</div>
    <div class="panel" style="gap:12px;margin-top:14px">
      <p class="dia-sel">${fmtDia(diaSel, { weekday: "long", day: "numeric", month: "long" })}</p>
      <div class="horas" role="group" aria-label="Horas">${horas}</div>
      <p class="nota">Horas en hora de Colombia (GMT-5).</p>
    </div>`;
    const activo = contenedor.querySelector('.chip[aria-pressed="true"]');
    if (activo) activo.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  contenedor.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) { diaSel = chip.dataset.fecha; elegir(null); pintar(); return; }
    const hora = e.target.closest(".hora:not(.ocupada)");
    if (hora) {
      contenedor.querySelectorAll(".hora").forEach((b) => b.setAttribute("aria-pressed", String(b === hora)));
      elegir(hora.dataset.inicio);
    }
  });

  // Carga los horarios y los pinta. Devuelve cuántos días hay. Lanza un error si no se pudieron cargar.
  async function cargar() {
    contenedor.innerHTML = '<div class="cargando" aria-label="Cargando horarios"><i></i><i></i><i></i><i></i></div>';
    elegir(null);
    let j;
    try {
      const r = await fetch("/api/agenda/horarios", { headers: { accept: "application/json" } });
      j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error);
    } catch (e) {
      contenedor.innerHTML = "";
      throw e;
    }
    dias = j.dias;
    if (!dias.length) { contenedor.innerHTML = ""; return 0; }
    if (!dias.some((d) => d.fecha === diaSel)) diaSel = dias[0].fecha;
    pintar();
    return dias.length;
  }

  return { cargar, get hora() { return horaSel; } };
}
