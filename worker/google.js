// Llamadas a Google Calendar. Solo se ejecutan en el servidor.
// Secretos (variables de entorno de Cloudflare): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.

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
  return r.json();
}

const API = 'https://www.googleapis.com/calendar/v3';

// Horas ocupadas entre dos instantes: [{ start, end }]
export async function horasOcupadas(env, calendarioId, desde, hasta) {
  if (env.GOOGLE_MOCK) return simulado.ocupados(desde, hasta);
  const j = await llamar(env, `${API}/freeBusy`, {
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
  return llamar(env, `${API}/calendars/${encodeURIComponent(calendarioId)}/events?${qs}`, {
    method: 'POST',
    body: JSON.stringify(evento),
  });
}

// Modo de prueba local (GOOGLE_MOCK=1): no toca Google.
// `extra` permite simular citas ocupadas por otras personas.
const simulado = {
  creados: [],
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
