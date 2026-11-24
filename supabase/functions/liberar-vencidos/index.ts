// GET .../functions/v1/liberar-vencidos — lo llama un cron (GitHub Actions,
// ver .github/workflows/liberar-vencidos.yml) cada 5 minutos. Desplegada con
// --no-verify-jwt porque el cron manda su propio secret (x-cron-secret), no
// un JWT de Supabase. Libera los turnos que quedaron "pendiente_pago" porque
// alguien abrio el checkout de Mercado Pago y nunca pago.
import { supabaseAdmin, jsonResponse, corsHeaders } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return jsonResponse({ error: 'no autorizado' }, 401);
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
    return jsonResponse({ error: 'error interno' }, 500);
  }

  return jsonResponse({ liberados: data.length });
});
