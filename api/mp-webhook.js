// POST /api/mp-webhook — notificacion (IPN) de Mercado Pago.
// Nunca confiar en el estado que viene en el payload del webhook: siempre se
// vuelve a pedir el pago a la API de Mercado Pago con el id recibido antes de
// confirmar nada. Eso evita que alguien mande un POST falso a este endpoint
// diciendo "approved".
const crypto = require('crypto');
const { supabaseAdmin, enviarEventoMeta } = require('./_lib');

function firmaValida(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // si Rama todavia no configuro el secret, no bloqueamos (ver README)

  const signatureHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'] || (req.query.data && req.query.data.id);
  if (!signatureHeader || !requestId || !dataId) return false;

  const partes = Object.fromEntries(signatureHeader.split(',').map((p) => p.trim().split('=')));
  const manifest = `id:${dataId};request-id:${requestId};ts:${partes.ts};`;
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hash === partes.v1;
}

module.exports = async (req, res) => {
  // Mercado Pago espera un 200 rapido. Si algo falla despues de validar,
  // respondemos 200 igual para que no nos siga reintentando a lo loco, pero
  // dejamos el log del error.
  try {
    const tipo = req.query.type || req.body?.type;
    if (tipo !== 'payment') return res.status(200).send('ok');

    if (!firmaValida(req)) {
      console.warn('Webhook de Mercado Pago con firma invalida, se ignora');
      return res.status(401).send('firma invalida');
    }

    const paymentId = req.query['data.id'] || req.body?.data?.id;
    if (!paymentId) return res.status(200).send('ok');

    const pagoResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const pago = await pagoResp.json();
    if (!pagoResp.ok) {
      console.error('No se pudo confirmar el pago contra la API de Mercado Pago', pago);
      return res.status(200).send('ok');
    }

    const turnoId = pago.external_reference;
    if (!turnoId) return res.status(200).send('ok');

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
        .select()
        .single();

      if (turno) {
        await enviarEventoMeta({
          eventName: 'Schedule',
          eventId: turno.meta_event_id,
          telefono: turno.cliente_telefono,
          nombre: turno.cliente_nombre,
          url: process.env.SITE_URL,
        });
      }
    } else if (pago.status === 'rejected' || pago.status === 'cancelled') {
      await db.from('turnos').update({ estado: 'cancelado' }).eq('id', turnoId).eq('estado', 'pendiente_pago');
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    return res.status(200).send('ok');
  }
};
