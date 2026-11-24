# Agenda de turnos (polarizados)

Sistema propio de reserva de turnos, **separado de GO APPLE** (repo y Supabase
propios). Vive en esta carpeta solo para tenerlo cerca; está excluido del
repo `GO-APPLE` en `.git/info/exclude`, igual que `sistema-instagram/` y
`go-apple-sistema/`.

**Arquitectura: todo en GitHub + Supabase, sin Vercel.**
- El sitio público (reserva, panel admin) es HTML/JS estático, publicado con
  **GitHub Pages** directo desde este repo.
- La lógica que necesita secretos (crear el pago, recibir el webhook de
  Mercado Pago, calcular disponibilidad) corre como **Supabase Edge
  Functions**, en el mismo proyecto Supabase que ya tenés — no es una cuenta
  nueva.

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
- `supabase/schema.sql` — esquema completo para correr en el proyecto Supabase.
- `supabase/functions/` — las Edge Functions: `crear-preferencia`, `mp-webhook`, `disponibilidad`, `estado-turno`, `liberar-vencidos`, y `_shared/lib.ts` con las utilidades comunes.
- `.github/workflows/liberar-vencidos.yml` — cron cada 5 min que llama a la función `liberar-vencidos`.

## Lo que falta hacer (pasos manuales, requieren tu cuenta)

### 1. Supabase (ya hecho el proyecto)

- [x] Proyecto creado (`sdibzwylwxlvqaxiwlkn`).
- [x] `schema.sql` corrido en el SQL editor.
- [ ] Desplegar las Edge Functions. Necesitás el CLI de Supabase:
  ```bash
  npm install -g supabase
  supabase login
  cd agenda-polarizados
  supabase link --project-ref sdibzwylwxlvqaxiwlkn
  ```
  Completá `supabase/.env.local` (copiá `supabase/.env.example`, no se sube a git) con el `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `META_PIXEL_ID`, `META_CAPI_TOKEN`, `CRON_SECRET` y la URL real de GitHub Pages, y cargalos:
  ```bash
  supabase secrets set --env-file supabase/.env.local
  ```
  Después desplegá las 5 funciones (las dos que reciben llamadas externas sin login de Supabase van con `--no-verify-jwt`):
  ```bash
  supabase functions deploy disponibilidad
  supabase functions deploy crear-preferencia
  supabase functions deploy estado-turno
  supabase functions deploy mp-webhook --no-verify-jwt
  supabase functions deploy liberar-vencidos --no-verify-jwt
  ```

### 2. GitHub Pages

- En el repo (`ramaskere/agenda-polarizados`) → Settings → Pages → Source: "Deploy from a branch", branch `main`, carpeta `/ (root)`.
- El sitio queda en `https://ramaskere.github.io/agenda-polarizados/`. Usá esa URL como `SITE_URL` en `supabase/.env.local` (paso anterior) y como back_url pública.

### 3. Mercado Pago

- Crear la app/credenciales en el panel de desarrolladores, copiar el `MP_ACCESS_TOKEN` (de prueba primero, de producción después).
- Configurar `MP_WEBHOOK_SECRET` con la clave secreta de la sección de notificaciones/webhooks.

### 4. Meta

- Crear (o reusar) un Business Manager y Pixel para este negocio — separado de `ramaruiz.ads` y `goapple.sj` salvo que prefieras usar el mismo.
- Generar un token de acceso de Conversions API en Events Manager.
- Completar `META_PIXEL_ID` y `META_CAPI_TOKEN` en `supabase/.env.local`, y el `META_PIXEL_ID` también en `config.js` (ese sí es público, va al navegador).

### 5. Cron de turnos vencidos

- En GitHub → Settings → Secrets and variables → Actions, agregar `SUPABASE_URL` (`https://sdibzwylwxlvqaxiwlkn.supabase.co`) y `CRON_SECRET` (el mismo valor que pusiste en `supabase/.env.local`).
- Si el workflow todavía no está en GitHub porque faltó el permiso `workflow` del token de `gh`, agregalo a mano desde la web: GitHub → el repo → Add file → Create new file → `.github/workflows/liberar-vencidos.yml`, pegar el contenido de ese archivo local y confirmar.

### 6. Datos reales

- Cargar desde el panel admin (o directo en Supabase) cuántos boxes/instaladores hay (`recursos`), qué servicios ofrecés y cuánto dura cada uno (`servicios`), y crear tu usuario en Authentication → Users para entrar al panel admin cuando quieras.
- El horario real de atención (`horarios_atencion`) se carga por SQL por ahora.

### 7. Probar todo en modo sandbox de Mercado Pago antes de pasar a producción

Ver la sección de Verificación del plan guardado.

## Pendiente de definir con Rama

- Nombre final del negocio/marca (hoy el proyecto se llama `agenda-polarizados` como placeholder).
- Notificaciones de confirmación/recordatorio (WhatsApp o email) — no está en este MVP.
- Si la seña pasa a ser variable por tipo de servicio en el futuro (hoy es fija, $5.000).
- Usuario del panel admin: todavía no se creó ninguno.
