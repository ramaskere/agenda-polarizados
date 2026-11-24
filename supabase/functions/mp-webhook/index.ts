// POST .../functions/v1/mp-webhook — notificacion (IPN) de Mercado Pago.
// Desplegada con --no-verify-jwt porque la llama Mercado Pago, no nuestro
// front (ver supabase/functions/README.md). La seguridad real es la firma
// x-signature + volver a pedir el pago a la API de Mercado Pago antes de
// confirmar nada: nunca confiar en el estado que viene en el payload.
import { supabaseAdmin, enviarEventoMeta, crearEventoCalendario, hmacSha256Hex, corsHeaders } from '../_shared/lib.ts';

async function firmaValida(req: Request, dataId: string | null) {
  const secret = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!secret) return true; // si todavia no se configuro el secret, no bloqueamos (ver README)

  const signatureHeader = req.headers.get('x-signature');
  const requestId = req.headers.get('x-request-id');
  if (!signatureHeader || !requestId || !dataId) return false;

  const partes = Object.fromEntries(signatureHeader.split(',').map((p) => p.trim().split('=') as [string, string]));
  const manifest = `id:${dataId};request-id:${requestId};ts:${partes.ts};`;
  const hash = await hmacSha256Hex(secret, manifest);
  return hash === partes.v1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Mercado Pago espera un 200 rapido. Si algo falla despues de validar la
  // firma, respondemos 200 igual para que no siga reintentando, pero el
  // error queda en los logs de la funcion.
  try {
    const url = new URL(req.url);
    let bodyJson: Record<string, unknown> = {};
    try {
      bodyJson = await req.json();
    } catch {
      // algunas notificaciones llegan sin body, solo con query params
    }

    const tipo = url.searchParams.get('type') || (bodyJson.type as string | undefined);
    if (tipo !== 'payment') return new Response('ok', { headers: corsHeaders });

    const dataId = url.searchParams.get('data.id') || ((bodyJson.data as { id?: string } | undefined)?.id ?? null);

    if (!(await firmaValida(req, dataId))) {
      console.warn('Webhook de Mercado Pago con firma invalida, se ignora');
      return new Response('firma invalida', { status: 401, headers: corsHeaders });
    }

    if (!dataId) return new Response('ok', { headers: corsHeaders });

    const pagoResp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${Deno.env.get('MP_ACCESS_TOKEN')}` },
    });
    const pago = await pagoResp.json();
    if (!pagoResp.ok) {
      console.error('No se pudo confirmar el pago contra la API de Mercado Pago', pago);
      return new Response('ok', { headers: corsHeaders });
    }

    const turnoId = pago.external_reference;
    if (!turnoId) return new Response('ok', { headers: corsHeaders });

    const db = supabaseAdmin();

    await db
      .from('pagos')
      .update({ mp_payment_id: String(pago.id), estado: pago.status, raw_webhook: pago, actualizado_at: new Date().toISOString() })
      .eq('turno_id', turnoId);

    if (pago.status === 'approved') {
      const { data: turno } = await db
        .from('turnos')
        .update({ estado: 'confirmado', expira_at: null })
        .eq('id', turnoId)
        .eq('estado', 'pendiente_pago') // idempotente: si ya estaba confirmado, no reprocesa
        .select('*, servicios(nombre)')
        .single();

      if (turno) {
        await enviarEventoMeta({
          eventName: 'Schedule',
          eventId: turno.meta_event_id,
          telefono: turno.cliente_telefono,
          nombre: turno.cliente_nombre,
          url: Deno.env.get('SITE_URL'),
        });

        await crearEventoCalendario({
          tituloServicio: (turno.servicios as { nombre?: string } | null)?.nombre || 'Turno',
          clienteNombre: turno.cliente_nombre,
          clienteTelefono: turno.cliente_telefono,
          vehiculo: turno.vehiculo,
          inicioISO: turno.inicio,
          finISO: turno.fin,
        });
      }
    } else if (pago.status === 'rejected' || pago.status === 'cancelled') {
      await db.from('turnos').update({ estado: 'cancelado' }).eq('id', turnoId).eq('estado', 'pendiente_pago');
    }

    return new Response('ok', { headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response('ok', { headers: corsHeaders });
  }
});
