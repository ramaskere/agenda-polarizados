// GET /api/liberar-vencidos — lo llama un cron (GitHub Actions, ver
// .github/workflows/liberar-vencidos.yml) cada 5 minutos. Libera los turnos
// que quedaron "pendiente_pago" porque alguien abrio el checkout de Mercado
// Pago y nunca pago, asi ese horario vuelve a aparecer disponible.
const { supabaseAdmin } = require('./_lib');

module.exports = async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('turnos')
    .update({ estado: 'vencido' })
    .eq('estado', 'pendiente_pago')
    .lt('expira_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'error interno' });
  }

  return res.status(200).json({ liberados: data.length });
};
