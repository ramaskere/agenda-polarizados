(function () {
  const cfg = window.AGENDA_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const estado = { servicio: null, slot: null };

  const pasos = {
    servicio: document.getElementById('paso-servicio'),
    horario: document.getElementById('paso-horario'),
    datos: document.getElementById('paso-datos'),
  };

  function irAPaso(nombre) {
    Object.values(pasos).forEach((p) => p.classList.remove('activo'));
    pasos[nombre].classList.add('activo');
  }

  document.querySelectorAll('[data-volver]').forEach((btn) => {
    btn.addEventListener('click', () => irAPaso(btn.dataset.volver.replace('paso-', '')));
  });

  async function cargarServicios() {
    const cont = document.getElementById('lista-servicios');
    const { data, error } = await supa
      .from('servicios')
      .select('id, nombre, duracion_minutos')
      .eq('activo', true)
      .order('nombre');

    if (error || !data || data.length === 0) {
      cont.innerHTML = '<p class="error">No hay servicios disponibles por ahora. Probá más tarde.</p>';
      return;
    }

    cont.innerHTML = '';
    data.forEach((s) => {
      const btn = document.createElement('button');
      btn.className = 'servicio-card';
      btn.textContent = `${s.nombre} (${s.duracion_minutos} min)`;
      btn.addEventListener('click', () => elegirServicio(s));
      cont.appendChild(btn);
    });
  }

  async function elegirServicio(servicio) {
    estado.servicio = servicio;
    irAPaso('horario');
    const cont = document.getElementById('lista-horarios');
    cont.innerHTML = '<p class="cargando">Buscando horarios disponibles…</p>';

    try {
      const resp = await fetch(`/api/disponibilidad?servicio_id=${servicio.id}&dias=14`);
      const json = await resp.json();
      renderHorarios(json.disponibles || []);
    } catch (e) {
      cont.innerHTML = '<p class="error">No se pudo cargar la disponibilidad. Probá de nuevo.</p>';
    }
  }

  function renderHorarios(disponibles) {
    const cont = document.getElementById('lista-horarios');
    if (disponibles.length === 0) {
      cont.innerHTML = '<p class="error">No hay horarios libres en los próximos días. Escribinos y te buscamos un hueco.</p>';
      return;
    }

    const porDia = {};
    disponibles.forEach((d) => {
      porDia[d.fecha] = porDia[d.fecha] || [];
      porDia[d.fecha].push(d.hora);
    });

    cont.innerHTML = '';
    Object.entries(porDia).forEach(([fecha, horas]) => {
      const bloque = document.createElement('div');
      bloque.className = 'dia-bloque';

      const titulo = document.createElement('h3');
      titulo.textContent = new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      bloque.appendChild(titulo);

      const slots = document.createElement('div');
      slots.className = 'slots';
      horas.forEach((hora) => {
        const slot = document.createElement('button');
        slot.className = 'slot';
        slot.textContent = hora;
        slot.addEventListener('click', () => elegirSlot(fecha, hora, slot));
        slots.appendChild(slot);
      });
      bloque.appendChild(slots);
      cont.appendChild(bloque);
    });
  }

  function elegirSlot(fecha, hora, el) {
    document.querySelectorAll('.slot.seleccionado').forEach((s) => s.classList.remove('seleccionado'));
    el.classList.add('seleccionado');
    estado.slot = { fecha, hora };

    document.getElementById('resumen-turno').textContent =
      `${estado.servicio.nombre} — ${new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${hora}hs`;

    irAPaso('datos');
    if (window.fbq) fbq('track', 'InitiateCheckout');
  }

  document.getElementById('btn-pagar').addEventListener('click', async () => {
    const nombre = document.getElementById('nombre').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    const vehiculo = document.getElementById('vehiculo').value.trim();
    const errorEl = document.getElementById('error-datos');
    errorEl.style.display = 'none';

    if (!nombre || !telefono) {
      errorEl.textContent = 'Completá nombre y teléfono.';
      errorEl.style.display = 'block';
      return;
    }

    const boton = document.getElementById('btn-pagar');
    boton.disabled = true;
    boton.textContent = 'Generando el link de pago…';

    try {
      const resp = await fetch('/api/crear-preferencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          servicio_id: estado.servicio.id,
          fecha: estado.slot.fecha,
          hora: estado.slot.hora,
          cliente_nombre: nombre,
          cliente_telefono: telefono,
          vehiculo,
        }),
      });
      const json = await resp.json();

      if (!resp.ok) {
        if (json.error === 'horario_no_disponible') {
          errorEl.textContent = 'Justo se ocupó ese horario. Elegí otro, por favor.';
        } else {
          errorEl.textContent = 'No se pudo generar el pago. Probá de nuevo.';
        }
        errorEl.style.display = 'block';
        boton.disabled = false;
        boton.textContent = 'Reservar y pagar seña ($5.000)';
        return;
      }

      window.location.href = json.init_point;
    } catch (e) {
      errorEl.textContent = 'No se pudo generar el pago. Probá de nuevo.';
      errorEl.style.display = 'block';
      boton.disabled = false;
      boton.textContent = 'Reservar y pagar seña ($5.000)';
    }
  });

  cargarServicios();
})();
