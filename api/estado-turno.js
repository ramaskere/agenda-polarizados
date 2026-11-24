// GET /api/estado-turno?id=...
// Usado por gracias.html / pendiente.html para saber si el pago ya se
// confirmo (el webhook puede llegar unos segundos despues que Mercado Pago
// redirige al cliente de vuelta). Devuelve solo lo minimo, nada sensible.
const { supabaseAdmin } = require('./_lib');

module.exports = async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'falta id' });

  const db = supabaseAdmin();
  const { data: turno, error } = await db
    .from('turnos')
    .select('estado, inicio, fin, servicios(nombre)')
    .eq('id', id)
    .single();

  if (error || !turno) return res.status(404).json({ error: 'turno no encontrado' });

  return res.status(200).json({
    estado: turno.estado,
    inicio: turno.inicio,
    fin: turno.fin,
    servicio: turno.servicios?.nombre,
  });
};
