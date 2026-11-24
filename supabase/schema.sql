-- Esquema de agenda de turnos (polarizados). Correr completo en el SQL editor de un proyecto Supabase nuevo.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gist"; -- constraint de exclusion por rango de tiempo

create type estado_turno as enum ('pendiente_pago', 'confirmado', 'completado', 'cancelado', 'vencido');

-- Boxes / instaladores. Cada turno ocupa UN recurso durante su franja.
create table recursos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  activo     boolean not null default true,
  creado_at  timestamptz not null default now()
);

-- Tipos de polarizado (o cualquier servicio), con su duracion.
create table servicios (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  duracion_minutos   integer not null check (duracion_minutos > 0),
  activo             boolean not null default true,
  creado_at          timestamptz not null default now()
);

-- Horario de atencion general (no por recurso). dia_semana: 0 = domingo ... 6 = sabado.
create table horarios_atencion (
  id           uuid primary key default gen_random_uuid(),
  dia_semana   integer not null check (dia_semana between 0 and 6),
  hora_inicio  time not null,
  hora_fin     time not null,
  activo       boolean not null default true,
  check (hora_fin > hora_inicio)
);

-- Franjas cerradas a mano (feriados, vacaciones, un box roto, etc). recurso_id null = aplica a todos.
create table bloqueos (
  id          uuid primary key default gen_random_uuid(),
  recurso_id  uuid references recursos(id) on delete cascade,
  desde       timestamptz not null,
  hasta       timestamptz not null,
  motivo      text,
  creado_at   timestamptz not null default now(),
  check (hasta > desde)
);

-- Turnos. El constraint de exclusion es la garantia real contra doble reserva:
-- Postgres rechaza el insert/update si se superpone (recurso_id, rango de tiempo)
-- con otro turno "vivo" (pendiente_pago o confirmado).
create table turnos (
  id                uuid primary key default gen_random_uuid(),
  recurso_id        uuid not null references recursos(id),
  servicio_id       uuid not null references servicios(id),
  cliente_nombre    text not null,
  cliente_telefono  text not null,
  vehiculo          text,
  inicio            timestamptz not null,
  fin               timestamptz not null,
  estado            estado_turno not null default 'pendiente_pago',
  expira_at         timestamptz,              -- solo tiene sentido mientras estado = pendiente_pago
  meta_event_id     text not null default gen_random_uuid()::text, -- dedup Pixel <-> Conversions API
  creado_at         timestamptz not null default now(),
  check (fin > inicio),
  exclude using gist (
    recurso_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado in ('pendiente_pago', 'confirmado'))
);

create index turnos_inicio_idx on turnos (inicio);

-- Pagos de Mercado Pago, uno (normalmente) por turno.
create table pagos (
  id              uuid primary key default gen_random_uuid(),
  turno_id        uuid not null references turnos(id) on delete cascade,
  mp_preference_id text,
  mp_payment_id    text,
  monto            numeric(10, 2) not null,
  estado           text not null default 'pending', -- pending | approved | rejected | cancelled
  raw_webhook      jsonb,
  creado_at        timestamptz not null default now(),
  actualizado_at   timestamptz not null default now()
);

create index pagos_turno_idx on pagos (turno_id);
create index pagos_mp_payment_idx on pagos (mp_payment_id);

-- RLS: todo cerrado salvo lectura publica de servicios/recursos activos.
-- Los turnos y pagos solo los escriben las funciones serverless (service role key),
-- nunca el navegador del cliente directamente.
alter table recursos enable row level security;
alter table servicios enable row level security;
alter table horarios_atencion enable row level security;
alter table bloqueos enable row level security;
alter table turnos enable row level security;
alter table pagos enable row level security;

create policy "lectura publica de servicios activos"
  on servicios for select
  using (activo = true);

create policy "lectura publica de recursos activos"
  on recursos for select
  using (activo = true);

-- Panel admin: cualquier usuario logueado (Rama / sus empleados, dados de
-- alta a mano en Supabase Auth) puede administrar todo. Negocio chico, un
-- solo rol alcanza; si hace falta separar permisos mas adelante se agrega
-- una tabla de roles.
create policy "staff administra recursos" on recursos for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "staff administra servicios" on servicios for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "staff administra horarios" on horarios_atencion for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "staff administra bloqueos" on bloqueos for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "staff administra turnos" on turnos for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "staff lee pagos" on pagos for select
  using (auth.role() = 'authenticated');

-- Datos de ejemplo para arrancar a probar (Rama los ajusta desde el panel admin
-- o directo en la tabla una vez que sepa cuantos boxes/instaladores tiene).
insert into recursos (nombre) values ('Box 1'), ('Box 2');

insert into servicios (nombre, duracion_minutos) values
  ('Polarizado auto chico', 90),
  ('Polarizado SUV / camioneta', 120);

insert into horarios_atencion (dia_semana, hora_inicio, hora_fin) values
  (1, '09:00', '18:00'), -- lunes
  (2, '09:00', '18:00'),
  (3, '09:00', '18:00'),
  (4, '09:00', '18:00'),
  (5, '09:00', '18:00'),
  (6, '09:00', '13:00'); -- sabado
