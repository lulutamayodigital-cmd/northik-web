// Genera las horas posibles según CONFIG y las cruza con las horas ocupadas de Google.
import { esFestivo } from './festivos.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const pad = (n) => String(n).padStart(2, '0');

// Partes de la fecha local en la zona horaria indicada.
function partesLocales(instante, zona) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  return { a: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

// Convierte una hora local (fecha + 'HH:MM') a un instante UTC.
export function localAInstante(fechaIso, hhmm, zona) {
  const [a, m, d] = fechaIso.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const supuesto = Date.UTC(a, m - 1, d, h, min);
  const p = partesLocales(new Date(supuesto), zona);
  const offset = Date.UTC(p.a, p.m - 1, p.d, p.h, p.min, p.s) - supuesto;
  return new Date(supuesto - offset);
}

const sumarMin = (hhmm, n) => {
  const t = +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) + n;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

// Todas las citas que permiten las reglas (sin mirar el calendario).
export function citasPosibles(config, ahora = new Date()) {
  const desde = ahora.getTime() + config.anticipacionMinHoras * 3600000;
  const hasta = ahora.getTime() + config.anticipacionMaxDias * 86400000;
  const hoy = partesLocales(ahora, config.zonaHoraria);
  const citas = [];
  for (let i = 0; i <= config.anticipacionMaxDias + 1; i++) {
    const dia = new Date(Date.UTC(hoy.a, hoy.m - 1, hoy.d + i));
    const fechaIso = `${dia.getUTCFullYear()}-${pad(dia.getUTCMonth() + 1)}-${pad(dia.getUTCDate())}`;
    if (config.sinCitasEnFestivosDeColombia && esFestivo(fechaIso)) continue;
    const franjas = config.franjas[DIAS[dia.getUTCDay()]] || [];
    for (const { desde: ini, hasta: fin } of franjas) {
      for (let h = ini; sumarMin(h, config.duracionMin) <= fin; h = sumarMin(h, config.duracionMin + config.pausaMin)) {
        const inicio = localAInstante(fechaIso, h, config.zonaHoraria);
        const final = new Date(inicio.getTime() + config.duracionMin * 60000);
        if (inicio.getTime() < desde || inicio.getTime() > hasta) continue;
        citas.push({ fecha: fechaIso, hora: h, inicio, fin: final });
      }
    }
  }
  return citas;
}

export const seCruza = (cita, ocupados) =>
  ocupados.some((o) => new Date(o.start) < cita.fin && new Date(o.end) > cita.inicio);

// Agrupa por día. Solo incluye días con al menos una hora libre.
export function agruparPorDia(citas, ocupados) {
  const dias = new Map();
  for (const c of citas) {
    if (!dias.has(c.fecha)) dias.set(c.fecha, []);
    dias.get(c.fecha).push({ hora: c.hora, inicio: c.inicio.toISOString(), ocupada: seCruza(c, ocupados) });
  }
  return [...dias]
    .filter(([, horas]) => horas.some((h) => !h.ocupada))
    .map(([fecha, horas]) => ({ fecha, horas }));
}
