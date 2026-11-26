// Llamadas a Google Calendar y Google Sheets. Solo se ejecutan en el servidor.
// Secretos (variables de entorno de Cloudflare): GOOGLE_NK_CLIENT_SECRET, GOOGLE_NK_REFRESH_TOKEN.
// Variables: GOOGLE_CLIENT_ID, AGENDA_CALENDARIOS, AGENDA_SHEET_ID, CREADORES_SHEET_ID.
// Permisos del token: calendar.events, calendar.freebusy y spreadsheets (sin acceso al resto del Drive).

let tokenEnCache = null; // { valor, vence }

async function accessToken(env) {
  if (tokenEnCache && tokenEnCache.vence > Date.now() + 60000) return tokenEnCache.valor;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_NK_CLIENT_SECRET,
      refresh_token: env.GOOGLE_NK_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`google token ${r.status}`);
  const j = await r.json();
  tokenEnCache = { valor: j.access_token, vence: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function llamar(env, url, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken(env)}`, 'content-type': 'application/json' },
  });
  if (!r.ok) {
    const error = new Error(`google ${r.status} ${await r.text().catch(() => '')}`.slice(0, 300));
    error.status = r.status;
    throw error;
  }
  return r.status === 204 ? null : r.json();
}

const CAL = 'https://www.googleapis.com/calendar/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

// Marca privada que llevan todos los eventos creados por /agenda.
// El borrado mensual solo toca eventos con esta marca.
export const MARCA_AGENDA = { clave: 'creadoPor', valor: 'northik-agenda' };

// ---------- Calendar ----------

// Horas ocupadas entre dos instantes, juntando varios calendarios: [{ start, end }]
export async function horasOcupadas(env, calendarios, desde, hasta) {
  if (env.GOOGLE_MOCK) return simulado.ocupados(desde, hasta);
  const ids = [].concat(calendarios);
  const j = await llamar(env, `${CAL}/freeBusy`, {
    method: 'POST',
    body: JSON.stringify({ timeMin: desde.toISOString(), timeMax: hasta.toISOString(), items: ids.map((id) => ({ id })) }),
  });
  const ocupados = [];
  for (const id of ids) {
    const cal = j.calendars?.[id];
    // Si Google no puede leer un calendario, mejor no ofrecer horas que podrían estar ocupadas.
    if (!cal || cal.errors?.length) throw new Error(`freebusy ${id === 'primary' ? 'primary' : 'calendario de citas'} ${JSON.stringify(cal?.errors || 'sin respuesta')}`);
    ocupados.push(...(cal.busy || []));
  }
  return ocupados;
}

export async function crearEvento(env, calendarioId, evento) {
  if (env.GOOGLE_MOCK) return simulado.crear(evento);
  const qs = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: 'all' });
  return llamar(env, `${CAL}/calendars/${encodeURIComponent(calendarioId)}/events?${qs}`, {
    method: 'POST',
    body: JSON.stringify(evento),
  });
}

// Un evento por su ID. Devuelve null si no existe.
export async function obtenerEvento(env, calendarioId, id) {
  if (env.GOOGLE_MOCK) return simulado.obtener(id);
  try {
    return await llamar(env, `${CAL}/calendars/${encodeURIComponent(calendarioId)}/events/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e.status === 404 || e.status === 410) return null;
    throw e;
  }
}

// Cambia la hora de un evento. Google le envía a la persona la invitación actualizada (mismo enlace de Meet).
export async function moverEvento(env, calendarioId, id, inicio, fin, zona) {
  if (env.GOOGLE_MOCK) return simulado.mover(id, inicio, fin);
  return llamar(env, `${CAL}/calendars/${encodeURIComponent(calendarioId)}/events/${encodeURIComponent(id)}?sendUpdates=all`, {
    method: 'PATCH',
    body: JSON.stringify({ start: { dateTime: inicio.toISOString(), timeZone: zona }, end: { dateTime: fin.toISOString(), timeZone: zona } }),
  });
}

// Cancela un evento a pedido de la persona. Google le envía el aviso de cancelación y la hora queda libre.
export async function cancelarEvento(env, calendarioId, id) {
  if (env.GOOGLE_MOCK) return simulado.cancelar(id);
  try {
    await llamar(env, `${CAL}/calendars/${encodeURIComponent(calendarioId)}/events/${encodeURIComponent(id)}?sendUpdates=all`, {
      method: 'DELETE',
    });
  } catch (e) {
    if (e.status !== 410) throw e; // 410: ya estaba cancelado
  }
}

// Eventos creados por /agenda que terminaron antes de `hasta`.
export async function eventosAgendaHasta(env, calendarioId, hasta) {
  if (env.GOOGLE_MOCK) return [];
  const eventos = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({
      privateExtendedProperty: `${MARCA_AGENDA.clave}=${MARCA_AGENDA.valor}`,
      timeMax: hasta.toISOString(),
      singleEvents: 'true',
      maxResults: '250',
      showDeleted: 'false',
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const j = await llamar(env, `${CAL}/calendars/${encodeURIComponent(calendarioId)}/events?${qs}`);
    for (const e of j.items || []) {
      const fin = Date.parse(e.end?.dateTime || e.end?.date);
      if (e.extendedProperties?.private?.[MARCA_AGENDA.clave] === MARCA_AGENDA.valor && fin < hasta.getTime()) eventos.push(e);
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return eventos;
}

export async function borrarEvento(env, calendarioId, id) {
  if (env.GOOGLE_MOCK) return;
  // Sin avisos: es limpieza de citas pasadas.
  await llamar(env, `${CAL}/calendars/${encodeURIComponent(calendarioId)}/events/${encodeURIComponent(id)}?sendUpdates=none`, {
    method: 'DELETE',
  });
}

// ---------- Sheets ----------

// ID interno (gid) de la pestaña, necesario para agregar y borrar filas.
const pestanas = new Map();
async function idPestana(env, hojaId, pestana) {
  const clave = `${hojaId}/${pestana}`;
  if (!pestanas.has(clave)) {
    const meta = await llamar(env, `${SHEETS}/${hojaId}?fields=sheets.properties(sheetId,title)`);
    const hoja = meta.sheets.find((s) => s.properties.title === pestana);
    if (!hoja) throw new Error(`no existe la pestaña ${pestana}`);
    pestanas.set(clave, hoja.properties.sheetId);
  }
  return pestanas.get(clave);
}

export async function agregarFila(env, hojaId, pestana, fila) {
  if (env.GOOGLE_MOCK) {
    if (env.GOOGLE_MOCK_FALLA_HOJA) throw new Error('simulado: la hoja no responde');
    simulado.hoja(hojaId, pestana).push(fila); return;
  }
  if (!hojaId) throw new Error('falta el ID de la hoja');
  const sheetId = await idPestana(env, hojaId, pestana);
  // Cada celda va como texto (nunca como fórmula) y sin negrita (no copia el formato de los títulos).
  await llamar(env, `${SHEETS}/${hojaId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ appendCells: {
      sheetId,
      rows: [{ values: fila.map((v) => ({
        userEnteredValue: { stringValue: String(v ?? '') },
        userEnteredFormat: { textFormat: { bold: false } },
      })) }],
      fields: 'userEnteredValue,userEnteredFormat.textFormat.bold',
    } }] }),
  });
}

const letraColumna = (i) => String.fromCharCode(65 + i); // 0 → A (alcanza hasta Z)

// Cambia celdas de una fila (posición 0 = primera fila de datos). `cambios`: { índiceDeColumna: texto }.
// RAW: el texto se guarda tal cual, nunca como fórmula.
export async function actualizarCeldas(env, hojaId, pestana, posicion, cambios) {
  if (env.GOOGLE_MOCK) {
    const fila = simulado.hoja(hojaId, pestana)[posicion];
    for (const [col, valor] of Object.entries(cambios)) fila[col] = valor;
    return;
  }
  const data = Object.entries(cambios).map(([col, valor]) => ({
    range: `${pestana}!${letraColumna(+col)}${posicion + 2}`, values: [[String(valor ?? '')]],
  }));
  await llamar(env, `${SHEETS}/${hojaId}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}

// Escribe un título en la primera fila (en negrita) si esa celda está vacía. Una vez por instancia.
const titulosRevisados = new Set();
export async function asegurarTitulo(env, hojaId, pestana, col, texto) {
  const clave = `${hojaId}/${pestana}/${col}`;
  if (env.GOOGLE_MOCK || titulosRevisados.has(clave)) return;
  const meta = await llamar(env, `${SHEETS}/${hojaId}?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`);
  const props = meta.sheets.find((x) => x.properties.title === pestana)?.properties;
  if (!props) throw new Error(`no existe la pestaña ${pestana}`);
  const columnas = props.gridProperties?.columnCount || 0;
  // Si la columna existe y ya tiene título, no hay nada que hacer. (Leer una columna que no existe da error.)
  let vacia = true;
  if (columnas > col) {
    const j = await llamar(env, `${SHEETS}/${hojaId}/values/${encodeURIComponent(`${pestana}!${letraColumna(col)}1`)}`);
    vacia = !j.values?.[0]?.[0];
  }
  if (vacia) {
    const requests = [];
    if (columnas <= col) requests.push({ appendDimension: { sheetId: props.sheetId, dimension: 'COLUMNS', length: col + 1 - columnas } });
    requests.push({ updateCells: {
      start: { sheetId: props.sheetId, rowIndex: 0, columnIndex: col },
      rows: [{ values: [{ userEnteredValue: { stringValue: texto }, userEnteredFormat: { textFormat: { bold: true } } }] }],
      fields: 'userEnteredValue,userEnteredFormat.textFormat.bold',
    } });
    await llamar(env, `${SHEETS}/${hojaId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
  }
  titulosRevisados.add(clave);
}

export async function leerFilas(env, hojaId, pestana, rango = 'A2:J') {
  if (env.GOOGLE_MOCK) return simulado.hoja(hojaId, pestana);
  const j = await llamar(env, `${SHEETS}/${hojaId}/values/${encodeURIComponent(`${pestana}!${rango}`)}`);
  return j.values || [];
}

// Borra filas por posición (0 = primera fila de datos, debajo de los títulos).
export async function borrarFilas(env, hojaId, pestana, posiciones) {
  if (!posiciones.length) return;
  if (env.GOOGLE_MOCK) {
    const clave = `${hojaId}/${pestana}`;
    simulado.hojas[clave] = simulado.hoja(hojaId, pestana).filter((_, i) => !posiciones.includes(i)); return;
  }
  const sheetId = await idPestana(env, hojaId, pestana);
  // De abajo hacia arriba para que las posiciones no se corran.
  const requests = [...posiciones].sort((a, b) => b - a).map((i) => ({
    deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } },
  }));
  await llamar(env, `${SHEETS}/${hojaId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
}

// Crea una hoja privada (no se comparte con nadie) con una pestaña y sus títulos en negrita. Devuelve su ID.
export async function crearHoja(env, titulo, pestana, columnas) {
  if (env.GOOGLE_MOCK) return 'hoja-simulada';
  const j = await llamar(env, SHEETS, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: titulo, locale: 'es_CO', timeZone: 'America/Bogota' },
      sheets: [{
        properties: { title: pestana, gridProperties: { frozenRowCount: 1, columnCount: columnas.length } },
        data: [{ startRow: 0, startColumn: 0, rowData: [{ values: columnas.map((c) => ({
          userEnteredValue: { stringValue: c }, userEnteredFormat: { textFormat: { bold: true } },
        })) }] }],
      }],
    }),
  });
  return j.spreadsheetId;
}

// ---------- Modo de prueba local (GOOGLE_MOCK=1): no toca Google ----------
const simulado = {
  creados: [],
  hojas: {}, // filas por hoja y pestaña: { 'id/pestaña': [[...], ...] }
  hoja(hojaId, pestana) { return (this.hojas[`${hojaId}/${pestana}`] ||= []); },
  // Simula que otras personas ya tomaron las 9:30 y 3:30 de los días impares.
  ocupados(desde, hasta) {
    const extra = [];
    for (let t = new Date(desde).setUTCHours(0, 0, 0, 0); t <= hasta.getTime(); t += 86400000) {
      if (new Date(t).getUTCDate() % 2 === 0) continue;
      for (const h of [14.5, 20.5]) {
        const ini = t + h * 3600000;
        extra.push({ start: new Date(ini).toISOString(), end: new Date(ini + 20 * 60000).toISOString() });
      }
    }
    const propios = this.creados.filter((e) => e.status !== 'cancelled').map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }));
    return [...propios, ...extra];
  },
  crear(evento) {
    const ev = { ...evento, id: evento.id || 'simulado' + this.creados.length, status: 'confirmed', hangoutLink: 'https://meet.google.com/xxx-xxxx-xxx' };
    this.creados.push(ev);
    return ev;
  },
  obtener(id) { return this.creados.find((e) => e.id === id) || null; },
  mover(id, inicio, fin) {
    const ev = this.obtener(id);
    ev.start = { dateTime: inicio.toISOString() }; ev.end = { dateTime: fin.toISOString() };
    return ev;
  },
  cancelar(id) { const ev = this.obtener(id); if (ev) ev.status = 'cancelled'; },
  // Solo para probar en el computador: crea una cita que ya pasó.
  crearPasada(evento) {
    const ini = new Date(Date.now() - 86400000);
    return this.crear({ ...evento, start: { dateTime: ini.toISOString() }, end: { dateTime: new Date(ini.getTime() + 1200000).toISOString() } });
  },
};
export const _simulado = simulado;
