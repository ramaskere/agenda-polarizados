(function () {
  const cfg = window.AGENDA_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const elLogin = document.getElementById('login');
  const elPanel = document.getElementById('panel');

  async function revisarSesion() {
    const { data } = await supa.auth.getSession();
    if (data.session) {
      elLogin.style.display = 'none';
      elPanel.style.display = 'block';
      cargarTurnos();
      cargarBloqueos();
      cargarServicios();
      cargarRecursos();
      cargarSelectorDisponibilidad();
    }
  }

  document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('pass').value;
    const { error } = await supa.auth.signInWithPassword({ email, password });
    const errorEl = document.getElementById('error-login');
    if (error) {
      errorEl.textContent = 'Email o contraseña incorrectos.';
      errorEl.style.display = 'block';
      return;
    }
    revisarSesion();
  });

  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('activo'));
      btn.classList.add('activo');
      ['turnos', 'disponibilidad', 'bloqueos', 'servicios', 'recursos'].forEach((t) => {
        document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? 'block' : 'none';
      });
    });
  });

  async function cargarTurnos() {
    const cont = document.getElementById('tabla-turnos');
    const { data, error } = await supa
      .from('turnos')
      .select('id, inicio, cliente_nombre, cliente_telefono, vehiculo, estado, servicios(nombre), recursos(nombre)')
      .gte('inicio', new Date(Date.now() - 86400000).toISOString())
      .order('inicio')
      .limit(100);

    if (error) { cont.innerHTML = '<p class="error">No se pudieron cargar los turnos.</p>'; return; }

    const filas = (data || [])
      .map(
        (t) => `<tr>
          <td>${new Date(t.inicio).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' })}</td>
          <td>${t.servicios?.nombre || ''}</td>
          <td>${t.recursos?.nombre || ''}</td>
          <td>${t.cliente_nombre}<br><small>${t.cliente_telefono}${t.vehiculo ? ' · ' + t.vehiculo : ''}</small></td>
          <td><span class="estado-pill estado-${t.estado}">${t.estado}</span></td>
          <td>${t.estado === 'confirmado' ? `<button data-completar="${t.id}">Marcar completado</button>` : ''}
              ${t.estado !== 'cancelado' && t.estado !== 'completado' ? `<button data-cancelar="${t.id}">Cancelar</button>` : ''}</td>
        </tr>`
      )
      .join('');

    cont.innerHTML = `<table><tr><th>Cuándo</th><th>Servicio</th><th>Recurso</th><th>Cliente</th><th>Estado</th><th></th></tr>${filas}</table>`;

    cont.querySelectorAll('[data-completar]').forEach((b) =>
      b.addEventListener('click', async () => { await supa.from('turnos').update({ estado: 'completado' }).eq('id', b.dataset.completar); cargarTurnos(); })
    );
    cont.querySelectorAll('[data-cancelar]').forEach((b) =>
      b.addEventListener('click', async () => { await supa.from('turnos').update({ estado: 'cancelado' }).eq('id', b.dataset.cancelar); cargarTurnos(); })
    );
  }

  async function cargarBloqueos() {
    const cont = document.getElementById('tabla-bloqueos');
    const { data } = await supa.from('bloqueos').select('id, desde, hasta, motivo').order('desde');
    cont.innerHTML = `<table><tr><th>Desde</th><th>Hasta</th><th>Motivo</th><th></th></tr>${(data || [])
      .map(
        (b) => `<tr><td>${new Date(b.desde).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td><td>${new Date(b.hasta).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td><td>${b.motivo || ''}</td><td><button data-borrar-bloqueo="${b.id}">Quitar</button></td></tr>`
      )
      .join('')}</table>`;
    cont.querySelectorAll('[data-borrar-bloqueo]').forEach((btn) =>
      btn.addEventListener('click', async () => { await supa.from('bloqueos').delete().eq('id', btn.dataset.borrarBloqueo); cargarBloqueos(); })
    );
  }

  document.getElementById('btn-agregar-bloqueo').addEventListener('click', async () => {
    const desde = document.getElementById('bloqueo-desde').value;
    const hasta = document.getElementById('bloqueo-hasta').value;
    const motivo = document.getElementById('bloqueo-motivo').value;
    if (!desde || !hasta) return;
    await supa.from('bloqueos').insert({ desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString(), motivo });
    cargarBloqueos();
  });

  async function cargarServicios() {
    const cont = document.getElementById('tabla-servicios');
    const { data } = await supa.from('servicios').select('id, nombre, duracion_minutos, activo').order('nombre');
    cont.innerHTML = `<table><tr><th>Nombre</th><th>Duración</th><th>Activo</th><th></th></tr>${(data || [])
      .map(
        (s) => `<tr><td>${s.nombre}</td><td>${s.duracion_minutos} min</td><td>${s.activo ? 'sí' : 'no'}</td><td><button data-toggle-servicio="${s.id}" data-valor="${!s.activo}">${s.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`
      )
      .join('')}</table>`;
    cont.querySelectorAll('[data-toggle-servicio]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await supa.from('servicios').update({ activo: btn.dataset.valor === 'true' }).eq('id', btn.dataset.toggleServicio);
        cargarServicios();
      })
    );
  }

  document.getElementById('btn-agregar-servicio').addEventListener('click', async () => {
    const nombre = document.getElementById('servicio-nombre').value.trim();
    const duracion = parseInt(document.getElementById('servicio-duracion').value, 10);
    if (!nombre || !duracion) return;
    await supa.from('servicios').insert({ nombre, duracion_minutos: duracion });
    document.getElementById('servicio-nombre').value = '';
    document.getElementById('servicio-duracion').value = '';
    cargarServicios();
  });

  async function cargarRecursos() {
    const cont = document.getElementById('tabla-recursos');
    const { data } = await supa.from('recursos').select('id, nombre, activo').order('nombre');
    cont.innerHTML = `<table><tr><th>Nombre</th><th>Activo</th><th></th></tr>${(data || [])
      .map(
        (r) => `<tr><td>${r.nombre}</td><td>${r.activo ? 'sí' : 'no'}</td><td><button data-toggle-recurso="${r.id}" data-valor="${!r.activo}">${r.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`
      )
      .join('')}</table>`;
    cont.querySelectorAll('[data-toggle-recurso]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await supa.from('recursos').update({ activo: btn.dataset.valor === 'true' }).eq('id', btn.dataset.toggleRecurso);
        cargarRecursos();
      })
    );
  }

  document.getElementById('btn-agregar-recurso').addEventListener('click', async () => {
    const nombre = document.getElementById('recurso-nombre').value.trim();
    if (!nombre) return;
    await supa.from('recursos').insert({ nombre });
    document.getElementById('recurso-nombre').value = '';
    cargarRecursos();
  });

  const funcionesUrl = `${cfg.SUPABASE_URL}/functions/v1`;

  async function cargarSelectorDisponibilidad() {
    const select = document.getElementById('disponibilidad-servicio');
    const { data } = await supa.from('servicios').select('id, nombre').eq('activo', true).order('nombre');
    select.innerHTML = (data || []).map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
    select.addEventListener('change', () => cargarDisponibilidad(select.value));
    if (data && data.length > 0) cargarDisponibilidad(data[0].id);
  }

  async function cargarDisponibilidad(servicioId) {
    const cont = document.getElementById('disponibilidad-calendario');
    if (!servicioId) { cont.innerHTML = ''; return; }
    cont.innerHTML = '<p class="cargando">Buscando disponibilidad…</p>';

    const { data: sesion } = await supa.auth.getSession();
    const resp = await fetch(`${funcionesUrl}/disponibilidad?servicio_id=${servicioId}&dias=35`, {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${sesion.session.access_token}` },
    });
    const json = await resp.json();
    const disponibles = json.disponibles || [];

    if (disponibles.length === 0) {
      cont.innerHTML = '<p class="error">No hay horarios libres en los próximos días para este servicio.</p>';
      return;
    }

    window.crearCalendario({ contenedor: cont, disponibles, onElegirHora: () => {} });
  }

  revisarSesion();
})();
