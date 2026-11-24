// GET /api/disponibilidad?servicio_id=...&dias=14
// Devuelve, para los proximos N dias, que horarios tienen AL MENOS un recurso
// libre para ese servicio. No expone que recurso es: eso se asigna solo al
// confirmar el turno (api/crear-preferencia), asi el cliente nunca elige un
// "box" a mano.
const { supabaseAdmin, aFechaHoraArgentina, sumarMinutos } = require('./_lib');

const GRANULARIDAD_MINUTOS = 30; // grilla de horarios candidatos
const LEAD_MINIMO_MINUTOS = 120; // no ofrecer turnos a menos de 2hs de ahora

function seSuperponen(aInicio, aFin, bInicio, bFin) {
  return aInicio < bFin && bInicio < aFin;
}

function horaLocalArgentina(date) {
  return date.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

module.exports = async (req, res) => {
  try {
    const { servicio_id, dias } = req.query;
    if (!servicio_id) return res.status(400).json({ error: 'falta servicio_id' });

    const cantidadDias = Math.min(parseInt(dias, 10) || 14, 30);
    const db = supabaseAdmin();

    const { data: servicio, error: errServicio } = await db
      .from('servicios')
      .select('id, duracion_minutos')
      .eq('id', servicio_id)
      .eq('activo', true)
      .single();
    if (errServicio || !servicio) return res.status(404).json({ error: 'servicio no encontrado' });

    const hoy = new Date();
    const desde = hoy.toISOString();
    const hasta = new Date(hoy.getTime() + cantidadDias * 86400000).toISOString();

    const [{ data: recursos }, { data: horarios }, { data: bloqueos }, { data: turnos }] = await Promise.all([
      db.from('recursos').select('id').eq('activo', true),
      db.from('horarios_atencion').select('dia_semana, hora_inicio, hora_fin').eq('activo', true),
      db.from('bloqueos').select('recurso_id, desde, hasta').lte('desde', hasta).gte('hasta', desde),
      db
        .from('turnos')
        .select('recurso_id, inicio, fin')
        .in('estado', ['pendiente_pago', 'confirmado'])
        .lte('inicio', hasta)
        .gte('fin', desde),
    ]);

    if (!recursos || recursos.length === 0) return res.status(200).json({ disponibles: [] });

    const ocupado = (turnos || []).map((t) => ({ recurso_id: t.recurso_id, desde: new Date(t.inicio), hasta: new Date(t.fin) }));
    const cerrado = (bloqueos || []).map((b) => ({ recurso_id: b.recurso_id, desde: new Date(b.desde), hasta: new Date(b.hasta) }));

    const disponibles = [];
    const limiteReserva = new Date(Date.now() + LEAD_MINIMO_MINUTOS * 60000);

    for (let i = 0; i < cantidadDias; i++) {
      const fecha = new Date(hoy.getTime() + i * 86400000).toISOString().slice(0, 10);
      const diaSemana = new Date(`${fecha}T12:00:00-03:00`).getDay();

      const horariosDelDia = (horarios || []).filter((h) => h.dia_semana === diaSemana);
      for (const h of horariosDelDia) {
        let cursor = aFechaHoraArgentina(fecha, h.hora_inicio.slice(0, 5));
        const finVentana = aFechaHoraArgentina(fecha, h.hora_fin.slice(0, 5));

        while (sumarMinutos(cursor, servicio.duracion_minutos) <= finVentana) {
          const slotInicio = cursor;
          const slotFin = sumarMinutos(cursor, servicio.duracion_minutos);

          if (slotInicio >= limiteReserva) {
            const hayRecursoLibre = recursos.some((r) => {
              const chocaConTurno = ocupado.some((o) => o.recurso_id === r.id && seSuperponen(slotInicio, slotFin, o.desde, o.hasta));
              const chocaConBloqueo = cerrado.some(
                (b) => (b.recurso_id === null || b.recurso_id === r.id) && seSuperponen(slotInicio, slotFin, b.desde, b.hasta)
              );
              return !chocaConTurno && !chocaConBloqueo;
            });
            if (hayRecursoLibre) {
              disponibles.push({ fecha, hora: horaLocalArgentina(slotInicio) });
            }
          }
          cursor = sumarMinutos(cursor, GRANULARIDAD_MINUTOS);
        }
      }
    }

    return res.status(200).json({ disponibles, duracion_minutos: servicio.duracion_minutos });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'error interno' });
  }
};
