// Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani"). Se calculan para cualquier año.
// Devuelve fechas 'AAAA-MM-DD'.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fecha = (a, m, d) => new Date(Date.UTC(a, m - 1, d));
const mas = (d, dias) => new Date(d.getTime() + dias * 86400000);
// Si no cae lunes, pasa al lunes siguiente.
const alLunes = (d) => mas(d, (8 - d.getUTCDay()) % 7);

// Domingo de Pascua (algoritmo anónimo gregoriano).
function pascua(a) {
  const A = a % 19, B = Math.floor(a / 100), C = a % 100;
  const D = Math.floor(B / 4), E = B % 4, F = Math.floor((B + 8) / 25);
  const G = Math.floor((B - F + 1) / 3), H = (19 * A + B - D - G + 15) % 30;
  const I = Math.floor(C / 4), K = C % 4, L = (32 + 2 * E + 2 * I - H - K) % 7;
  const M = Math.floor((A + 11 * H + 22 * L) / 451);
  const mes = Math.floor((H + L - 7 * M + 114) / 31), dia = ((H + L - 7 * M + 114) % 31) + 1;
  return fecha(a, mes, dia);
}

const cache = new Map();

export function festivosDeColombia(a) {
  if (cache.has(a)) return cache.get(a);
  const p = pascua(a);
  const lista = [
    fecha(a, 1, 1), // Año Nuevo
    alLunes(fecha(a, 1, 6)), // Reyes Magos
    alLunes(fecha(a, 3, 19)), // San José
    mas(p, -3), // Jueves Santo
    mas(p, -2), // Viernes Santo
    fecha(a, 5, 1), // Día del Trabajo
    alLunes(mas(p, 39)), // Ascensión
    alLunes(mas(p, 60)), // Corpus Christi
    alLunes(mas(p, 68)), // Sagrado Corazón
    alLunes(fecha(a, 6, 29)), // San Pedro y San Pablo
    fecha(a, 7, 20), // Independencia
    fecha(a, 8, 7), // Batalla de Boyacá
    alLunes(fecha(a, 8, 15)), // Asunción
    alLunes(fecha(a, 10, 12)), // Día de la Raza
    alLunes(fecha(a, 11, 1)), // Todos los Santos
    alLunes(fecha(a, 11, 11)), // Independencia de Cartagena
    fecha(a, 12, 8), // Inmaculada Concepción
    fecha(a, 12, 25), // Navidad
  ];
  const set = new Set(lista.map(iso));
  cache.set(a, set);
  return set;
}

export const esFestivo = (fechaIso) => festivosDeColombia(Number(fechaIso.slice(0, 4))).has(fechaIso);
