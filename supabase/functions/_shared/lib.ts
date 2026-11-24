// Utilidades compartidas por las Edge Functions. SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automaticamente, no hace
// falta configurarlos a mano como secret.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const TZ_OFFSET = '-03:00'; // Argentina, sin horario de verano.
export const SENIA_ARS = 5000;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function supabaseAdmin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

// "2026-12-01" + "14:30" -> Date en zona Argentina (UTC-3 fijo).
export function aFechaHoraArgentina(fecha: string, hora: string) {
  return new Date(`${fecha}T${hora}:00${TZ_OFFSET}`);
}

export function sumarMinutos(fecha: Date, minutos: number) {
  return new Date(fecha.getTime() + minutos * 60000);
}

// Normaliza un telefono argentino a solo digitos para mandarlo hasheado a
// Meta (ej. "11 2345-6789" -> "5491123456789").
export function normalizarTelefono(telefono: string) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.startsWith('549') || digitos.startsWith('54')) return digitos;
  if (digitos.length === 10) return `549${digitos}`;
  return digitos;
}

export async function sha256(texto: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, mensaje: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  return Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Manda un evento server-side a Meta Conversions API. event_id tiene que ser
// el MISMO que usa el Pixel en el navegador para que Meta deduplique y no
// cuente el turno dos veces.
export async function enviarEventoMeta(opts: {
  eventName: string;
  eventId: string;
  telefono?: string;
  nombre?: string;
  url?: string;
  actionSource?: string;
}) {
  const pixelId = Deno.env.get('META_PIXEL_ID');
  const token = Deno.env.get('META_CAPI_TOKEN');
  if (!pixelId || !token) {
    console.warn('META_PIXEL_ID o META_CAPI_TOKEN sin configurar, no se manda evento a Meta');
    return { skipped: true };
  }

  const userData: Record<string, string[]> = {};
  if (opts.telefono) userData.ph = [await sha256(normalizarTelefono(opts.telefono))];
  if (opts.nombre) userData.fn = [await sha256(opts.nombre.trim().toLowerCase())];

  const body = {
    data: [
      {
        event_name: opts.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: opts.eventId,
        action_source: opts.actionSource || 'website',
        event_source_url: opts.url,
        user_data: userData,
      },
    ],
  };

  const resp = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) console.error('Error mandando evento a Meta CAPI', json);
  return json;
}
