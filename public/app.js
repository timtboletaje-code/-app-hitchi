const API = '';
let user = JSON.parse(localStorage.getItem('hitchi_user') || 'null');
let currentFolio = null;
let estacionesCache = [];
let tiposCache = [];

function $(id) { return document.getElementById(id); }
function render(html) { document.getElementById('app').innerHTML = html; }

// --- LOGIN ---
function showLogin() {
  render(`
    <div class="login-screen">
      <div style="font-size:48px;margin-bottom:8px">🔧</div>
      <h2>APP HITCHI</h2>
      <p class="subtitle">Registro de incidencias de mantenimiento</p>
      <input type="email" id="email-input" placeholder="Correo electrónico" value="${user?.correo||''}">
      <input type="text" id="name-input" placeholder="Nombre del técnico" value="${user?.nombre||''}">
      <button class="btn-primary" id="btn-login">ENTRAR</button>
      <div id="login-error" class="error-msg" style="display:none;margin-top:8px"></div>
    </div>
  `);
  $('btn-login').onclick = doLogin;
  $('email-input').onkeydown = e => { if (e.key==='Enter') doLogin(); };
}

async function doLogin() {
  const correo = $('email-input').value.trim();
  const nombre = $('name-input').value.trim();
  const errEl = $('login-error');
  if (!correo) { errEl.textContent='Ingresa tu correo'; errEl.style.display='block'; return; }
  try {
    const res = await fetch(`${API}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({correo, nombre}) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    user = data;
    localStorage.setItem('hitchi_user', JSON.stringify(user));
    loadCaches();
    showDashboard();
  } catch(e) {
    errEl.textContent='Error: '+e.message; errEl.style.display='block';
  }
}

async function loadCaches() {
  try {
    const [eRes, tRes] = await Promise.all([
      fetch(`${API}/api/estaciones`),
      fetch(`${API}/api/tipos-equipo`)
    ]);
    estacionesCache = await eRes.json();
    tiposCache = await tRes.json();
  } catch(e) { console.error(e); }
}

// --- DASHBOARD ---
async function showDashboard() {
  render(`
    <div class="header">
      <h1>APP HITCHI</h1>
      <span class="user-badge">${user?.nombre||''}</span>
      <button class="btn-logout" id="btn-logout">Salir</button>
    </div>
    <div style="display:flex;gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #ddd">
      <select id="filtro-estacion" style="flex:1;padding:8px;border:2px solid #ddd;border-radius:6px;font-size:13px">
        <option value="">Todas las estaciones</option>
        ${estacionesCache.map(e => `<option value="${e}">${e}</option>`).join('')}
      </select>
      <button class="btn-new" onclick="showForm()" style="white-space:nowrap">+ Nueva</button>
      <a href="/api/excel-completo" target="_blank" class="btn-secondary" style="white-space:nowrap;padding:8px 10px;background:#555;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;display:inline-flex;align-items:center">📊 Excel</a>
    </div>
    <div class="dashboard" id="dashboard-content">
      <div class="loading">Cargando...</div>
    </div>
  `);
  $('btn-logout').onclick = () => { user=null; localStorage.removeItem('hitchi_user'); showLogin(); };
  $('filtro-estacion').onchange = loadIncidencias;
  await loadIncidencias();
}

async function loadIncidencias() {
  try {
    const est = $('filtro-estacion')?.value || '';
    const url = `${API}/api/incidencias${est ? '?estacion='+encodeURIComponent(est) : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    const container = $('dashboard-content');
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No hay reportes</p></div>`;
      return;
    }

    let html = `<div style="padding:6px 12px;font-size:12px;color:#888">${data.length} reportes</div>`;
    data.forEach(i => html += cardHTML(i));
    container.innerHTML = html;
  } catch(e) {
    const c = $('dashboard-content');
    if (c) c.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
  }
}

function cardHTML(i) {
  return `<div class="incidencia-card" onclick="showDetail('${i.folio}')">
    <div class="folio">${i.folio}</div>
    <div class="ubicacion">${i.estacion || ''} ${i.equipo ? '· '+i.equipo : ''} ${i.loc_id ? '('+i.loc_id+')' : ''}</div>
    <div class="meta">${i.f_reporte||''} ${i.tecnico_asignado ? '· '+i.tecnico_asignado : ''}</div>
  </div>`;
}

// --- FORM ---
function showForm(editFolio) {
  currentFolio = editFolio || null;
  if (editFolio) {
    fetch(`${API}/api/incidencias/${editFolio}`).then(r=>r.json()).then(d => renderForm(d)).catch(() => renderForm(null));
  } else {
    renderForm(null);
  }
}

function renderForm(data) {
  const isEdit = !!data;
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toTimeString().slice(0,5);

  let selectedEstacion = data?.estacion || '';
  let selectedEquipo = data?.equipo || '';
  let selectedLoc = data?.loc_id || '';

  const locs = (selectedEstacion && selectedEquipo) ? [] : [];

  render(`
    <div class="header">
      <button class="btn-back" onclick="showDashboard()">←</button>
      <h1>${isEdit ? 'EDITAR' : 'NUEVA'} INCIDENCIA</h1>
    </div>
    <div class="form-screen">
      ${isEdit ? `<div style="font-weight:700;color:#CC0000;margin-bottom:8px">Folio: ${data.folio}</div>` : ''}

      <!-- SECCIÓN: Fechas -->
      <div class="form-section">
        <div class="form-section-title">📅 Fechas y Horarios</div>
        <div class="form-row">
          <div class="form-group"><label>Fecha Reporte</label><input type="date" id="f_f_reporte" value="${data?.f_reporte||today}"></div>
          <div class="form-group"><label>Hora Reporte</label><input type="time" id="f_h_reporte" value="${data?.h_reporte||now}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Fecha Llegada</label><input type="date" id="f_f_llegada" value="${data?.f_llegada||today}"></div>
          <div class="form-group"><label>Hora Llegada</label><input type="time" id="f_h_llegada" value="${data?.h_llegada||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Fecha Cierre</label><input type="date" id="f_fecha_cierre" value="${data?.fecha_cierre||''}"></div>
          <div class="form-group"><label>Hora Cierre</label><input type="time" id="f_hora_cierre" value="${data?.hora_cierre||''}"></div>
        </div>
      </div>

      <!-- SECCIÓN: Ubicación -->
      <div class="form-section">
        <div class="form-section-title">📍 Ubicación del Equipo</div>
        <div class="form-group"><label>Estación</label></div>
        <div class="selector-grid" id="estacion-grid"></div>
        <div class="form-group"><label>Tipo de Equipo</label></div>
        <div class="selector-grid" id="equipo-grid"></div>
        <div class="form-group"><label>Location ID</label></div>
        <div class="selector-grid" id="loc-grid"></div>
        <div class="form-group"><label>Folio (editable)</label><input id="f_folio" value="${data?.folio||''}" placeholder="Auto-generado si se deja vacío"></div>
      </div>

      <!-- SECCIÓN: Falla -->
      <div class="form-section">
        <div class="form-section-title">⚠️ Datos de la Falla</div>
        <div class="form-group"><label>Fecha de la Falla</label><input type="date" id="f_falla_fecha" value="${data?.falla_fecha_reporte||today}"></div>
        <div class="form-group"><label>¿Cómo fue identificado el fallo?</label>
          <select id="f_como_identificado">
            <option value="">Seleccionar...</option>
            ${['CCO','MAU','Recorrido Técnico','Jefe de Estación','Otro'].map(o =>
              `<option value="${o}" ${data?.como_fue_identificado===o?'selected':''}>${o}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group"><label>Causa Raíz del Fallo</label><textarea id="f_causa_raiz" placeholder="Describe la causa raíz...">${data?.causa_raiz||''}</textarea></div>
        <div class="form-group"><label>Método de Diagnóstico</label>
          <select id="f_metodo_diagnostico">
            <option value="">Seleccionar...</option>
            ${['Inspección Visual','Prueba de Medición','Prueba de Funcionamiento','Otro'].map(o =>
              `<option value="${o}" ${data?.metodo_diagnostico===o?'selected':''}>${o}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <!-- SECCIÓN: Corrección -->
      <div class="form-section">
        <div class="form-section-title">🔧 Corrección</div>
        <div class="form-group"><label>Descripción de la Corrección</label><textarea id="f_desc_correccion" placeholder="Describe la corrección realizada...">${data?.descripcion_correccion||''}</textarea></div>
        <div class="form-group"><label>Tipo de Pruebas Realizadas</label>
          <select id="f_tipo_pruebas">
            <option value="">Seleccionar...</option>
            ${['Inspección Visual','Prueba de Medición','Prueba de Funcionamiento','Otro'].map(o =>
              `<option value="${o}" ${data?.tipo_pruebas===o?'selected':''}>${o}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group"><label>Estado en que se deja el equipo</label>
          <select id="f_estado_equipo">
            <option value="">Seleccionar...</option>
            ${['Equipo Operativo','Equipo en Pruebas','Equipo Fuera de Serv.','Equipo pendiente de Refacción','Otro'].map(o =>
              `<option value="${o}" ${data?.estado_equipo===o?'selected':''}>${o}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <!-- SECCIÓN: Preventivo -->
      <div class="form-section">
        <div class="form-section-title">🛡️ Acciones Preventivas</div>
        <div class="form-group"><label>Acciones Preventivas</label><textarea id="f_acciones" placeholder="Acciones preventivas realizadas...">${data?.acciones_preventivas||''}</textarea></div>
        <div class="form-group"><label>Herramienta / Material</label><textarea id="f_herramienta" placeholder="Herramientas y materiales utilizados...">${data?.herramienta_material||''}</textarea></div>
        <div class="form-group"><label>Refacciones</label><textarea id="f_refacciones" placeholder="Refacciones utilizadas...">${data?.refacciones||''}</textarea></div>
      </div>

      <!-- SECCIÓN: Responsables -->
      <div class="form-section">
        <div class="form-section-title">👤 Responsables</div>
        <div class="form-group"><label>Técnico Asignado</label><input id="f_tecnico" value="${data?.tecnico_asignado||user?.nombre||''}"></div>
        <div class="form-group"><label>Gerente de Mantenimiento</label><input id="f_gerente" value="${data?.gerente_mantenimiento||''}"></div>
        <div class="form-group"><label>Supervisor UO TIMT</label><input id="f_supervisor" value="${data?.supervisor_uo_timt||''}"></div>
      </div>

      <!-- SECCIÓN: Fotos -->
      ${isEdit ? `
      <div class="form-section">
        <div class="form-section-title">📸 Fotografías</div>
        <div class="photo-section">
          <div class="photo-section-title">🔴 ANTES (obligatorio: 2 fotos)</div>
          <div class="photo-grid" id="antes-grid"></div>
        </div>
        <div class="photo-section">
          <div class="photo-section-title" style="color:#2e7d32">🟢 DESPUÉS (obligatorio: 2 fotos)</div>
          <div class="photo-grid" id="despues-grid"></div>
        </div>
      </div>
      ` : ''}

      <div class="form-actions">
        <button class="btn-primary" id="btn-save">${isEdit ? '📤 ENVIAR REPORTE' : '➕ CREAR INCIDENCIA'}</button>
        ${isEdit ? '<button class="btn-secondary" onclick="showDashboard()">Cancelar</button>' : ''}
      </div>
    </div>
  `);

  // Build station selector
  const estGrid = $('estacion-grid');
  estacionesCache.forEach(e => {
    const btn = document.createElement('button');
    btn.className = `selector-btn ${e === selectedEstacion ? 'selected' : ''}`;
    btn.textContent = e;
    btn.onclick = () => { selectEstacion(e, isEdit); };
    estGrid.appendChild(btn);
  });

  // Build equipo selector (filtered by station if selected, or all)
  const equipGrid = $('equipo-grid');
  const equiposFiltrados = selectedEstacion
    ? tiposCache
    : tiposCache;
  equiposFiltrados.forEach(e => {
    const btn = document.createElement('button');
    btn.className = `selector-btn ${e === selectedEquipo ? 'selected' : ''}`;
    btn.textContent = e;
    btn.onclick = () => selectEquipo(e, isEdit);
    equipGrid.appendChild(btn);
  });

  // Build loc selector if both selected
  if (selectedEstacion && selectedEquipo) {
    loadLocSelectors(selectedEstacion, selectedEquipo, selectedLoc, isEdit);
  } else {
    $('loc-grid').innerHTML = '<div style="grid-column:1/-1;color:#999;font-size:12px;padding:8px">Selecciona estación y equipo primero</div>';
  }

  if (isEdit && data.fotos) {
    currentFotos = data.fotos || [];
    renderPhotos(currentFotos);
  }

  $('btn-save').onclick = () => saveForm(isEdit);
}

function selectEstacion(est, isEdit) {
  document.querySelectorAll('#estacion-grid .selector-btn').forEach(b => b.classList.toggle('selected', b.textContent === est));
  document.querySelectorAll('#equipo-grid .selector-btn').forEach(b => b.classList.remove('selected'));
  $('loc-grid').innerHTML = '<div style="grid-column:1/-1;color:#999;font-size:12px;padding:8px">Selecciona equipo</div>';
  // Reload equipo buttons with filtered list
  const eqGrid = $('equipo-grid');
  eqGrid.innerHTML = '';
  fetch(`${API}/api/locations?estacion=${encodeURIComponent(est)}`)
    .then(r => r.json())
    .then(() => {
      // Get equipos for this station from our local data or via API
      // Actually, let's just filter types - better approach: get distinct equipos for this station
      fetch(`${API}/api/locations?estacion=${encodeURIComponent(est)}`)
        .then(r => r.json())
        .catch(() => []);
    })
    .catch(() => {});

  // Simple: show all types but highlight those available
  tiposCache.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'selector-btn';
    btn.textContent = e;
    btn.onclick = () => selectEquipo(e, isEdit);
    eqGrid.appendChild(btn);
  });
}

function selectEquipo(equipo, isEdit) {
  document.querySelectorAll('#equipo-grid .selector-btn').forEach(b => b.classList.toggle('selected', b.textContent === equipo));
  const est = document.querySelector('#estacion-grid .selected')?.textContent;
  if (est) loadLocSelectors(est, equipo, '', isEdit);
}

async function loadLocSelectors(estacion, equipo, selectedLoc, isEdit) {
  const grid = $('loc-grid');
  grid.innerHTML = '<div class="loading" style="padding:8px;grid-column:1/-1">Cargando...</div>';
  try {
    const res = await fetch(`${API}/api/locations?estacion=${encodeURIComponent(estacion)}&equipo=${encodeURIComponent(equipo)}`);
    const locs = await res.json();
    if (!locs.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;color:#999;font-size:12px;padding:8px">Sin locations para esta combinación</div>';
      return;
    }
    grid.innerHTML = '';
    locs.forEach(l => {
      const btn = document.createElement('button');
      btn.className = `selector-btn ${l === selectedLoc ? 'selected' : ''}`;
      btn.textContent = l;
      btn.onclick = () => {
        document.querySelectorAll('#loc-grid .selector-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      };
      grid.appendChild(btn);
    });
  } catch(e) {
    grid.innerHTML = '<div style="grid-column:1/-1;color:#c62828;font-size:12px">Error al cargar locations</div>';
  }
}

function renderPhotos(fotos) {
  const antes = fotos.filter(f => f.tipo === 'antes');
  const despues = fotos.filter(f => f.tipo === 'despues');

  const antesGrid = $('antes-grid');
  antesGrid.innerHTML = '';
  for (let i = 0; i < 2; i++) {
    const f = antes[i];
    const slot = document.createElement('div');
    slot.className = `photo-slot ${f ? 'has-photo' : ''}`;
    if (f) {
      slot.innerHTML = `<img src="${f.url_foto}" alt="antes ${i+1}"><span class="badge-tipo">ANTES ${i+1}</span><button class="del-photo" data-id="${f.id}">×</button>`;
      slot.querySelector('.del-photo').onclick = (e) => { e.stopPropagation(); deletePhoto(f.id); };
      slot.onclick = () => replacePhoto('antes', i+1);
    } else {
      slot.innerHTML = `<div class="placeholder"><div class="icon">📷</div>Antes ${i+1}</div>`;
      slot.onclick = () => takePhoto('antes');
    }
    antesGrid.appendChild(slot);
  }

  const despuesGrid = $('despues-grid');
  despuesGrid.innerHTML = '';
  for (let i = 0; i < 2; i++) {
    const f = despues[i];
    const slot = document.createElement('div');
    slot.className = `photo-slot ${f ? 'has-photo' : ''}`;
    if (f) {
      slot.innerHTML = `<img src="${f.url_foto}" alt="despues ${i+1}"><span class="badge-tipo" style="background:#2e7d32">DESPUÉS ${i+1}</span><button class="del-photo" data-id="${f.id}">×</button>`;
      slot.querySelector('.del-photo').onclick = (e) => { e.stopPropagation(); deletePhoto(f.id); };
      slot.onclick = () => replacePhoto('despues', i+1);
    } else {
      slot.innerHTML = `<div class="placeholder"><div class="icon">📷</div>Después ${i+1}</div>`;
      slot.onclick = () => takePhoto('despues');
    }
    despuesGrid.appendChild(slot);
  }
}

let photoTipo = 'antes';
let currentFotos = [];

function takePhoto(tipo) {
  photoTipo = tipo;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.style = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  input.onchange = function(e) {
    if (e.target.files.length) {
      const file = e.target.files[0];
      compressImage(file, 800, 0.6, function(blob) {
        const blobUrl = URL.createObjectURL(blob);
        uploadPhoto(blob, blobUrl, tipo);
        document.body.removeChild(input);
      });
    }
  };
  document.body.appendChild(input);
  input.click();
}

function replacePhoto(tipo) {
  takePhoto(tipo);
}

function compressImage(file, maxDim, quality, callback) {
  if (file.type === 'image/gif' || file.size < 100 * 1024) { callback(file); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const r = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(function(blob) {
        callback(blob || file);
      }, 'image/jpeg', quality);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function uploadPhoto(file, blobUrl, tipo) {
  if (!file || !currentFolio) return;
  const tempId = Date.now();
  currentFotos.push({ id: tempId, url_foto: blobUrl, tipo });
  renderPhotos(currentFotos);
  const formData = new FormData();
  formData.append('foto', file, 'photo.jpg');
  formData.append('tipo', tipo);
  try {
    const res = await fetch(`${API}/api/upload/${currentFolio}`, { method:'POST', body: formData });
    const data = await res.json();
    currentFotos = currentFotos.filter(f => f.id !== tempId);
    currentFotos.push({ id: data.id || Date.now(), url_foto: data.url, tipo: data.tipo });
    renderPhotos(currentFotos);
    URL.revokeObjectURL(blobUrl);
  } catch(e) {
    alert('Error al subir foto');
  }
}

async function deletePhoto(id) {
  if (!confirm('¿Eliminar esta foto?')) return;
  try {
    await fetch(`${API}/api/fotos/${id}`, { method:'DELETE' });
    currentFotos = currentFotos.filter(f => f.id !== id);
    renderPhotos(currentFotos);
  } catch(e) {
    alert('Error al eliminar foto');
  }
}

async function saveForm(isEdit) {
  const estacion = document.querySelector('#estacion-grid .selected')?.textContent || '';
  const equipo = document.querySelector('#equipo-grid .selected')?.textContent || '';
  const loc_id = document.querySelector('#loc-grid .selected')?.textContent || '';

  if (!estacion || !equipo) {
    alert('Selecciona estación y equipo');
    return;
  }

  const body = {
    folio: $('f_folio')?.value.trim() || undefined,
    f_reporte: $('f_f_reporte')?.value || '',
    h_reporte: $('f_h_reporte')?.value || '',
    f_llegada: $('f_f_llegada')?.value || '',
    h_llegada: $('f_h_llegada')?.value || '',
    fecha_cierre: $('f_fecha_cierre')?.value || '',
    hora_cierre: $('f_hora_cierre')?.value || '',
    estacion, equipo, loc_id,
    falla_fecha_reporte: $('f_falla_fecha')?.value || '',
    como_fue_identificado: $('f_como_identificado')?.value || '',
    causa_raiz: $('f_causa_raiz')?.value || '',
    metodo_diagnostico: $('f_metodo_diagnostico')?.value || '',
    descripcion_correccion: $('f_desc_correccion')?.value || '',
    tipo_pruebas: $('f_tipo_pruebas')?.value || '',
    estado_equipo: $('f_estado_equipo')?.value || '',
    acciones_preventivas: $('f_acciones')?.value || '',
    herramienta_material: $('f_herramienta')?.value || '',
    refacciones: $('f_refacciones')?.value || '',
    tecnico_asignado: $('f_tecnico')?.value || user?.nombre || '',
    gerente_mantenimiento: $('f_gerente')?.value || '',
    supervisor_uo_timt: $('f_supervisor')?.value || '',
  };

  try {
    if (isEdit) {
      // Validate 4 photos required
      const fotos = currentFotos.length ? currentFotos : [];
      const antes = fotos.filter(f => f.tipo === 'antes').length;
      const despues = fotos.filter(f => f.tipo === 'despues').length;
      if (antes < 2 || despues < 2) {
        alert(`❌ Se requieren 2 fotos ANTES y 2 fotos DESPUÉS.\nActual: ${antes} antes, ${despues} después`);
        return;
      }

      body.estado = 'ENVIADO';
      await fetch(`${API}/api/incidencias/${currentFolio}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });

      // Auto-send report
      const envRes = await fetch(`${API}/api/incidencias/${currentFolio}/enviar`, { method:'POST' });
      const envData = await envRes.json();
      if (envData.success) alert('✅ Reporte enviado correctamente');
      else alert('✅ Reporte guardado. Configura el correo para envío automático.');

      showDashboard();
    } else {
      body.tecnico_correo = user?.correo || '';
      const res = await fetch(`${API}/api/incidencias`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const result = await res.json();
      currentFolio = result.folio;
      // After creation, go to edit mode so they can add photos
      showForm(result.folio);
    }
  } catch(e) {
    alert('Error al guardar: ' + e.message);
  }
}

// --- DETAIL ---
async function showDetail(folio) {
  currentFolio = folio;
  render(`
    <div class="header">
      <button class="btn-back" onclick="showDashboard()">←</button>
      <h1>INCIDENCIA</h1>
      <button class="btn-logout" onclick="showForm('${folio}')">✏️ Editar</button>
    </div>
    <div class="detail-screen" id="detail-content">
      <div class="loading">Cargando...</div>
    </div>
  `);

  try {
    const res = await fetch(`${API}/api/incidencias/${folio}`);
    const i = await res.json();
    if (i.error) throw new Error(i.error);

    const badge = i.estado === 'ENVIADO'
      ? '<span class="badge badge-listo">ENVIADO</span>'
      : '<span class="badge badge-proceso">BORRADOR</span>';

    let html = `
      <div class="detail-header">
        <div class="folio">${i.folio}</div>
      </div>
      <div class="detail-field"><div class="label">Estación</div><div class="value">${i.estacion||'—'}</div></div>
      <div class="detail-field"><div class="label">Equipo</div><div class="value">${i.equipo||'—'}</div></div>
      <div class="detail-field"><div class="label">Location ID</div><div class="value">${i.loc_id||'—'}</div></div>
      <div class="detail-field"><div class="label">Fecha Reporte / Hora</div><div class="value">${i.f_reporte||'—'} ${i.h_reporte||''}</div></div>
      <div class="detail-field"><div class="label">Fecha Llegada / Hora</div><div class="value">${i.f_llegada||'—'} ${i.h_llegada||''}</div></div>
      <div class="detail-field"><div class="label">Fecha Cierre / Hora</div><div class="value">${i.fecha_cierre||'—'} ${i.hora_cierre||''}</div></div>
      <div class="detail-field"><div class="label">Identificado por</div><div class="value">${i.como_fue_identificado||'—'}</div></div>
      <div class="detail-field"><div class="label">Causa Raíz</div><div class="value">${i.causa_raiz||'—'}</div></div>
      <div class="detail-field"><div class="label">Diagnóstico</div><div class="value">${i.metodo_diagnostico||'—'}</div></div>
      <div class="detail-field"><div class="label">Corrección</div><div class="value">${i.descripcion_correccion||'—'}</div></div>
      <div class="detail-field"><div class="label">Pruebas</div><div class="value">${i.tipo_pruebas||'—'}</div></div>
      <div class="detail-field"><div class="label">Estado del equipo</div><div class="value">${i.estado_equipo||'—'}</div></div>
      <div class="detail-field"><div class="label">Acciones Preventivas</div><div class="value">${i.acciones_preventivas||'—'}</div></div>
      <div class="detail-field"><div class="label">Herramienta/Material</div><div class="value">${i.herramienta_material||'—'}</div></div>
      <div class="detail-field"><div class="label">Refacciones</div><div class="value">${i.refacciones||'—'}</div></div>
      <div class="detail-field"><div class="label">Técnico</div><div class="value">${i.tecnico_asignado||'—'}</div></div>
      <div class="detail-field"><div class="label">Gerente Mantenimiento</div><div class="value">${i.gerente_mantenimiento||'—'}</div></div>
      <div class="detail-field"><div class="label">Supervisor UO TIMT</div><div class="value">${i.supervisor_uo_timt||'—'}</div></div>
    `;

    if (i.fotos && i.fotos.length) {
      const antes = i.fotos.filter(f => f.tipo === 'antes');
      const despues = i.fotos.filter(f => f.tipo === 'despues');

      if (antes.length) {
        html += `<div class="detail-field"><div class="label">🔴 ANTES (${antes.length})</div><div class="photo-grid">`;
        antes.forEach(f => { html += `<div class="photo-slot has-photo"><img src="${f.url_foto}" alt="antes"></div>`; });
        html += `</div></div>`;
      }
      if (despues.length) {
        html += `<div class="detail-field"><div class="label" style="color:#2e7d32">🟢 DESPUÉS (${despues.length})</div><div class="photo-grid">`;
        despues.forEach(f => { html += `<div class="photo-slot has-photo"><img src="${f.url_foto}" alt="despues"></div>`; });
        html += `</div></div>`;
      }
    }

    html += `<div class="detail-actions">
        <button class="btn-primary" onclick="showForm('${folio}')">✏️ EDITAR Y ENVIAR</button>
        <a href="${API}/api/incidencias/${folio}/pdf" target="_blank" class="btn-success" style="display:block;text-align:center;text-decoration:none;padding:11px;border-radius:8px;margin-bottom:4px">📄 DESCARGAR PDF</a>
        <a href="${API}/api/incidencias/${folio}/excel" target="_blank" class="btn-secondary" style="display:block;text-align:center;text-decoration:none;padding:11px;border-radius:8px;margin-bottom:4px;background:#555;color:#fff">📊 DESCARGAR EXCEL</a>
        <button class="btn-secondary" style="background:#333" onclick="enviarReporte('${folio}')">📧 Reenviar por correo</button>
      </div>`;

    $('detail-content').innerHTML = html;
  } catch(e) {
    const c = $('detail-content');
    if (c) c.innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

async function enviarReporte(folio) {
  try {
    const res = await fetch(`${API}/api/incidencias/${folio}/enviar`, { method:'POST' });
    const data = await res.json();
    if (data.success) alert('✅ Reporte enviado por correo');
    else alert('❌ Error: '+(data.error||'desconocido'));
  } catch(e) { alert('Error: '+e.message); }
}



// --- INIT ---
if (user) {
  loadCaches().then(() => showDashboard());
} else {
  showLogin();
}
