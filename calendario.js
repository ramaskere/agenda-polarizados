// Calendario mensual reutilizable: recibe la lista plana de disponibilidad
// ([{fecha, hora}, ...]) que devuelve la Edge Function "disponibilidad" y
// dibuja un mes con los dias que tienen horario libre resaltados. Al tocar
// un dia, la grilla del mes se reemplaza por los horarios de ESE dia dentro
// de la misma tarjeta (no se muestran los dos juntos); un link "volver"
// regresa al mes. Lo usan tanto app.js (reserva publica) como
// admin/admin.js (ver disponibilidad).
window.crearCalendario = function ({ contenedor, disponibles, onElegirHora }) {
  const porFecha = {};
  disponibles.forEach((d) => {
    porFecha[d.fecha] = porFecha[d.fecha] || [];
    porFecha[d.fecha].push(d.hora);
  });

  const fechasDisponibles = Object.keys(porFecha).sort();
  const hoy = new Date();
  const hoyStr = hoy.toISOString().slice(0, 10);

  let cursor = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  let vista = 'dias'; // 'dias' | 'horarios'
  let fechaSeleccionada = null;

  const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
  const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  function fechaStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function hayDisponibleDesde(fechaLimiteStr) {
    return fechasDisponibles.some((f) => f >= fechaLimiteStr);
  }

  function render() {
    contenedor.innerHTML = `<div class="tarjeta-calendario">${vista === 'dias' ? htmlVistaDias() : htmlVistaHorarios()}</div>`;

    if (vista === 'dias') {
      cablearVistaDias();
    } else {
      cablearVistaHorarios();
    }
  }

  function htmlVistaDias() {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const primerDiaSemana = (new Date(y, m, 1).getDay() + 6) % 7; // 0 = lunes
    const diasEnMes = new Date(y, m + 1, 0).getDate();

    const esMesActual = y === hoy.getFullYear() && m === hoy.getMonth();
    const primerDiaMesSiguiente = fechaStr(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, 1);
    const hayMasAdelante = hayDisponibleDesde(primerDiaMesSiguiente);

    let celdas = '';
    for (let i = 0; i < primerDiaSemana; i++) celdas += '<button class="dia-celda vacio" disabled></button>';
    for (let d = 1; d <= diasEnMes; d++) {
      const fs = fechaStr(y, m, d);
      const tieneHorarios = !!porFecha[fs];
      const esHoy = fs === hoyStr;
      const clases = ['dia-celda'];
      if (tieneHorarios) clases.push('disponible'); else clases.push('no-disponible');
      if (esHoy) clases.push('hoy');
      celdas += `<button class="${clases.join(' ')}" data-fecha="${fs}" ${tieneHorarios ? '' : 'disabled'}><span>${d}</span><span class="dia-punto"></span></button>`;
    }

    return `
      <div class="calendario-header">
        <button class="calendario-nav" id="cal-prev" ${esMesActual ? 'disabled' : ''} aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div class="calendario-mes">${MESES[m]} ${y}</div>
        <button class="calendario-nav" id="cal-next" ${hayMasAdelante ? '' : 'disabled'} aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
      </div>
      <div class="calendario-semana">${DIAS_SEMANA.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="calendario-grilla">${celdas}</div>
    `;
  }

  function cablearVistaDias() {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    contenedor.querySelector('#cal-prev').addEventListener('click', () => {
      cursor = new Date(y, m - 1, 1);
      render();
    });
    contenedor.querySelector('#cal-next').addEventListener('click', () => {
      cursor = new Date(y, m + 1, 1);
      render();
    });
    contenedor.querySelectorAll('.dia-celda.disponible').forEach((btn) => {
      btn.addEventListener('click', () => {
        fechaSeleccionada = btn.dataset.fecha;
        vista = 'horarios';
        render();
      });
    });
  }

  function htmlVistaHorarios() {
    const fecha = fechaSeleccionada;
    const horas = porFecha[fecha] || [];
    const tituloFecha = new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    return `
      <button class="volver-dias" id="cal-volver">‹ Elegir otro día</button>
      <h3>${tituloFecha}</h3>
      <div class="slots">${horas.map((h) => `<button class="slot" data-hora="${h}">${h}</button>`).join('')}</div>
    `;
  }

  function cablearVistaHorarios() {
    contenedor.querySelector('#cal-volver').addEventListener('click', () => {
      vista = 'dias';
      render();
    });
    contenedor.querySelectorAll('.slot').forEach((btn) => {
      btn.addEventListener('click', () => {
        contenedor.querySelectorAll('.slot.seleccionado').forEach((s) => s.classList.remove('seleccionado'));
        btn.classList.add('seleccionado');
        onElegirHora(fechaSeleccionada, btn.dataset.hora);
      });
    });
  }

  // Arranca mostrando el primer mes que tenga algo disponible (por si hoy
  // no queda nada libre pero el mes que viene si).
  if (fechasDisponibles.length > 0 && !hayDisponibleDesde(fechaStr(hoy.getFullYear(), hoy.getMonth(), 1))) {
    const primera = new Date(`${fechasDisponibles[0]}T12:00:00-03:00`);
    cursor = new Date(primera.getFullYear(), primera.getMonth(), 1);
  }

  render();

  return {
    seleccionarPrimerDiaDisponible() {
      if (fechasDisponibles.length > 0) {
        fechaSeleccionada = fechasDisponibles[0];
        vista = 'horarios';
        render();
      }
    },
  };
};
