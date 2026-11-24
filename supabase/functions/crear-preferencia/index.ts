// POST .../functions/v1/crear-preferencia
// body: { servicio_id, fecha: "2026-12-01", hora: "14:30", cliente_nombre, cliente_telefono, vehiculo }
// Crea el turno en estado pendiente_pago (ocupando un recurso libre) y la
// preferencia de Mercado Pago para cobrar la senia. Devuelve el link de pago.
import { supabaseAdmin, aFechaHoraArgentina, sumarMinutos, SENIA_ARS, jsonResponse, corsHeaders } from '../_shared/lib.ts';

const MINUTOS_PARA_EXPIRAR = 15;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'metodo no permitido' }, 405);

  try {
    const { servicio_id, fecha, hora, cliente_nombre, cliente_telefono, vehiculo } = await req.json();
    if (!servicio_id || !fecha || !hora || !cliente_nombre || !cliente_telefono) {
      return jsonResponse({ error: 'faltan datos obligatorios' }, 400);
    }

    const db = supabaseAdmin();

    const { data: servicio, error: errServicio } = await db
      .from('servicios')
      .select('id, nombre, duracion_minutos')
      .eq('id', servicio_id)
      .eq('activo', true)
      .single();
    if (errServicio || !servicio) return jsonResponse({ error: 'servicio no encontrado' }, 404);

    const inicio = aFechaHoraArgentina(fecha, hora);
    const fin = sumarMinutos(inicio, servicio.duracion_minutos);
    if (inicio.getTime() <= Date.now()) return jsonResponse({ error: 'ese horario ya paso' }, 400);

    // Chequeo optimista de que hay un recurso libre: el constraint de
    // exclusion en la tabla turnos es la garantia real contra una carrera de
    // dos personas eligiendo el mismo horario a la vez.
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

    const ocupados = new Set([
      ...(turnosQueChocan || []).map((t) => t.recurso_id),
      ...(bloqueosQueChocan || []).filter((b) => b.recurso_id).map((b) => b.recurso_id),
    ]);
    const hayBloqueoGeneral = (bloqueosQueChocan || []).some((b) => b.recurso_id === null);
    const recursoLibre = hayBloqueoGeneral ? null : (recursos || []).find((r) => !ocupados.has(r.id));

    if (!recursoLibre) return jsonResponse({ error: 'horario_no_disponible' }, 409);

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
      if (errTurno.code === '23P01') return jsonResponse({ error: 'horario_no_disponible' }, 409);
      console.error(errTurno);
      return jsonResponse({ error: 'no se pudo crear el turno' }, 500);
    }

    const siteUrl = Deno.env.get('SITE_URL') || '';
    const functionsUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1`;
    const preference = await crearPreferenciaMercadoPago({ turno, servicio, siteUrl, functionsUrl });

    if (!preference.id) {
      console.error('Mercado Pago no devolvio preferencia', preference);
      await db.from('turnos').update({ estado: 'cancelado' }).eq('id', turno.id);
      return jsonResponse({ error: 'no se pudo generar el link de pago' }, 502);
    }

    await db.from('pagos').insert({
      turno_id: turno.id,
      mp_preference_id: preference.id,
      monto: SENIA_ARS,
      estado: 'pending',
    });

    return jsonResponse({
      turno_id: turno.id,
      meta_event_id: turno.meta_event_id,
      init_point: preference.init_point,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: 'error interno' }, 500);
  }
});

async function crearPreferenciaMercadoPago({
  turno,
  servicio,
  siteUrl,
  functionsUrl,
}: {
  turno: { id: string; meta_event_id: string };
  servicio: { nombre: string };
  siteUrl: string;
  functionsUrl: string;
}) {
  const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('MP_ACCESS_TOKEN')}`,
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
      notification_url: `${functionsUrl}/mp-webhook`,
      back_urls: {
        success: `${siteUrl}/gracias.html?turno=${turno.id}&event=${turno.meta_event_id}`,
        pending: `${siteUrl}/pendiente.html?turno=${turno.id}`,
        failure: `${siteUrl}/error.html?turno=${turno.id}`,
      },
      auto_return: 'approved',
    }),
  });
  return resp.json();
}
