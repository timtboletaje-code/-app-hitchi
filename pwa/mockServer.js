(function () {
  // ===== Config =====
  const ADMIN_PASS = 'admin123';
  const DB_NAME = 'hitchi_local';

  // ===== Utilidades de formato (mismo formato que el servidor: UTC-6 México) =====
  function mxTimestamp() {
    const d = new Date(Date.now() - 6 * 60 * 60 * 1000);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0') + ' ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + ':' +
      String(d.getUTCSeconds()).padStart(2, '0');
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBase64(dataUrl) {
    const i = dataUrl.indexOf(',');
    return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  }

  // ===== IndexedDB =====
  let _dbPromise = null;
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('usuarios')) db.createObjectStore('usuarios', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('incidencias')) db.createObjectStore('incidencias', { keyPath: 'folio' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function dbReq(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const dbGet = (db, s, k) => dbReq(db, s, 'readonly', st => st.get(k));
  const dbPut = (db, s, v) => dbReq(db, s, 'readwrite', st => st.put(v));
  const dbDel = (db, s, k) => dbReq(db, s, 'readwrite', st => st.delete(k));
  const dbAll = (db, s) => dbReq(db, s, 'readonly', st => st.getAll());

  async function getAllUsuarios() { const db = await openDB(); return dbAll(db, 'usuarios'); }
  async function getAllIncidencias() { const db = await openDB(); return dbAll(db, 'incidencias'); }
  async function getIncidencia(folio) { const db = await openDB(); return dbGet(db, 'incidencias', folio); }
  async function putIncidencia(inc) { const db = await openDB(); return dbPut(db, 'incidencias', inc); }
  async function delIncidencia(folio) { const db = await openDB(); return dbDel(db, 'incidencias', folio); }
  async function putUsuario(u) { const db = await openDB(); return dbPut(db, 'usuarios', u); }
  async function delUsuario(id) { const db = await openDB(); return dbDel(db, 'usuarios', id); }

  // Mapea fotos almacenadas (con blob) a fotos con url_foto (objectURL)
  const _photoUrlCache = {};
  function mapFotos(fotos) {
    if (!fotos) return [];
    const out = [];
    for (const f of fotos) {
      let url = _photoUrlCache[f.id];
      if (!url) {
        url = URL.createObjectURL(f.blob);
        _photoUrlCache[f.id] = url;
      }
      out.push({ id: f.id, tipo: f.tipo, url_foto: url });
    }
    return out;
  }
  function revokeFotoUrl(id) {
    if (_photoUrlCache[id]) { try { URL.revokeObjectURL(_photoUrlCache[id]); } catch (e) {} delete _photoUrlCache[id]; }
  }

  function toIncidenciaView(inc) {
    const { fotos, ...rest } = inc;
    const view = { ...rest, fotos: mapFotos(fotos || []) };
    return view;
  }

  // ===== Descargas =====
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ===== PDF (port exacto de server.js, pdfkit 0.13.0) =====
  async function generarPDFLocal(inc) {
    const fotos = (inc.fotos || []).map(f => ({ tipo: f.tipo, data: null }));
    const dataUrls = [];
    for (const f of (inc.fotos || [])) dataUrls.push({ tipo: f.tipo, data: await blobToDataURL(f.blob) });
    const antes = dataUrls.filter(f => f.tipo === 'antes');
    const despues = dataUrls.filter(f => f.tipo === 'despues');

    const PDFDocument = window.PDFDocument;
    const doc = new PDFDocument({ margin: 30, size: 'LETTER' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));

    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
      doc.on('error', reject);
    });

    const M = 30, W = 552, PH = 792, rowH = 14, smallH = 12;

    const logoIzq = window.LOGO_IZQ;
    const logoDer = window.LOGO_DER;
    if (logoIzq) try { doc.image(logoIzq, M, 12, { width: 50 }); } catch (e) {}
    if (logoDer) try { doc.image(logoDer, M + W - 50, 12, { width: 50 }); } catch (e) {}

    let y = 45;
    const pageBottom = PH - 30;

    function drawSectionTitle(title, ypos) {
      doc.rect(M, ypos, W, 14).fill('#CC0000');
      doc.fill('#FFFFFF').fontSize(7).font('Helvetica-Bold').text(title, M + 5, ypos + 3);
    }

    function drawCheckbox(x, ypos, label, checked, w) {
      const size = 8;
      doc.rect(x, ypos, size, size).stroke('#000');
      if (checked) {
        doc.lineWidth(1.8).moveTo(x + 1.5, ypos + 1.5).lineTo(x + size - 1.5, ypos + size - 1.5).stroke('#000');
        doc.lineWidth(1.8).moveTo(x + size - 1.5, ypos + 1.5).lineTo(x + 1.5, ypos + size - 1.5).stroke('#000');
        doc.lineWidth(0.5);
      }
      doc.fill('#000').fontSize(6.5).font('Helvetica').text(label, x + size + 4, ypos + 0.5, { width: (w || 80) - size - 4 });
    }

    function drawTextLabel(x, ypos, w, h, label, value) {
      doc.rect(x, ypos, w, h).stroke('#cccccc');
      doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text(label, x + 2, ypos + 1, { width: w - 4 });
      if (value) doc.fill('#000').fontSize(6.5).font('Helvetica').text(value, x + 2, ypos + 7, { width: w - 4 });
    }

    doc.fontSize(6.5).font('Helvetica').fill('#555555').text(`Fecha: ${inc.f_reporte || ''}`, M, y, { width: W, align: 'right' });
    y += 3;
    doc.fontSize(9).font('Helvetica-Bold').fill('#000000').text('Reporte de Atención de Incidencia Mantenimiento Correctivo Versión 4', M, y, { width: W, align: 'center' });
    y += 14;

    drawSectionTitle('DATOS GENERALES', y); y += 14;
    const col3 = W / 3;
    drawTextLabel(M, y, col3 - 2, rowH, 'Fecha de Reporte', inc.f_reporte);
    drawTextLabel(M + col3, y, col3 - 2, rowH, 'Fecha de Llegada', inc.f_llegada);
    drawTextLabel(M + col3 * 2, y, col3, rowH, 'Fecha de Cierre', inc.fecha_cierre); y += rowH;
    drawTextLabel(M, y, col3 - 2, rowH, 'Hora de Reporte', inc.h_reporte);
    drawTextLabel(M + col3, y, col3 - 2, rowH, 'Hora de Llegada', inc.h_llegada);
    drawTextLabel(M + col3 * 2, y, col3, rowH, 'Hora de Cierre', inc.hora_cierre); y += rowH;

    const col4 = W / 4;
    drawTextLabel(M, y, col4 - 2, rowH, 'Equipo', inc.equipo);
    drawTextLabel(M + col4, y, col4 - 2, rowH, 'Location ID', inc.loc_id);
    drawTextLabel(M + col4 * 2, y, col4 - 2, rowH, 'Folio', inc.folio);
    drawTextLabel(M + col4 * 3, y, col4, rowH, 'Estación', inc.estacion); y += rowH + 2;

    drawSectionTitle('DESCRIPCIÓN DE LA FALLA', y); y += 14;
    drawTextLabel(M, y, W, smallH, 'Fecha de Reporte', inc.falla_fecha_reporte); y += smallH;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Como fue identificado el Fallo', M + 2, y + 1, { width: 130 });
    let cx = M + 132;
    ['CCO', 'MAU', 'Recorrido Técnico', 'Jefe de Estación', 'Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, inc.como_fue_identificado === o, 80); cx += 80; });
    y += smallH + 2;

    drawSectionTitle('DIAGNÓSTICO', y); y += 14;
    doc.rect(M, y, W, 24).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Causa raíz del fallo', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(inc.causa_raiz || '', M + 2, y + 9, { width: W - 4 }); y += 24;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Metodo Utilizado de Diagnóstico', M + 2, y + 1, { width: 145 });
    cx = M + 147;
    ['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, inc.metodo_diagnostico === o, 95); cx += 95; });
    y += smallH + 2;

    drawSectionTitle('ACCIONES CORRECTIVAS EJECUTADAS', y); y += 14;
    doc.rect(M, y, W, 24).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Descripción de la Corrección', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(inc.descripcion_correccion || '', M + 2, y + 9, { width: W - 4 }); y += 24;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Tipo de Pruebas realizadas', M + 2, y + 1, { width: 130 });
    cx = M + 132;
    ['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, inc.tipo_pruebas === o, 95); cx += 95; });
    y += smallH + 2;

    drawSectionTitle('RESULTADOS', y); y += 14;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Estado en que se deja el equipo', M + 2, y + 1, { width: 145 });
    cx = M + 147;
    ['Equipo Operativo', 'Equipo en Pruebas', 'Equipo Fuera de Serv.', 'Equipo pendiente de Refacción', 'Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, inc.estado_equipo === o, 78); cx += 80; });
    y += smallH + 2;

    drawSectionTitle('ACCIONES PREVENTIVAS SUGERIDAS', y); y += 14;
    doc.rect(M, y, W, 22).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Acciones preventivas', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(inc.acciones_preventivas || '', M + 2, y + 9, { width: W - 4 }); y += 22;

    drawSectionTitle('HERRAMIENTAS Y/O MATERIAL UTILIZADO', y); y += 14;
    doc.rect(M, y, W, 20).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Herramienta / Material', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(inc.herramienta_material || '', M + 2, y + 9, { width: W - 4 }); y += 20;
    doc.rect(M, y, W, 18).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Refacciones', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(inc.refacciones || '', M + 2, y + 9, { width: W - 4 }); y += 18;

    const antesF = antes;
    const despuesF = despues;
    const fotoSectionY = y;
    drawSectionTitle('REPORTE FOTOGRÁFICO', y); y += 16;
    doc.fill('#CC0000').fontSize(7).font('Helvetica-Bold').text('ANTES', M + 2, y);
    doc.fill('#2e7d32').fontSize(7).font('Helvetica-Bold').text('DESPUÉS', M + (W - 8) / 2 + 10, y);
    y += 10;
    const halfW = (W - 8) / 2;
    const cellW = (halfW - 4) / 2;
    const remainingH = pageBottom - y - 65;
    const photoSectionH = Math.max(100, remainingH);
    const cellH = photoSectionH / 2;

    for (let i = 0; i < 4; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const px = M + col * (cellW + 4);
      const py = y + row * cellH;
      if (i < antesF.length && antesF[i].data) {
        try { doc.image(antesF[i].data, px + 1, py + 1, { fit: [cellW - 2, cellH - 2] }); } catch (e) {}
      }
      doc.rect(px, py, cellW, cellH).stroke('#cccccc');
    }
    for (let i = 0; i < 4; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const px = M + halfW + 10 + col * (cellW + 4);
      const py = y + row * cellH;
      if (i < despuesF.length && despuesF[i].data) {
        try { doc.image(despuesF[i].data, px + 1, py + 1, { fit: [cellW - 2, cellH - 2] }); } catch (e) {}
      }
      doc.rect(px, py, cellW, cellH).stroke('#cccccc');
    }
    y += photoSectionH + 3;

    y += 6;
    const blockW = (W - 30) / 3;
    const starts = [M, M + blockW + 15, M + 2 * (blockW + 15)];
    [
      { role: 'Técnico', name: inc.tecnico_asignado || '' },
      { role: 'Gerente de Mantenimiento', name: inc.gerente_mantenimiento || '' },
      { role: 'Supervisor UO-TIMT', name: inc.supervisor_uo_timt || '' }
    ].forEach((s, idx) => {
      const x = starts[idx];
      const lineW = blockW - 10;
      doc.fill('#000').fontSize(7.5).font('Helvetica').text(s.name, x, y, { width: lineW, align: 'center' });
      doc.moveTo(x, y + 12).lineTo(x + lineW, y + 12).stroke('#333');
      doc.fill('#555').fontSize(6.5).font('Helvetica-Bold').text(s.role, x, y + 16, { width: lineW, align: 'center' });
      doc.fill('#888').fontSize(5.5).font('Helvetica-Oblique').text('Nombre y Firma', x, y + 26, { width: lineW, align: 'center' });
    });
    y += 44;
    doc.fill('#999').fontSize(5.5).font('Helvetica').text('©Hitachi 2025 All Rights Reserved', M, y, { width: W, align: 'center' });
    doc.end();

    return done;
  }

  async function descargarPDF(folio) {
    const inc = await getIncidencia(folio);
    if (!inc) throw new Error('No encontrado');
    const blob = await generarPDFLocal(inc);
    downloadBlob(blob, `reporte-${folio}.pdf`);
  }

  // ===== Excel (port exacto de server.js) =====
  async function generarExcelLocal(inc) {
    const fotos = inc.fotos || [];
    const dataUrls = [];
    for (const f of fotos) dataUrls.push({ tipo: f.tipo, data: await blobToDataURL(f.blob) });
    const antes = dataUrls.filter(f => f.tipo === 'antes');
    const despues = dataUrls.filter(f => f.tipo === 'despues');

    const ExcelJS = window.ExcelJS;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'App Hitchi';
    const ws = wb.addWorksheet('Reporte', {
      pageSetup: { paperSize: 9, orientation: 'portrait', margins: { left: 0.4, right: 0.4, top: 0.3, bottom: 0.3 } }
    });

    const R = 'FFCC0000';
    const G = 'FFF2F2F2';

    ws.columns = [
      { width: 1 }, { width: 1 },
      { width: 16 }, { width: 12 },
      { width: 0.8 }, { width: 16 }, { width: 12 },
      { width: 0.8 }, { width: 16 }, { width: 12 },
      { width: 0.8 }, { width: 16 }, { width: 12 },
      { width: 1 },
    ];

    function addBorder(r, c1, c2) {
      for (let c = c1; c <= c2; c++) {
        const cell = ws.getCell(r, c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    }

    let r = 1;

    function c(r, c, val, opts = {}) {
      const cell = ws.getCell(r, c);
      cell.value = val;
      cell.alignment = {
        wrapText: true,
        vertical: 'middle',
        horizontal: opts.align || (typeof val === 'number' ? 'right' : 'left'),
      };
      const font = { size: opts.fontSize || 8 };
      if (opts.bold) font.bold = true;
      if (opts.color) font.color = { argb: opts.color };
      if (opts.fontSize) font.size = opts.fontSize;
      cell.font = font;
      if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
      return cell;
    }

    function pair(label, value, col, opts = {}) {
      c(r, col, label, { bold: true, fill: G, fontSize: 6, align: 'center' });
      c(r, col + 1, value || '', { fontSize: 7, align: 'center' });
      addBorder(r, col, col + 1);
    }

    function trio(l1, v1, l2, v2, l3, v3) {
      pair(l1, v1, 3);
      pair(l2, v2, 6);
      pair(l3, v3, 9);
      r++;
    }

    function sectionHeader(label) {
      ws.mergeCells(r, 2, r, 13);
      c(r, 2, label, { bold: true, fill: R, color: 'FFFFFF', fontSize: 8, align: 'center' });
      ws.getRow(r).height = 16;
      r++;
    }

    function checkboxRow(options, selected, labelCol) {
      c(r, labelCol || 3, '', { fill: G });
      addBorder(r, labelCol || 3, labelCol || 3);
      let col = 4;
      options.forEach(o => {
        const chk = selected === o ? '☑' : '☐';
        const ncol = Math.min(3, Math.max(1, Math.ceil(o.length / 11)));
        const endCol = Math.min(col + ncol - 1, 12);
        if (ncol > 1) try { ws.mergeCells(r, col, r, endCol); } catch (e) {}
        c(r, col, `${chk} ${o}`, { fontSize: 6, align: 'center' });
        addBorder(r, col, endCol);
        col = endCol + 1;
      });
      while (col <= 12) { addBorder(r, col, col); col++; }
      r++;
    }

    ws.mergeCells(r, 3, r, 12);
    c(r, 3, `Fecha: ${inc.f_reporte || ''}`, { fontSize: 6, align: 'right' }); r++;
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, 'Reporte de Atención de Incidencia Mantenimiento Correctivo Versión 4', { fontSize: 10, bold: true, align: 'center' });
    ws.getRow(r).height = 20;
    r++;

    sectionHeader('DATOS GENERALES');
    trio('Fecha de Reporte', inc.f_reporte, 'Fecha de Llegada', inc.f_llegada, 'Fecha de Cierre', inc.fecha_cierre);
    trio('Hora de Reporte', inc.h_reporte, 'Hora de Llegada', inc.h_llegada, 'Hora de Cierre', inc.hora_cierre);
    trio('Equipo', inc.equipo, 'Location ID', inc.loc_id, 'Folio', inc.folio);
    pair('Estación', inc.estacion || '', 3);
    r++;

    sectionHeader('DESCRIPCIÓN DE LA FALLA');
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, inc.falla_fecha_reporte || '', { fontSize: 6, fill: 'FFF9F9F9' });
    addBorder(r, 3, 12);
    r++;
    c(r, 3, 'Como fue identificado el Fallo', { bold: true, fill: G, fontSize: 6 });
    addBorder(r, 3, 3);
    checkboxRow(['CCO', 'MAU', 'Recorrido Técnico', 'Jefe de Estación', 'Otro'], inc.como_fue_identificado);

    sectionHeader('DIAGNÓSTICO');
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, inc.causa_raiz || '', { fontSize: 6 });
    addBorder(r, 3, 12);
    ws.getRow(r).height = 22;
    r++;
    c(r, 3, 'Metodo Utilizado de Diagnóstico', { bold: true, fill: G, fontSize: 6 });
    addBorder(r, 3, 3);
    checkboxRow(['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'], inc.metodo_diagnostico);

    sectionHeader('ACCIONES CORRECTIVAS EJECUTADAS');
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, inc.descripcion_correccion || '', { fontSize: 6 });
    addBorder(r, 3, 12);
    ws.getRow(r).height = 22;
    r++;
    c(r, 3, 'Tipo de Pruebas realizadas', { bold: true, fill: G, fontSize: 6 });
    addBorder(r, 3, 3);
    checkboxRow(['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'], inc.tipo_pruebas);

    sectionHeader('RESULTADOS');
    c(r, 3, 'Estado en que se deja el equipo', { bold: true, fill: G, fontSize: 6 });
    addBorder(r, 3, 3);
    checkboxRow(['Equipo Operativo', 'Equipo en Pruebas', 'Equipo Fuera de Serv.', 'Equipo pendiente de Refacción', 'Otro'], inc.estado_equipo);

    sectionHeader('ACCIONES PREVENTIVAS SUGERIDAS');
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, inc.acciones_preventivas || '', { fontSize: 6 });
    addBorder(r, 3, 12);
    ws.getRow(r).height = 20;
    r++;

    sectionHeader('HERRAMIENTAS Y/O MATERIAL UTILIZADO');
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, inc.herramienta_material || '', { fontSize: 6 });
    addBorder(r, 3, 12);
    ws.getRow(r).height = 20;
    r++;
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, inc.refacciones || '', { fontSize: 6 });
    addBorder(r, 3, 12);
    ws.getRow(r).height = 18;
    r++;

    sectionHeader('REPORTE FOTOGRÁFICO');
    const rowH = 70;
    const cellH = 70;

    function colLetter(n) {
      let s = '';
      while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
      return s || 'A';
    }

    for (let i = 0; i < 4; i++) {
      const row = Math.floor(i / 2);
      const col = 3 + (i % 2) * 2;
      const rr = r + row;
      if (i < antes.length && antes[i].data) {
        try {
          const img = wb.addImage({ base64: dataURLToBase64(antes[i].data), extension: 'png' });
          ws.addImage(img, `${colLetter(col)}${rr}:${colLetter(col + 1)}${rr}`);
        } catch (e) {}
      }
      ws.mergeCells(rr, col, rr, col + 1);
      c(rr, col, i < antes.length ? '' : '—', { fontSize: 5, align: 'center', fill: 'FFF5F5F5' });
      addBorder(rr, col, col + 1);
      ws.getRow(rr).height = rowH;
    }
    for (let i = 0; i < 4; i++) {
      const row = Math.floor(i / 2);
      const col = 9 + (i % 2) * 2;
      const rr = r + row;
      if (i < despues.length && despues[i].data) {
        try {
          const img = wb.addImage({ base64: dataURLToBase64(despues[i].data), extension: 'png' });
          ws.addImage(img, `${colLetter(col)}${rr}:${colLetter(col + 1)}${rr}`);
        } catch (e) {}
      }
      ws.mergeCells(rr, col, rr, col + 1);
      c(rr, col, i < despues.length ? '' : '—', { fontSize: 5, align: 'center', fill: 'FFF5F5F5' });
      addBorder(rr, col, col + 1);
      ws.getRow(rr).height = rowH;
    }
    r += 2;

    const sigs = [
      { role: 'Técnico', name: inc.tecnico_asignado || '' },
      { role: 'Gerente de Mantenimiento', name: inc.gerente_mantenimiento || '' },
      { role: 'Supervisor UO-TIMT', name: inc.supervisor_uo_timt || '' }
    ];
    sigs.forEach((s, idx) => {
      const baseCol = 3 + idx * 4;
      try { ws.mergeCells(r, baseCol, r, baseCol + 1); } catch (e) {}
      c(r, baseCol, s.name, { fontSize: 8, align: 'center' });
      try { ws.mergeCells(r + 1, baseCol, r + 1, baseCol + 1); } catch (e) {}
      ws.getCell(r + 1, baseCol).border = { bottom: { style: 'medium', color: { argb: 'FF333333' } } };
      addBorder(r + 1, baseCol, baseCol + 1);
      try { ws.mergeCells(r + 2, baseCol, r + 2, baseCol + 1); } catch (e) {}
      c(r + 2, baseCol, s.role, { bold: true, fontSize: 7, color: '555555', align: 'center' });
      try { ws.mergeCells(r + 3, baseCol, r + 3, baseCol + 1); } catch (e) {}
      c(r + 3, baseCol, 'Nombre y Firma', { fontSize: 6, color: '888888', align: 'center' });
    });
    r += 5;
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, '©Hitachi 2025 All Rights Reserved', { fontSize: 5, color: '999999', align: 'center' });

    return wb;
  }

  async function descargarExcel(folio) {
    const inc = await getIncidencia(folio);
    if (!inc) throw new Error('No encontrado');
    const wb = await generarExcelLocal(inc);
    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `reporte-${folio}.xlsx`);
  }

  async function descargarExcelCompleto() {
    const all = await getAllIncidencias();
    const ExcelJS = window.ExcelJS;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'App Hitchi';
    const ws = wb.addWorksheet('Todos los reportes');
    const columns = [
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'Fecha', key: 'f_reporte', width: 12 },
      { header: 'Estación', key: 'estacion', width: 16 },
      { header: 'Equipo', key: 'equipo', width: 20 },
      { header: 'Location ID', key: 'loc_id', width: 12 },
      { header: 'Técnico', key: 'tecnico_asignado', width: 18 },
      { header: 'Estado', key: 'estado', width: 12 },
      { header: 'Revisado', key: 'revisado', width: 10 },
      { header: 'Identificado', key: 'como_fue_identificado', width: 18 },
      { header: 'Causa Raíz', key: 'causa_raiz', width: 25 },
      { header: 'Diagnóstico', key: 'metodo_diagnostico', width: 18 },
      { header: 'Corrección', key: 'descripcion_correccion', width: 25 },
      { header: 'Pruebas', key: 'tipo_pruebas', width: 18 },
      { header: 'Estado Equipo', key: 'estado_equipo', width: 18 },
      { header: 'Acciones Preventivas', key: 'acciones_preventivas', width: 25 },
      { header: 'Herramienta', key: 'herramienta_material', width: 20 },
      { header: 'Refacciones', key: 'refacciones', width: 20 },
      { header: 'Gerente', key: 'gerente_mantenimiento', width: 18 },
      { header: 'Supervisor', key: 'supervisor_uo_timt', width: 18 },
      { header: 'Nota Supervisión', key: 'nota_supervision', width: 25 },
    ];
    ws.columns = columns;
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } };
    headerRow.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    all.forEach(row => {
      const { fotos, ...rest } = row;
      ws.addRow(rest);
    });
    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'todos-los-reportes.xlsx');
  }

  // ===== Endpoints locales (fetch mock) =====
  const API_RE = {
    login: /^\/api\/login$/,
    loginAdmin: /^\/api\/login-admin$/,
    estaciones: /^\/api\/estaciones$/,
    tiposEquipo: /^\/api\/tipos-equipo$/,
    tecnicos: /^\/api\/tecnicos$/,
    usuarios: /^\/api\/usuarios$/,
    usuariosToggle: /^\/api\/usuarios\/(\d+)\/toggle$/,
    usuariosDelete: /^\/api\/usuarios\/(\d+)$/,
    equiposPorEstacion: /^\/api\/equipos-por-estacion$/,
    locations: /^\/api\/locations$/,
    incidencias: /^\/api\/incidencias$/,
    incidencia: /^\/api\/incidencias\/([^/]+)$/,
    upload: /^\/api\/upload\/([^/]+)$/,
    fotosDelete: /^\/api\/fotos\/(\d+)$/,
    pdf: /^\/api\/incidencias\/([^/]+)\/pdf$/,
    excel: /^\/api\/incidencias\/([^/]+)\/excel$/,
    excelCompleto: /^\/api\/excel-completo$/,
    enviar: /^\/api\/incidencias\/([^/]+)\/enviar$/,
  };

  function jsonResponse(data, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      blob: () => Promise.resolve(new Blob([JSON.stringify(data)], { type: 'application/json' })),
    });
  }

  async function handleApi(urlStr, opts) {
    const method = (opts.method || 'GET').toUpperCase();
    let path = urlStr;
    let pathname = urlStr;
    let urlObj = null;
    try {
      urlObj = new URL(urlStr, location.href);
      pathname = urlObj.pathname;
      path = urlObj.pathname + urlObj.search;
    } catch (e) {}

    // LOGIN
    if (API_RE.login.test(pathname) && method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      const nombre = (body.nombre || '').trim();
      if (!nombre) return jsonResponse({ error: 'Nombre requerido' }, 400);
      const users = await getAllUsuarios();
      const u = users.find(x => x.nombre === nombre && x.rol === 'tecnico' && x.activo == 1);
      if (!u) return jsonResponse({ error: 'Usuario no autorizado' }, 401);
      return jsonResponse(u);
    }

    // LOGIN ADMIN
    if (API_RE.loginAdmin.test(pathname) && method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      const nombre = (body.nombre || '').trim();
      if (!nombre) return jsonResponse({ error: 'Nombre requerido' }, 400);
      if (body.password !== ADMIN_PASS) return jsonResponse({ error: 'Contraseña incorrecta' }, 401);
      let users = await getAllUsuarios();
      let u = users.find(x => x.nombre === nombre && x.rol === 'admin');
      if (!u) {
        u = { id: Date.now(), nombre, rol: 'admin', activo: 1 };
        await putUsuario(u);
      }
      return jsonResponse(u);
    }

    // CACHES
    if (API_RE.estaciones.test(pathname)) {
      const est = [...new Set(window.EQUIPOS.map(e => e.estacion))].sort();
      return jsonResponse(est);
    }
    if (API_RE.tiposEquipo.test(pathname)) {
      const tipos = [...new Set(window.EQUIPOS.map(e => e.equipo))].sort();
      return jsonResponse(tipos);
    }
    if (API_RE.tecnicos.test(pathname)) {
      const users = await getAllUsuarios();
      return jsonResponse(users.filter(u => u.rol === 'tecnico' && u.activo == 1).map(u => ({ nombre: u.nombre })));
    }

    // USUARIOS
    if (API_RE.usuarios.test(pathname) && method === 'GET') {
      const users = await getAllUsuarios();
      return jsonResponse(users.map(u => ({ id: u.id, nombre: u.nombre, rol: u.rol, activo: u.activo })));
    }
    if (API_RE.usuarios.test(pathname) && method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      const nombre = (body.nombre || '').trim();
      if (!nombre) return jsonResponse({ error: 'Nombre requerido' }, 400);
      const users = await getAllUsuarios();
      if (!users.some(u => u.nombre === nombre)) {
        await putUsuario({ id: Date.now(), nombre, rol: 'tecnico', activo: 1 });
      }
      return jsonResponse({ success: true });
    }
    let m = pathname.match(API_RE.usuariosToggle);
    if (m && method === 'PUT') {
      const users = await getAllUsuarios();
      const u = users.find(x => String(x.id) === m[1] && x.rol === 'tecnico');
      if (u) { u.activo = u.activo == 1 ? 0 : 1; await putUsuario(u); }
      return jsonResponse({ success: true });
    }
    m = pathname.match(API_RE.usuariosDelete);
    if (m && method === 'DELETE') {
      const users = await getAllUsuarios();
      const u = users.find(x => String(x.id) === m[1] && x.rol === 'tecnico');
      if (u) await delUsuario(u.id);
      return jsonResponse({ success: true });
    }

    // SELECTORES
    if (API_RE.equiposPorEstacion.test(pathname)) {
      const est = new URL(path, location.href).searchParams.get('estacion');
      if (!est) return jsonResponse([...new Set(window.EQUIPOS.map(e => e.equipo))].sort());
      const tipos = [...new Set(window.EQUIPOS.filter(e => e.estacion === est).map(e => e.equipo))].sort();
      return jsonResponse(tipos);
    }
    if (API_RE.locations.test(pathname)) {
      const sp = new URL(path, location.href).searchParams;
      const est = sp.get('estacion'), eq = sp.get('equipo');
      let r = window.EQUIPOS;
      if (est) r = r.filter(e => e.estacion === est);
      if (eq) r = r.filter(e => e.equipo === eq);
      return jsonResponse(r.map(e => e.loc_id));
    }

    // INCIDENCIAS CRUD
    if (API_RE.incidencias.test(pathname) && method === 'POST') {
      const d = JSON.parse(opts.body || '{}');
      if (!d.estacion || !d.equipo) return jsonResponse({ error: 'Estación y equipo requeridos' }, 400);
      const folio = d.folio || 'HIT-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const inc = {
        folio,
        f_reporte: d.f_reporte || new Date().toISOString().split('T')[0],
        h_reporte: d.h_reporte || '', f_llegada: d.f_llegada || '', h_llegada: d.h_llegada || '',
        fecha_cierre: d.fecha_cierre || '', hora_cierre: d.hora_cierre || '',
        estacion: d.estacion, equipo: d.equipo, loc_id: d.loc_id || '',
        falla_fecha_reporte: d.falla_fecha_reporte || '', como_fue_identificado: d.como_fue_identificado || '',
        causa_raiz: d.causa_raiz || '', metodo_diagnostico: d.metodo_diagnostico || '',
        descripcion_correccion: d.descripcion_correccion || '', tipo_pruebas: d.tipo_pruebas || '',
        estado_equipo: d.estado_equipo || '', acciones_preventivas: d.acciones_preventivas || '',
        herramienta_material: d.herramienta_material || '', refacciones: d.refacciones || '',
        tecnico_asignado: d.tecnico_asignado || '', gerente_mantenimiento: d.gerente_mantenimiento || '',
        supervisor_uo_timt: d.supervisor_uo_timt || '',
        estado: d.estado || 'EN PROCESO', revisado: d.revisado || 0, nota_supervision: d.nota_supervision || '',
        created_at: mxTimestamp(),
        fotos: [],
      };
      await putIncidencia(inc);
      return jsonResponse({ folio });
    }

    if (API_RE.incidencias.test(pathname) && method === 'GET') {
      const sp = new URL(path, location.href).searchParams;
      let rows = await getAllIncidencias();
      const tecnico = sp.get('tecnico'), estacion = sp.get('estacion'), estado = sp.get('estado'),
        fechaD = sp.get('fecha_desde'), fechaH = sp.get('fecha_hasta');
      if (tecnico) rows = rows.filter(r => r.tecnico_asignado === tecnico);
      if (estacion) rows = rows.filter(r => r.estacion === estacion);
      if (estado) rows = rows.filter(r => r.estado === estado);
      if (fechaD) rows = rows.filter(r => r.f_reporte >= fechaD);
      if (fechaH) rows = rows.filter(r => r.f_reporte <= fechaH);
      rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return jsonResponse(rows.map(toIncidenciaView));
    }

    m = pathname.match(API_RE.incidencia);
    if (m && method === 'GET') {
      const inc = await getIncidencia(m[1]);
      if (!inc) return jsonResponse({ error: 'No encontrado' }, 404);
      return jsonResponse(toIncidenciaView(inc));
    }
    if (m && method === 'PUT') {
      const body = JSON.parse(opts.body || '{}');
      const inc = await getIncidencia(m[1]);
      if (!inc) return jsonResponse({ error: 'No encontrado' }, 404);
      const fields = ['f_reporte', 'h_reporte', 'f_llegada', 'h_llegada', 'fecha_cierre', 'hora_cierre', 'estacion', 'equipo', 'loc_id', 'falla_fecha_reporte', 'como_fue_identificado', 'causa_raiz', 'metodo_diagnostico', 'descripcion_correccion', 'tipo_pruebas', 'estado_equipo', 'acciones_preventivas', 'herramienta_material', 'refacciones', 'tecnico_asignado', 'gerente_mantenimiento', 'supervisor_uo_timt', 'estado', 'revisado', 'nota_supervision'];
      let target = inc;
      if (body.folio && body.folio !== inc.folio) {
        delete inc.folio;
        target = { ...inc, folio: body.folio };
        await delIncidencia(m[1]);
      }
      fields.forEach(f => { if (body[f] !== undefined) target[f] = body[f]; });
      await putIncidencia(target);
      return jsonResponse({ success: true });
    }

    // UPLOAD FOTO
    m = pathname.match(API_RE.upload);
    if (m && method === 'POST') {
      const inc = await getIncidencia(m[1]);
      if (!inc) return jsonResponse({ error: 'No encontrado' }, 404);
      const fd = opts.body; // FormData
      const file = fd.get('foto');
      const tipo = fd.get('tipo') || 'general';
      if (!file) return jsonResponse({ error: 'No se recibió imagen' }, 400);
      const id = Date.now();
      inc.fotos = inc.fotos || [];
      inc.fotos.push({ id, tipo, blob: file });
      await putIncidencia(inc);
      const url = URL.createObjectURL(file);
      _photoUrlCache[id] = url;
      return jsonResponse({ id, url, tipo });
    }

    // DELETE FOTO
    m = pathname.match(API_RE.fotosDelete);
    if (m && method === 'DELETE') {
      const all = await getAllIncidencias();
      for (const inc of all) {
        const before = (inc.fotos || []).length;
        inc.fotos = (inc.fotos || []).filter(f => String(f.id) !== m[1]);
        if (inc.fotos.length !== before) { await putIncidencia(inc); break; }
      }
      revokeFotoUrl(parseInt(m[1]));
      return jsonResponse({ success: true });
    }

    // PDF
    m = pathname.match(API_RE.pdf);
    if (m && method === 'GET') {
      await descargarPDF(m[1]);
      return jsonResponse({ success: true });
    }

    // EXCEL individual
    m = pathname.match(API_RE.excel);
    if (m && method === 'GET') {
      await descargarExcel(m[1]);
      return jsonResponse({ success: true });
    }

    // EXCEL completo
    if (API_RE.excelCompleto.test(pathname)) {
      await descargarExcelCompleto();
      return jsonResponse({ success: true });
    }

    // ENVIAR (sin correo en local: genera y descarga PDF)
    m = pathname.match(API_RE.enviar);
    if (m && method === 'POST') {
      try { await descargarPDF(m[1]); return jsonResponse({ success: true }); }
      catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    return jsonResponse({ error: 'Not Found' }, 404);
  }

  // ===== Interceptar fetch =====
  const realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    const urlStr = typeof url === 'string' ? url : url.url;
    if (urlStr.startsWith('/api/')) {
      return handleApi(urlStr, opts || {});
    }
    return realFetch(url, opts);
  };

  // Exponer descargas para app.js
  window.descargarPDF = descargarPDF;
  window.descargarExcel = descargarExcel;
  window.descargarExcelCompleto = descargarExcelCompleto;
  window.generarPDFLocal = generarPDFLocal;
  window.generarExcelLocal = generarExcelLocal;

  // ===== Seed usuarios =====
  async function seed() {
    const db = await openDB();
    const users = await dbAll(db, 'usuarios');
    if (!users.length) {
      const defaults = [
        { nombre: 'Técnico Demo', rol: 'tecnico', activo: 1 },
        { nombre: 'Boletaje2026*', rol: 'tecnico', activo: 1 },
        { nombre: 'mariano', rol: 'tecnico', activo: 1 },
        { nombre: 'Test Tecnico', rol: 'tecnico', activo: 1 },
        { nombre: 'Admin Test', rol: 'admin', activo: 1 },
      ];
      for (const u of defaults) await dbPut(db, 'usuarios', u);
    }
  }

  window.__hitchiInit = seed;
})();
