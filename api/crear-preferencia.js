// POST /api/crear-preferencia
// body: { servicio_id, fecha: "2026-12-01", hora: "14:30", cliente_nombre, cliente_telefono, vehiculo }
// Crea el turno en estado pendiente_pago (ocupando un recurso libre) y la
// preferencia de Mercado Pago para cobrar la senia. Devuelve el link de pago.
const { supabaseAdmin, aFechaHoraArgentina, sumarMinutos, SENIA_ARS } = require('./_lib');

const MINUTOS_PARA_EXPIRAR = 15;

function seSuperponen(aInicio, aFin, bInicio, bFin) {
  return aInicio < bFin && bInicio < aFin;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'metodo no permitido' });

  try {
    const { servicio_id, fecha, hora, cliente_nombre, cliente_telefono, vehiculo } = req.body || {};
    if (!servicio_id || !fecha || !hora || !cliente_nombre || !cliente_telefono) {
      return res.status(400).json({ error: 'faltan datos obligatorios' });
    }

    const db = supabaseAdmin();

    const { data: servicio, error: errServicio } = await db
      .from('servicios')
      .select('id, nombre, duracion_minutos')
      .eq('id', servicio_id)
      .eq('activo', true)
      .single();
    if (errServicio || !servicio) return res.status(404).json({ error: 'servicio no encontrado' });

    const inicio = aFechaHoraArgentina(fecha, hora);
    const fin = sumarMinutos(inicio, servicio.duracion_minutos);
    if (inicio.getTime() <= Date.now()) return res.status(400).json({ error: 'ese horario ya paso' });

    // Buscar un recurso libre para esa franja exacta (chequeo optimista: el
    // constraint de exclusion en la tabla turnos es la garantia real contra
    // una carrera de dos personas eligiendo el mismo horario a la vez).
    const { data: recursos } = await db.from('recursos').select('id').eq('activo', true);
    const { data: turnosQueChocan } = await db
      .from('turnos')
      .select('recurso_id')
      .in('estado', ['pendiente_pago', 'confirmado'])
      .lt('inicio', fin.toISOString())
      .gt('fin', inicio.toISOString());
    const { data: bloqueosQueChocan } = await db
      .from('bloqueos')
      .select('recurso_id')
      .lt('desde', fin.toISOString())
      .gt('hasta', inicio.toISOString());

    const ocupados = new Set([...(turnosQueChocan || []).map((t) => t.recurso_id), ...(bloqueosQueChocan || []).filter((b) => b.recurso_id).map((b) => b.recurso_id)]);
    const hayBloqueoGeneral = (bloqueosQueChocan || []).some((b) => b.recurso_id === null);
    const recursoLibre = hayBloqueoGeneral ? null : (recursos || []).find((r) => !ocupados.has(r.id));

    if (!recursoLibre) return res.status(409).json({ error: 'horario_no_disponible' });

    const expiraAt = new Date(Date.now() + MINUTOS_PARA_EXPIRAR * 60000);

    const { data: turno, error: errTurno } = await db
      .from('turnos')
      .insert({
        recurso_id: recursoLibre.id,
        servicio_id: servicio.id,
        cliente_nombre,
        cliente_telefono,
        vehiculo: vehiculo || null,
        inicio: inicio.toISOString(),
        fin: fin.toISOString(),
        estado: 'pendiente_pago',
        expira_at: expiraAt.toISOString(),
      })
      .select()
      .single();

    if (errTurno) {
      // El constraint de exclusion salta justo aca si alguien reservo el
      // mismo recurso/franja un instante antes.
      if (errTurno.code === '23P01') return res.status(409).json({ error: 'horario_no_disponible' });
      console.error(errTurno);
      return res.status(500).json({ error: 'no se pudo crear el turno' });
    }

    const baseUrl = process.env.SITE_URL || `https://${req.headers.host}`;
    const preference = await crearPreferenciaMercadoPago({ turno, servicio, baseUrl });

    if (!preference.id) {
      console.error('Mercado Pago no devolvio preferencia', preference);
      await db.from('turnos').update({ estado: 'cancelado' }).eq('id', turno.id);
      return res.status(502).json({ error: 'no se pudo generar el link de pago' });
    }

    await db.from('pagos').insert({
      turno_id: turno.id,
      mp_preference_id: preference.id,
      monto: SENIA_ARS,
      estado: 'pending',
    });

    return res.status(200).json({
      turno_id: turno.id,
      meta_event_id: turno.meta_event_id,
      init_point: preference.init_point,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'error interno' });
  }
};

async function crearPreferenciaMercadoPago({ turno, servicio, baseUrl }) {
  const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      items: [
        {
          title: `Seña turno: ${servicio.nombre}`,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: SENIA_ARS,
        },
      ],
      external_reference: turno.id,
      notification_url: `${baseUrl}/api/mp-webhook`,
      back_urls: {
        success: `${baseUrl}/gracias.html?turno=${turno.id}&event=${turno.meta_event_id}`,
        pending: `${baseUrl}/pendiente.html?turno=${turno.id}`,
        failure: `${baseUrl}/error.html?turno=${turno.id}`,
      },
      auto_return: 'approved',
    }),
  });
  return resp.json();
}
