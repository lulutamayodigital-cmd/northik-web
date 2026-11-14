// Llamadas a Google Calendar y Google Sheets. Solo se ejecutan en el servidor.
// Secretos (variables de entorno de Cloudflare): GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
// Variables: GOOGLE_CLIENT_ID, AGENDA_SHEET_ID.
// Permisos del token: calendar.events, calendar.freebusy y spreadsheets (sin acceso al resto del Drive).

let tokenEnCache = null; // { valor, vence }

async function accessToken(env) {
  if (tokenEnCache && tokenEnCache.vence > Date.now() + 60000) return tokenEnCache.valor;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
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
  if (!r.ok) throw new Error(`google ${r.status} ${await r.text().catch(() => '')}`.slice(0, 300));
  return r.status === 204 ? null : r.json();
}

const CAL = 'https://www.googleapis.com/calendar/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

// Marca privada que llevan todos los eventos creados por /agenda.
// El borrado mensual solo toca eventos con esta marca.
export const MARCA_AGENDA = { clave: 'creadoPor', valor: 'northik-agenda' };

// ---------- Calendar ----------

// Horas ocupadas entre dos instantes: [{ start, end }]
export async function horasOcupadas(env, calendarioId, desde, hasta) {
  if (env.GOOGLE_MOCK) return simulado.ocupados(desde, hasta);
  const j = await llamar(env, `${CAL}/freeBusy`, {
    method: 'POST',
    body: JSON.stringify({ timeMin: desde.toISOString(), timeMax: hasta.toISOString(), items: [{ id: calendarioId }] }),
  });
  const cal = j.calendars?.[calendarioId];
  if (cal?.errors?.length) throw new Error(`freebusy ${JSON.stringify(cal.errors)}`);
  return cal?.busy || [];
}

export async function crearEvento(env, calendarioId, evento) {
  if (env.GOOGLE_MOCK) return simulado.crear(evento);
  const qs = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: 'all' });
  return llamar(env, `${CAL}/calendars/${encodeURIComponent(calendarioId)}/events?${qs}`, {
    method: 'POST',
    body: JSON.stringify(evento),
  });
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
  if (env.GOOGLE_MOCK) { simulado.filas.push(fila); return; }
  if (!hojaId) throw new Error('falta AGENDA_SHEET_ID');
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

export async function leerFilas(env, hojaId, pestana) {
  if (env.GOOGLE_MOCK) return simulado.filas;
  const j = await llamar(env, `${SHEETS}/${hojaId}/values/${encodeURIComponent(`${pestana}!A2:J`)}`);
  return j.values || [];
}

// Borra filas por posición (0 = primera fila de datos, debajo de los títulos).
export async function borrarFilas(env, hojaId, pestana, posiciones) {
  if (!posiciones.length) return;
  if (env.GOOGLE_MOCK) { simulado.filas = simulado.filas.filter((_, i) => !posiciones.includes(i)); return; }
  const sheetId = await idPestana(env, hojaId, pestana);
  // De abajo hacia arriba para que las posiciones no se corran.
  const requests = [...posiciones].sort((a, b) => b - a).map((i) => ({
    deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } },
  }));
  await llamar(env, `${SHEETS}/${hojaId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
}

// ---------- Modo de prueba local (GOOGLE_MOCK=1): no toca Google ----------
const simulado = {
  creados: [],
  filas: [],
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
    return [...this.creados, ...extra];
  },
  crear(evento) {
    this.creados.push({ start: evento.start.dateTime, end: evento.end.dateTime });
    return { id: 'simulado-' + this.creados.length, hangoutLink: 'https://meet.google.com/xxx-xxxx-xxx' };
  },
};
export const _simulado = simulado;
