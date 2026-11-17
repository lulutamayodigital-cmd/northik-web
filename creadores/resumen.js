// Resumen del perfil que ve el creador al registrarse.
// Se calcula solo con las cifras que escribió, en su propio navegador. No es una evaluación de Northik Match.
import { TAMANOS, RANGO_ER, ER_SOSPECHOSO } from "./config.js";

const num = (v, dec = 1) => v.toLocaleString("es-CO", { maximumFractionDigits: dec, minimumFractionDigits: 0 });
const pct = (lo, hi) => `${num(lo)}–${num(hi)} %`;

export function tamano(seguidores) {
  if (!(seguidores > 0)) return null;
  return TAMANOS.find((t) => seguidores < t.hasta).nombre;
}

// Igual a veredicto_er de la herramienta: «Por debajo / Dentro / Por encima de lo típico para un Micro (1–3 %)».
export function veredicto(valor, tam) {
  const r = RANGO_ER[tam];
  if (valor == null || !r) return null;
  const [lo, hi] = r;
  if (valor > hi * ER_SOSPECHOSO) {
    return { nivel: "revisar", texto: `Muy por encima de lo típico para un ${tam} (${pct(lo, hi)}). Revisa que las cifras estén bien escritas.` };
  }
  const nivel = valor < lo ? "debajo" : valor > hi ? "encima" : "dentro";
  const donde = { debajo: "Por debajo de", dentro: "Dentro de", encima: "Por encima de" }[nivel];
  return { nivel, texto: `${donde} lo típico para un ${tam} (${pct(lo, hi)})` };
}

// Lo que cuenta para «qué tan completo quedó tu perfil». Los obligatorios siempre están.
const OBLIGATORIOS = ["nombre", "redes", "ciudad", "nicho", "tarifa", "correo", "whatsapp"];
const OPCIONALES = [
  { clave: "seguidores", texto: "Tus seguidores" },
  { clave: "vistas", texto: "Tu promedio de vistas por reel o video" },
  { clave: "interacciones", texto: "Tu promedio de interacciones por publicación" },
  { clave: "pantallazos", texto: "Pantallazos de tu audiencia por ciudad, edad y género" },
];

// d = { seguidores, vistas, interacciones, pantallazos } (números o 0).
export function resumen(d) {
  const seguidores = Number(d.seguidores) || 0;
  const vistas = Number(d.vistas) || 0;
  const interacciones = Number(d.interacciones) || 0;
  const tam = tamano(seguidores);

  let tasa = null;
  if (seguidores > 0 && interacciones > 0) {
    const valor = (interacciones / seguidores) * 100;
    tasa = { valor, texto: `${num(valor, valor < 10 ? 1 : 0)} %`, tamano: tam, veredicto: veredicto(valor, tam) };
  }

  let alcance = null;
  if (seguidores > 0 && vistas > 0) {
    const valor = (vistas / seguidores) * 100;
    alcance = {
      valor,
      texto: `${num(valor, 0)} %`,
      lectura: valor > 100
        ? "Tus videos llegan a más personas de las que te siguen."
        : "Tus videos llegan sobre todo a quienes ya te siguen.",
    };
  }

  const tiene = { seguidores: seguidores > 0, vistas: vistas > 0, interacciones: interacciones > 0, pantallazos: Number(d.pantallazos) > 0 };
  const hechos = OBLIGATORIOS.length + OPCIONALES.filter((o) => tiene[o.clave]).length;
  const total = OBLIGATORIOS.length + OPCIONALES.length;
  const completo = {
    porcentaje: Math.round((hechos / total) * 100),
    faltan: OPCIONALES.filter((o) => !tiene[o.clave]).map((o) => o.texto),
  };

  return { tamano: tam, seguidores, tasa, alcance, completo, conCifras: tiene.seguidores || tiene.vistas || tiene.interacciones };
}
