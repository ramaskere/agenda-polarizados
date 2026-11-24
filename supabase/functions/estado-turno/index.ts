// GET .../functions/v1/estado-turno?id=...
// Usado por gracias.html / pendiente.html para saber si el pago ya se
// confirmo (el webhook puede llegar unos segundos despues que Mercado Pago
// redirige al cliente de vuelta). Devuelve solo lo minimo, nada sensible.
import { supabaseAdmin, jsonResponse, corsHeaders } from '../_shared/lib.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonResponse({ error: 'falta id' }, 400);

  const db = supabaseAdmin();
  const { data: turno, error } = await db
    .from('turnos')
    .select('estado, inicio, fin, servicios(nombre)')
    .eq('id', id)
    .single();

  if (error || !turno) return jsonResponse({ error: 'turno no encontrado' }, 404);

  return jsonResponse({
    estado: turno.estado,
    inicio: turno.inicio,
    fin: turno.fin,
    servicio: (turno.servicios as { nombre?: string } | null)?.nombre,
  });
});
