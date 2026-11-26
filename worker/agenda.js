// Agenda de llamadas de 20 minutos (/api/agenda/*).
// - GET  /api/agenda/horarios: días y horas según worker/agenda-config.js, cruzados con freebusy de Google.
// - POST /api/agenda/reservar: valida, vuelve a revisar que la hora siga libre y crea el evento con Google Meet.
//   Además agrega una fila a la hoja privada «Northik · Agenda» (pestaña «Citas»). Si la hoja falla,
//   la cita igual queda creada y llega un aviso por correo.
// - POST /api/agenda/cita: ver, cambiar o cancelar una cita con el enlace firmado (worker/enlace-cita.js).
//   Cambiar mueve el mismo evento (mismo enlace de Meet); cancelar lo borra con aviso a la persona.
//   La fila de la hoja se actualiza (columna «Estado») y llega un aviso por correo.
// - borrarAgendaVencida: borrado mensual (cron) de filas y eventos de /agenda con más de 24 meses.
// Las citas NO se guardan en D1.
import { CONFIG, OBJETIVOS } from "./agenda-config.js";
import { citasPosibles, agruparPorDia, seCruza } from "./horarios.js";
import { horasOcupadas, crearEvento, agregarFila, leerFilas, borrarFilas, eventosAgendaHasta, borrarEvento, MARCA_AGENDA,
  obtenerEvento, moverEvento, cancelarEvento, actualizarCeldas, asegurarTitulo } from "./google.js";
import { nuevoIdEvento, hayFirma, enlaceCita, verificar } from "./enlace-cita.js";
import { avisoInterno } from "./aviso.js";
import { PAISES } from "../agenda/paises.js";


// Calendarios (AGENDA_CALENDARIOS en wrangler.jsonc, separados por coma): el primero recibe las citas;
// las horas ocupadas se revisan en todos.
const calendarios = (env) => String(env.AGENDA_CALENDARIOS || "primary").split(",").map((c) => c.trim()).filter(Boolean);
const calendarioCitas = (env) => calendarios(env)[0];
const WHATSAPP_PREGUNTAS = "https://wa.me/573054670254";

const MSG_OCUPADA = "Esa hora se acaba de ocupar. Elige otra.";
const MSG_ERROR = "No pudimos agendar la llamada. Intenta de nuevo o escríbenos por WhatsApp.";
const MSG_CITA_ERROR = "No pudimos guardar el cambio. Intenta de nuevo o escríbenos por WhatsApp.";
const MSG_LIMITE = "Recibimos varios intentos seguidos. Espera un minuto e intenta de nuevo.";
const COL = { fecha: 1, hora: 2, idEvento: 9, estado: 10 };
const CAMPOS = new Set(["nombre", "correo", "pais", "telefono", "objetivo", "detalle", "autorizo", "inicio", "origen", "sitio_web"]);

// ---------- Validación ----------
const limpiar = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

export function validar(body) {
  const errores = [];
  if (Object.keys(body).some((k) => !CAMPOS.has(k))) errores.push("campos");
  const nombre = limpiar(body.nombre, 80);
  const correo = limpiar(body.correo, 160).toLowerCase();
  const pais = PAISES.find((p) => p.codigo === body.pais);
  const numero = String(body.telefono ?? "").replace(/\D/g, "");
  const objetivo = OBJETIVOS.includes(body.objetivo) ? body.objetivo : "";
  const detalleBruto = typeof body.detalle === "string" ? body.detalle.trim() : "";
  const detalle = limpiar(detalleBruto, 300);
  const origen = typeof body.origen === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(body.origen) ? body.origen.toLowerCase() : "web";

  if (nombre.length < 2) errores.push("nombre");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) errores.push("correo");
  if (!pais || numero.length < 6 || (pais.prefijo + numero).length > 15) errores.push("telefono");
  if (!objetivo) errores.push("objetivo");
  if (detalleBruto.length > 300) errores.push("detalle");
  if (body.autorizo !== true) errores.push("autorizo");
  if (typeof body.inicio !== "string" || Number.isNaN(Date.parse(body.inicio))) errores.push("inicio");

  return {
    errores,
    datos: { nombre, correo, whatsapp: `+${pais?.prefijo ?? ""} ${numero}`, objetivo, detalle, origen, inicio: body.inicio },
  };
}

// «martes 17 de noviembre» y «9:00 am», en hora de Colombia.
export function etiquetaFecha(instante) {
  const z = CONFIG.zonaHoraria;
  const dia = new Intl.DateTimeFormat("es-CO", { timeZone: z, weekday: "long", day: "numeric", month: "long" }).format(instante);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(instante).map((x) => [x.type, x.value]),
  );
  return { dia: dia.replace(",", ""), hora: `${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}` };
}

// «2026-11-13 22:45» en hora de Colombia.
function fechaHoraBogota(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.zonaHoraria, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

async function registrarEnHoja(env, fila) {
  // El título «Estado» nunca impide guardar la fila.
  await asegurarTitulo(env, env.AGENDA_SHEET_ID, CONFIG.hoja.pestana, COL.estado, CONFIG.hoja.columnas[COL.estado])
    .catch((e) => console.error("No se pudo escribir el título Estado:", (e && e.stack) || e));
  try {
    await agregarFila(env, env.AGENDA_SHEET_ID, CONFIG.hoja.pestana, fila);
  } catch (e) {
    console.error("No se pudo escribir en la hoja de la agenda:", (e && e.stack) || e);
    try {
      await avisoInterno(env, `Agenda: no se guardó en la hoja la cita de ${fila[3]}`, [
        "La cita SÍ quedó creada en Google Calendar, pero no se pudo agregar la fila a la hoja «Northik · Agenda».",
        "Agrégala a mano en la pestaña «Citas»:", "",
        ...CONFIG.hoja.columnas.map((c, i) => `${c}: ${fila[i] || "—"}`), "",
        "Error: " + String((e && e.message) || e).slice(0, 300),
      ]);
    } catch (e2) {
      console.error("Tampoco se pudo enviar el aviso:", (e2 && e2.stack) || e2);
    }
  }
}

// ---------- Borrado mensual (cron del día 1) ----------
// Borra las filas de la hoja y los eventos creados por /agenda cuya cita fue hace más de 24 meses.
export async function borrarAgendaVencida(env, ahora = new Date()) {
  const limite = new Date(ahora);
  limite.setUTCMonth(limite.getUTCMonth() - CONFIG.conservacionMeses);
  const limiteFecha = limite.toISOString().slice(0, 10);
  const resumen = { filas: 0, eventos: 0, errores: [] };

  try {
    const filas = await leerFilas(env, env.AGENDA_SHEET_ID, CONFIG.hoja.pestana);
    const viejas = filas.map((f, i) => (/^\d{4}-\d{2}-\d{2}$/.test(f[1] || "") && f[1] < limiteFecha ? i : -1)).filter((i) => i >= 0);
    await borrarFilas(env, env.AGENDA_SHEET_ID, CONFIG.hoja.pestana, viejas);
    resumen.filas = viejas.length;
  } catch (e) {
    resumen.errores.push("hoja: " + String((e && e.message) || e).slice(0, 300));
  }

  try {
    const eventos = await eventosAgendaHasta(env, calendarioCitas(env), limite);
    for (const ev of eventos) { await borrarEvento(env, calendarioCitas(env), ev.id); resumen.eventos++; }
  } catch (e) {
    resumen.errores.push("calendario: " + String((e && e.message) || e).slice(0, 300));
  }

  console.log("Borrado mensual de la agenda:", JSON.stringify(resumen));
  if (resumen.errores.length) {
    await avisoInterno(env, "Agenda: falló el borrado mensual", [
      `Límite: citas anteriores a ${limiteFecha}.`, `Filas borradas: ${resumen.filas}. Eventos borrados: ${resumen.eventos}.`, "",
      ...resumen.errores,
    ]).catch((e) => console.error("No se pudo enviar el aviso:", e));
  }
  return resumen;
}

// ---------- Rutas ----------
async function _horarios(env, json) {
  const posibles = citasPosibles(CONFIG);
  if (!posibles.length) return json({ ok: true, dias: [] });
  const ocupados = await horasOcupadas(env, calendarios(env), posibles[0].inicio, posibles.at(-1).fin);
  return json({ ok: true, dias: agruparPorDia(posibles, ocupados) });
}

// Mismo límite de envíos del formulario de contacto (5 por minuto por dirección).
async function dentroDelLimite(request, env) {
  if (!env.LIMITE_FORMULARIO) return true;
  const clave = request.headers.get("cf-connecting-ip") || "sin-ip";
  const { success } = await env.LIMITE_FORMULARIO.limit({ key: clave });
  return success;
}

async function _reservar(request, env, ctx, json) {
  if (!(await dentroDelLimite(request, env))) return json({ ok: false, error: MSG_LIMITE }, 429);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ ok: false, error: MSG_ERROR }, 415);
  const texto = await request.text();
  if (texto.length > 5000) return json({ ok: false, error: MSG_ERROR }, 413);
  let body;
  try { body = JSON.parse(texto); } catch { return json({ ok: false, error: MSG_ERROR }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: MSG_ERROR }, 400);

  // Campo trampa: si viene lleno es un robot. Responde como si todo saliera bien y no crea nada.
  if (body.sitio_web) {
    const t = Date.parse(body.inicio);
    return json({ ok: true, ...etiquetaFecha(new Date(Number.isNaN(t) ? Date.now() : t)) });
  }

  const { errores, datos } = validar(body);
  if (errores.length) return json({ ok: false, campos: errores, error: "Revisa los datos del formulario." }, 400);

  // La hora tiene que existir según las reglas…
  const cita = citasPosibles(CONFIG).find((c) => c.inicio.getTime() === Date.parse(datos.inicio));
  if (!cita) return json({ ok: false, ocupada: true, error: MSG_OCUPADA }, 409);

  // …y seguir libre en el calendario justo ahora.
  const ocupados = await horasOcupadas(env, calendarios(env), cita.inicio, cita.fin);
  if (seCruza(cita, ocupados)) return json({ ok: false, ocupada: true, error: MSG_OCUPADA }, 409);

  // ID propio del evento: así el enlace para cambiar o cancelar va desde el principio en la invitación.
  // Si todavía no existe el secreto AGENDA_FIRMA, la cita se crea igual, sin enlace.
  const idEvento = nuevoIdEvento();
  const enlace = hayFirma(env) ? await enlaceCita(env, new URL(request.url).origin, idEvento) : "";
  const evento = await crearEvento(env, calendarioCitas(env), {
    id: idEvento,
    summary: `Llamada Northik · ${datos.nombre}`,
    description: [
      ...(enlace ? [`Para cambiar la hora o cancelar: ${enlace}`] : []),
      `¿Preguntas antes de la llamada? Escríbenos a hola@northik.ai o por WhatsApp: ${WHATSAPP_PREGUNTAS}`,
      "",
      `WhatsApp: ${datos.whatsapp}`,
      `Qué quiere lograr: ${datos.objetivo}`,
      `Más detalles: ${datos.detalle || "—"}`,
      `Origen: ${datos.origen}`,
    ].join("\n"),
    start: { dateTime: cita.inicio.toISOString(), timeZone: CONFIG.zonaHoraria },
    end: { dateTime: cita.fin.toISOString(), timeZone: CONFIG.zonaHoraria },
    attendees: [{ email: datos.correo, displayName: datos.nombre }],
    conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    reminders: { useDefault: true },
    extendedProperties: { private: { [MARCA_AGENDA.clave]: MARCA_AGENDA.valor } },
  });

  // La hoja nunca bloquea la reserva: se escribe después de responder (o se avisa si falla).
  const etiqueta = etiquetaFecha(cita.inicio);
  const fila = [
    fechaHoraBogota(new Date()), cita.fecha, etiqueta.hora, datos.nombre, datos.correo, datos.whatsapp,
    datos.objetivo, datos.detalle, datos.origen, evento?.id || idEvento, "Agendada",
  ];
  const guardar = registrarEnHoja(env, fila);
  if (ctx?.waitUntil) ctx.waitUntil(guardar); else await guardar;

  return json({ ok: true, ...etiqueta, enlace });
}

// ---------- Cambiar o cancelar con el enlace ----------
const ACCIONES = new Set(["ver", "cambiar", "cancelar"]);

// Estado de la cita: activa, pasada o cancelada. Solo acepta eventos creados por /agenda.
function estadoDe(ev) {
  if (!ev || ev.status === "cancelled") return "cancelada";
  if (ev.extendedProperties?.private?.[MARCA_AGENDA.clave] !== MARCA_AGENDA.valor) return "invalido";
  return Date.parse(ev.start?.dateTime) <= Date.now() ? "pasada" : "activa";
}

const personaDe = (ev) => ({
  nombre: ev.attendees?.[0]?.displayName || "—",
  correo: ev.attendees?.[0]?.email || "—",
  whatsapp: (/^WhatsApp: (.+)$/m.exec(ev.description || "") || [])[1] || "—",
});

// Actualiza la fila de la cita en la hoja y te avisa por correo. Nunca bloquea la respuesta.
async function registrarCambio(env, idEvento, cambios, asunto, lineas) {
  let nota = "";
  try {
    await asegurarTitulo(env, env.AGENDA_SHEET_ID, CONFIG.hoja.pestana, COL.estado, CONFIG.hoja.columnas[COL.estado])
      .catch((e) => console.error("No se pudo escribir el título Estado:", (e && e.stack) || e));
    const filas = await leerFilas(env, env.AGENDA_SHEET_ID, CONFIG.hoja.pestana);
    const posicion = filas.findIndex((f) => f[COL.idEvento] === idEvento);
    if (posicion < 0) nota = "No encontré la fila de esta cita en la hoja «Northik · Agenda». Actualízala a mano.";
    else await actualizarCeldas(env, env.AGENDA_SHEET_ID, CONFIG.hoja.pestana, posicion, cambios);
  } catch (e) {
    console.error("No se pudo actualizar la hoja de la agenda:", (e && e.stack) || e);
    nota = "No se pudo actualizar la hoja «Northik · Agenda». Actualízala a mano. Error: " + String((e && e.message) || e).slice(0, 300);
  }
  try {
    await avisoInterno(env, asunto, [...lineas, ...(nota ? ["", nota] : [])]);
  } catch (e) {
    console.error("No se pudo enviar el aviso:", (e && e.stack) || e);
  }
}

async function _cita(request, env, ctx, json) {
  if (!(await dentroDelLimite(request, env))) return json({ ok: false, error: MSG_LIMITE }, 429);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ ok: false, estado: "invalido" }, 415);
  const texto = await request.text();
  if (texto.length > 1000) return json({ ok: false, estado: "invalido" }, 413);
  let body;
  try { body = JSON.parse(texto); } catch { return json({ ok: false, estado: "invalido" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["codigo", "accion", "inicio"].includes(k))
    || !ACCIONES.has(body.accion)) return json({ ok: false, estado: "invalido" }, 400);

  const idEvento = await verificar(env, body.codigo);
  if (!idEvento) return json({ ok: false, estado: "invalido" }, 400);

  const ev = await obtenerEvento(env, calendarioCitas(env), idEvento);
  const estado = estadoDe(ev);
  if (estado === "invalido") return json({ ok: false, estado }, 400);
  if (estado !== "activa") return json({ ok: body.accion === "ver", estado });

  const antes = etiquetaFecha(new Date(ev.start.dateTime));
  if (body.accion === "ver") return json({ ok: true, estado, ...antes });

  const persona = personaDe(ev);
  const datosPersona = [`Correo: ${persona.correo}`, `WhatsApp: ${persona.whatsapp}`];

  if (body.accion === "cancelar") {
    await cancelarEvento(env, calendarioCitas(env), idEvento);
    const tarea = registrarCambio(env, idEvento, { [COL.estado]: "Cancelada" },
      `Agenda: ${persona.nombre} canceló su llamada`,
      [`${persona.nombre} canceló su llamada del ${antes.dia} a las ${antes.hora}.`, "La hora quedó libre en la agenda.", "", ...datosPersona]);
    if (ctx?.waitUntil) ctx.waitUntil(tarea); else await tarea;
    return json({ ok: true, estado: "cancelada", ...antes });
  }

  // Cambiar: la hora nueva cumple las mismas reglas que una reserva nueva y tiene que seguir libre.
  if (typeof body.inicio !== "string") return json({ ok: false, error: MSG_CITA_ERROR }, 400);
  const nueva = citasPosibles(CONFIG).find((c) => c.inicio.getTime() === Date.parse(body.inicio));
  if (!nueva) return json({ ok: false, ocupada: true, error: MSG_OCUPADA }, 409);
  const ocupados = await horasOcupadas(env, calendarios(env), nueva.inicio, nueva.fin);
  if (seCruza(nueva, ocupados)) return json({ ok: false, ocupada: true, error: MSG_OCUPADA }, 409);

  await moverEvento(env, calendarioCitas(env), idEvento, nueva.inicio, nueva.fin, CONFIG.zonaHoraria);
  const despues = etiquetaFecha(nueva.inicio);
  const tarea = registrarCambio(env, idEvento,
    { [COL.fecha]: nueva.fecha, [COL.hora]: despues.hora, [COL.estado]: "Reprogramada" },
    `Agenda: ${persona.nombre} cambió su llamada`,
    [`${persona.nombre} cambió su llamada.`, `Antes: ${antes.dia} a las ${antes.hora}.`, `Ahora: ${despues.dia} a las ${despues.hora}.`, "", ...datosPersona]);
  if (ctx?.waitUntil) ctx.waitUntil(tarea); else await tarea;
  return json({ ok: true, estado: "activa", ...despues });
}

// Errores de Google o de red: mensaje propio de la agenda, no el del formulario de contacto.
const conRespaldo = (fn) => async (...args) => {
  const json = args.at(-1);
  try {
    return await fn(...args);
  } catch (e) {
    console.error("Error en la agenda:", (e && e.stack) || e);
    return json({ ok: false, error: MSG_ERROR }, 502);
  }
};
export const horarios = conRespaldo(_horarios);
export const reservar = conRespaldo(_reservar);
export const cita = async (...args) => {
  const json = args.at(-1);
  try {
    return await _cita(...args);
  } catch (e) {
    console.error("Error en la agenda (cita):", (e && e.stack) || e);
    return json({ ok: false, error: MSG_CITA_ERROR }, 502);
  }
};
