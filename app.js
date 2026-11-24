(function () {
  const cfg = window.AGENDA_CONFIG;
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const funcionesUrl = `${cfg.SUPABASE_URL}/functions/v1`;
  const headersFuncion = {
    'Content-Type': 'application/json',
    apikey: cfg.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
  };

  const estado = { servicio: null, slot: null };

  // Icono por palabra clave del nombre del servicio, para que el panel admin
  // pueda agregar servicios nuevos sin que haya que tocar este archivo.
  const ICONOS = {
    // Auto: techo bajo y parejo, perfil de sedán compacto.
    default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l1.2-3.2A2 2 0 0 1 7 8.5h10a2 2 0 0 1 1.8 1.3L20 13"/><path d="M2.5 13h19v2.5a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1v-.7H5.7v.7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V13Z"/><circle cx="7" cy="16.5" r="1.4"/><circle cx="17" cy="16.5" r="1.4"/></svg>',
    // SUV: techo alto y recto de punta a punta, mas cuadrado.
    suv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 13V7.8a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1V13"/><path d="M4.5 10h15"/><path d="M2.5 13h19v2.5a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1v-.7H5.7v.7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V13Z"/><circle cx="7" cy="16.5" r="1.4"/><circle cx="17" cy="16.5" r="1.4"/></svg>',
    // Camioneta: cabina solo adelante + caja abierta y baja atras.
    camioneta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 13V8.8a1 1 0 0 1 1-1h4.3l1.7-2.3h2v7.5"/><path d="M12.5 10.3h4l3 2.7"/><path d="M2.5 13h19v2.5a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1v-.7H5.7v.7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V13Z"/><circle cx="7" cy="16.5" r="1.4"/><circle cx="17" cy="16.5" r="1.4"/></svg>',
  };

  const ICONO_CALENDARIO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>';

  function iconoPara(nombre) {
    const n = nombre.toLowerCase();
    if (n.includes('camioneta') || n.includes('pick')) return ICONOS.camioneta;
    if (n.includes('suv')) return ICONOS.suv;
    return ICONOS.default;
  }

  const pasos = {
    servicio: document.getElementById('paso-servicio'),
    horario: document.getElementById('paso-horario'),
    datos: document.getElementById('paso-datos'),
  };
  const ORDEN_PASOS = ['servicio', 'horario', 'datos'];

  function irAPaso(nombre) {
    Object.values(pasos).forEach((p) => p.classList.remove('activo'));
    pasos[nombre].classList.add('activo');

    const indiceActual = ORDEN_PASOS.indexOf(nombre);
    document.querySelectorAll('[data-paso-item]').forEach((item) => {
      const indice = ORDEN_PASOS.indexOf(item.dataset.pasoItem);
      item.classList.toggle('activo', indice === indiceActual);
      item.classList.toggle('hecho', indice < indiceActual);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  irAPaso('servicio');

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

    cont.innerHTML = '<div class="servicios-grid"></div>';
    const grid = cont.querySelector('.servicios-grid');
    data.forEach((s) => {
      const btn = document.createElement('button');
      btn.className = 'servicio-card';
      btn.innerHTML = `
        <span class="servicio-icono">${iconoPara(s.nombre)}</span>
        <span class="servicio-texto">
          <span class="servicio-nombre">${s.nombre}</span>
        </span>
      `;
      btn.addEventListener('click', () => elegirServicio(s));
      grid.appendChild(btn);
    });
  }

  async function elegirServicio(servicio) {
    estado.servicio = servicio;
    irAPaso('horario');
    const cont = document.getElementById('calendario');
    cont.innerHTML = '<p class="cargando">Buscando horarios disponibles…</p>';

    try {
      const resp = await fetch(`${funcionesUrl}/disponibilidad?servicio_id=${servicio.id}&dias=35`, {
        headers: headersFuncion,
      });
      const json = await resp.json();
      const disponibles = json.disponibles || [];

      if (disponibles.length === 0) {
        cont.innerHTML = '<p class="error">No hay horarios libres en los próximos días. Escribinos y te buscamos un hueco.</p>';
        return;
      }

      window.crearCalendario({
        contenedor: cont,
        disponibles,
        onElegirHora: (fecha, hora) => elegirSlot(fecha, hora),
      });
    } catch (e) {
      cont.innerHTML = '<p class="error">No se pudo cargar la disponibilidad. Probá de nuevo.</p>';
    }
  }

  function elegirSlot(fecha, hora) {
    estado.slot = { fecha, hora };

    const fechaLegible = new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    document.getElementById('resumen-turno').innerHTML = `
      <span class="resumen-icono">${ICONO_CALENDARIO}</span>
      <span class="resumen-texto">
        ${estado.servicio.nombre} — ${fechaLegible} a las ${hora}hs
        <span class="resumen-seña">Se confirma con una seña de $5.000</span>
      </span>
    `;

    irAPaso('datos');
    if (window.fbq) fbq('track', 'InitiateCheckout');
  }

  // Validacion en vivo del telefono: avisa si parece incompleto, sin
  // bloquear mientras la persona todavia esta escribiendo.
  const inputTelefono = document.getElementById('telefono');
  const ayudaTelefono = document.getElementById('ayuda-telefono');
  inputTelefono.addEventListener('blur', () => {
    const digitos = inputTelefono.value.replace(/\D/g, '');
    const incompleto = digitos.length > 0 && digitos.length < 8;
    inputTelefono.classList.toggle('invalido', incompleto);
    ayudaTelefono.classList.toggle('visible', incompleto);
  });
  inputTelefono.addEventListener('input', () => {
    if (inputTelefono.classList.contains('invalido')) {
      inputTelefono.classList.remove('invalido');
      ayudaTelefono.classList.remove('visible');
    }
  });

  document.getElementById('btn-pagar').addEventListener('click', async () => {
    const nombre = document.getElementById('nombre').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    const vehiculo = document.getElementById('vehiculo').value.trim();
    const errorEl = document.getElementById('error-datos');
    errorEl.style.display = 'none';

    if (!nombre || telefono.replace(/\D/g, '').length < 8) {
      errorEl.textContent = 'Completá tu nombre y un teléfono válido.';
      errorEl.style.display = 'block';
      return;
    }

    const boton = document.getElementById('btn-pagar');
    boton.disabled = true;
    boton.textContent = 'Generando el link de pago…';

    try {
      const resp = await fetch(`${funcionesUrl}/crear-preferencia`, {
        method: 'POST',
        headers: headersFuncion,
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
