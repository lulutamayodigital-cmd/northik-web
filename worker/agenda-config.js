// Reglas de disponibilidad de la agenda de Northik.
// Cambia aquí los horarios; no hace falta tocar nada más.

export const CONFIG = {
  // Calendario donde se leen las horas ocupadas y se crean las citas.
  calendarioId: 'primary', // el principal de northik.admin@gmail.com

  zonaHoraria: 'America/Bogota',

  // Franjas por día de la semana (hora local, formato 24 h).
  // Día sin franjas = sin citas.
  franjas: {
    lunes: [{ desde: '15:00', hasta: '16:00' }],
    martes: [{ desde: '09:00', hasta: '10:00' }],
    miercoles: [{ desde: '09:00', hasta: '10:00' }],
    jueves: [{ desde: '15:00', hasta: '16:00' }],
    viernes: [],
    sabado: [],
    domingo: [],
  },

  duracionMin: 20, // duración de cada cita
  pausaMin: 10, // tiempo libre entre citas

  anticipacionMinHoras: 24, // no se puede reservar con menos de esto
  anticipacionMaxDias: 60, // ni más allá de esto

  sinCitasEnFestivosDeColombia: true,

  whatsapp:
    'https://wa.me/573054670254?text=Hola%2C%20quiero%20agendar%20la%20llamada%20de%2020%20minutos',
};

export const OBJETIVOS = [
  'Aparecer en video sin grabarme (gemelo digital)',
  'Saber qué publicar y a quién (estrategia)',
  'Trabajar con creadores de contenido',
  'Automatizar la atención de mi negocio',
  'Otro',
];
