# Agenda de turnos (polarizados)

Sistema propio de reserva de turnos, **separado de GO APPLE** (repo, Supabase y
Vercel propios). Vive en esta carpeta solo para tenerlo cerca; está excluido
del repo `GO-APPLE` en `.git/info/exclude`, igual que `sistema-instagram/` y
`go-apple-sistema/`.

Flujo: el cliente elige servicio y horario → paga una seña fija de $5.000 por
Mercado Pago (Checkout Pro) → el turno se confirma solo cuando el webhook de
Mercado Pago valida el pago → se manda un evento `Schedule` a Meta (Pixel +
Conversions API, deduplicado) para que las campañas de Meta Ads puedan
optimizar por turnos agendados, no solo por clicks.

Ver el plan completo en `/Users/ramaruiz/.claude/plans/jaunty-frolicking-clover-of-4cfe3536-8a60-4d06-b09b-93c87b34ce6f.md`.

## Estructura

- `index.html` / `app.js` / `styles.css` — página pública de reserva.
- `gracias.html` / `pendiente.html` / `error.html` — resultado del pago (Mercado Pago redirige acá).
- `admin/` — panel para ver turnos, bloquear franjas y gestionar servicios/recursos (login con Supabase Auth).
- `api/` — funciones serverless de Vercel: crear preferencia de pago, webhook de Mercado Pago, disponibilidad, estado del turno, liberar turnos vencidos.
- `supabase/schema.sql` — esquema completo para correr en un proyecto Supabase nuevo.
- `.github/workflows/liberar-vencidos.yml` — cron cada 5 min que libera turnos que quedaron pendientes de pago y vencieron.

## Lo que falta hacer (pasos manuales, requieren tus cuentas/credenciales)

1. **Crear el repo en GitHub** (privado) para este proyecto y subir esta carpeta ahí — no al repo de GO-APPLE.
2. **Crear un proyecto Supabase nuevo**, correr `supabase/schema.sql` completo en el SQL editor, y dar de alta tu usuario (y el de tus empleados si corresponde) en Authentication → Users para poder entrar al panel admin.
3. **Crear un proyecto Vercel nuevo** apuntando a ese repo, y cargar las variables de entorno de `.env.example` con los valores reales (Project Settings → Environment Variables).
4. **Mercado Pago**: crear la app/credenciales en el panel de desarrolladores, copiar el `MP_ACCESS_TOKEN` de producción (o de prueba para testear primero) y configurar `MP_WEBHOOK_SECRET` con la clave secreta de la sección de notificaciones.
5. **Meta**: crear (o reusar) un Business Manager y Pixel para este negocio — separado de `ramaruiz.ads` y `goapple.sj` salvo que quieras usar el mismo —, y generar un token de acceso de Conversions API en Events Manager. Completar `META_PIXEL_ID`, `META_CAPI_TOKEN` (env de Vercel) y `META_PIXEL_ID` en `config.js` (este sí es público, va en el navegador).
6. **Completar `config.js`** con la URL y anon key reales de Supabase (la anon key es pública a propósito, la protege RLS del lado del servidor).
7. **Cargar los datos reales** desde el panel admin (o directo en Supabase): cuántos boxes/instaladores hay (`recursos`), qué servicios ofrecés y cuánto dura cada uno (`servicios`), y el horario real de atención (`horarios_atencion`, se carga por SQL por ahora — se puede agregar al panel admin si hace falta).
8. **Cron de turnos vencidos**: en el repo de GitHub, agregar los secrets `SITE_URL` y `CRON_SECRET` (Settings → Secrets and variables → Actions) para que el workflow `liberar-vencidos.yml` pueda llamar al endpoint.
9. **Probar todo en modo sandbox de Mercado Pago** (usuarios de prueba) antes de poner el `MP_ACCESS_TOKEN` de producción — ver la sección de Verificación del plan.

## Pendiente de definir con Rama

- Nombre final del negocio/marca (hoy el proyecto se llama `agenda-polarizados` como placeholder).
- Notificaciones de confirmación/recordatorio (WhatsApp o email) — no está en este MVP.
- Si la seña pasa a ser variable por tipo de servicio en el futuro (hoy es fija, $5.000).
