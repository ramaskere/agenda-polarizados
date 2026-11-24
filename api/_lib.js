// Utilidades compartidas por las funciones serverless. No se expone al navegador
// (todo lo que esta en api/ corre solo en el servidor de Vercel).
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const TZ_OFFSET = '-03:00'; // Argentina, sin horario de verano.
const SENIA_ARS = 5000;

function supabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// "2026-12-01" + "14:30" -> Date en zona Argentina (UTC-3 fijo).
function aFechaHoraArgentina(fecha, hora) {
  return new Date(`${fecha}T${hora}:00${TZ_OFFSET}`);
}

function sumarMinutos(fecha, minutos) {
  return new Date(fecha.getTime() + minutos * 60000);
}

// Normaliza un telefono argentino a solo digitos para mandarlo hasheado a Meta
// (ej. "11 2345-6789" -> "5491123456789" si ya viene con codigo de pais, o se
// le agrega 549 si parece un numero local de 10 dígitos).
function normalizarTelefono(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.startsWith('549') || digitos.startsWith('54')) return digitos;
  if (digitos.length === 10) return `549${digitos}`;
  return digitos;
}

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

// Manda un evento server-side a Meta Conversions API. event_id tiene que ser
// el MISMO que usa el Pixel en el navegador para que Meta deduplique y no
// cuente el turno dos veces.
async function enviarEventoMeta({ eventName, eventId, telefono, nombre, url, actionSource = 'website' }) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) {
    console.warn('META_PIXEL_ID o META_CAPI_TOKEN sin configurar, no se manda evento a Meta');
    return { skipped: true };
  }

  const userData = {};
  if (telefono) userData.ph = [sha256(normalizarTelefono(telefono))];
  if (nombre) userData.fn = [sha256(String(nombre).trim().toLowerCase())];

  const body = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: actionSource,
        event_source_url: url,
        user_data: userData,
      },
    ],
  };

  const resp = await fetch(
    `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${token}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const json = await resp.json();
  if (!resp.ok) console.error('Error mandando evento a Meta CAPI', json);
  return json;
}

module.exports = {
  TZ_OFFSET,
  SENIA_ARS,
  supabaseAdmin,
  aFechaHoraArgentina,
  sumarMinutos,
  normalizarTelefono,
  enviarEventoMeta,
};
