// Registro de creadores · northik.ai/creadores/
// Opciones del formulario y referencias del resumen. Lo usan la página y el servidor (worker/creadores.js).
// Aquí no hay claves ni datos de nadie.

export const NICHOS = [
  "Gastronomía y restaurantes",
  "Moda",
  "Belleza y cuidado personal",
  "Fitness y bienestar",
  "Viajes y turismo",
  "Hogar y decoración",
  "Maternidad y familia",
  "Tecnología",
  "Finanzas y emprendimiento",
  "Humor y entretenimiento",
  "Educación",
  "Mascotas",
  "Música y arte",
  "Deportes",
  "Estilo de vida",
  "Otro",
];

// País de residencia del creador.
export const RESIDENCIAS = ["Colombia", "México", "España", "Otro"];

// Rango de tarifa por publicación, en pesos colombianos.
export const TARIFAS = [
  "Todavía no tengo tarifa",
  "Menos de $300.000",
  "$300.000 a $800.000",
  "$800.000 a $2.000.000",
  "$2.000.000 a $5.000.000",
  "Más de $5.000.000",
];

// Tamaños por seguidores y engagement típico por tamaño: copiados de la herramienta Northik Match
// (influencer-intelligence: ii/metrics.py → TAMANOS, RANGO_ER y ER_SOSPECHOSO; ii/interpretacion.py → veredicto_er).
// Si cambian allá, cámbialos aquí también.
export const TAMANOS = [
  { hasta: 10000, nombre: "Nano" },
  { hasta: 100000, nombre: "Micro" },
  { hasta: 500000, nombre: "Medio" },
  { hasta: 1000000, nombre: "Macro" },
  { hasta: Infinity, nombre: "Mega" },
];
export const RANGO_ER = { Nano: [2.0, 5.0], Micro: [1.0, 3.0], Medio: [0.8, 2.0], Macro: [0.6, 1.5], Mega: [0.5, 1.0] };
// Más de este múltiplo del techo típico: se pide revisar las cifras (en la herramienta se marca como sospechoso).
export const ER_SOSPECHOSO = 3;

// Pantallazos de estadísticas: máximo 4 imágenes de hasta 5 MB.
export const PANTALLAZOS = { maximo: 4, maxBytes: 5 * 1024 * 1024, tipos: ["image/jpeg", "image/png", "image/webp"] };

// Texto exacto de las casillas obligatorias (se guarda tal cual como prueba de la autorización).
export const TEXTO_CASILLAS = {
  mayor_edad: "Soy mayor de 18 años",
  autorizo: "Autorizo el tratamiento de mis datos según la Política de Tratamiento de Datos",
};
