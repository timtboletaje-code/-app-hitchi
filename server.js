const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const cors = require('cors');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
let db;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => { if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('Solo imágenes')); } });

app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

const equipos = JSON.parse(fs.readFileSync('equipos.json', 'utf8'));
const estacionesUnicas = [...new Set(equipos.map(e => e.estacion))].sort();
const tiposEquipoUnicos = [...new Set(equipos.map(e => e.equipo))].sort();

function saveDB() { const d = db.export(); fs.writeFileSync('hitchi.db', Buffer.from(d)); }
function query(sql, params = []) { const s = db.prepare(sql); if (params.length) s.bind(params); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; }
function run(sql, params = []) { db.run(sql, params); saveDB(); }
function get(sql, params = []) { const r = query(sql, params); return r.length ? r[0] : null; }

async function start() {
  const SQL = await initSqlJs();
  db = fs.existsSync('hitchi.db') ? new SQL.Database(fs.readFileSync('hitchi.db')) : new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, correo TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, rol TEXT DEFAULT 'tecnico')`);
  db.run(`CREATE TABLE IF NOT EXISTS incidencias (folio TEXT PRIMARY KEY, f_reporte TEXT, h_reporte TEXT, f_llegada TEXT, h_llegada TEXT, fecha_cierre TEXT, hora_cierre TEXT, estacion TEXT, equipo TEXT, loc_id TEXT, falla_fecha_reporte TEXT, como_fue_identificado TEXT, causa_raiz TEXT, metodo_diagnostico TEXT, descripcion_correccion TEXT, tipo_pruebas TEXT, estado_equipo TEXT, acciones_preventivas TEXT, herramienta_material TEXT, refacciones TEXT, tecnico_asignado TEXT, tecnico_correo TEXT, gerente_mantenimiento TEXT, supervisor_uo_timt TEXT, estado TEXT DEFAULT 'EN PROCESO', created_at TEXT DEFAULT (datetime('now', '-6 horas')))`);
  db.run(`CREATE TABLE IF NOT EXISTS fotos (id INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT, url_foto TEXT, tipo TEXT, fecha_toma TEXT DEFAULT (datetime('now', '-6 horas')), FOREIGN KEY (folio) REFERENCES incidencias(folio))`);
  saveDB();
  const cnt = query('SELECT COUNT(*) as c FROM usuarios');
  if (cnt[0].c === 0) run('INSERT INTO usuarios (correo, nombre, rol) VALUES (?, ?, ?)', ['tecnico@hitchi.app', 'Técnico Demo', 'tecnico']);
}

// --- API ---
app.post('/api/login', (req, res) => {
  const { correo, nombre } = req.body;
  if (!correo) return res.status(400).json({ error: 'Correo requerido' });
  let u = get('SELECT * FROM usuarios WHERE correo = ?', [correo]);
  if (!u) { run('INSERT INTO usuarios (correo, nombre) VALUES (?, ?)', [correo, nombre || correo.split('@')[0]]); u = get('SELECT * FROM usuarios WHERE correo = ?', [correo]); }
  res.json(u);
});

app.get('/api/estaciones', (req, res) => res.json(estacionesUnicas));
app.get('/api/tipos-equipo', (req, res) => res.json(tiposEquipoUnicos));
app.get('/api/locations', (req, res) => {
  let r = equipos;
  if (req.query.estacion) r = r.filter(e => e.estacion === req.query.estacion);
  if (req.query.equipo) r = r.filter(e => e.equipo === req.query.equipo);
  res.json(r.map(e => e.loc_id));
});

app.post('/api/incidencias', (req, res) => {
  const d = req.body;
  if (!d.estacion || !d.equipo) return res.status(400).json({ error: 'Estación y equipo requeridos' });
  const folio = d.folio || `HIT-${new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)}`;
  run(`INSERT INTO incidencias (folio, f_reporte, h_reporte, f_llegada, h_llegada, fecha_cierre, hora_cierre, estacion, equipo, loc_id, falla_fecha_reporte, como_fue_identificado, causa_raiz, metodo_diagnostico, descripcion_correccion, tipo_pruebas, estado_equipo, acciones_preventivas, herramienta_material, refacciones, tecnico_asignado, tecnico_correo, gerente_mantenimiento, supervisor_uo_timt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [folio, d.f_reporte||'', d.h_reporte||'', d.f_llegada||'', d.h_llegada||'', d.fecha_cierre||'', d.hora_cierre||'', d.estacion, d.equipo, d.loc_id||'', d.falla_fecha_reporte||'', d.como_fue_identificado||'', d.causa_raiz||'', d.metodo_diagnostico||'', d.descripcion_correccion||'', d.tipo_pruebas||'', d.estado_equipo||'', d.acciones_preventivas||'', d.herramienta_material||'', d.refacciones||'', d.tecnico_asignado||'', d.tecnico_correo||'', d.gerente_mantenimiento||'', d.supervisor_uo_timt||'']);
  res.json({ folio });
});

app.get('/api/incidencias', (req, res) => {
  let sql = 'SELECT * FROM incidencias';
  const p = []; const w = [];
  if (req.query.estacion) { w.push('estacion = ?'); p.push(req.query.estacion); }
  if (req.query.estado) { w.push('estado = ?'); p.push(req.query.estado); }
  if (w.length) sql += ' WHERE ' + w.join(' AND ');
  res.json(query(sql + ' ORDER BY created_at DESC', p));
});

app.get('/api/incidencias/:folio', (req, res) => {
  const row = get('SELECT * FROM incidencias WHERE folio = ?', [req.params.folio]);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  row.fotos = query('SELECT * FROM fotos WHERE folio = ? ORDER BY tipo, id', [req.params.folio]);
  res.json(row);
});

app.put('/api/incidencias/:folio', (req, res) => {
  const fields = ['folio','f_reporte','h_reporte','f_llegada','h_llegada','fecha_cierre','hora_cierre','estacion','equipo','loc_id','falla_fecha_reporte','como_fue_identificado','causa_raiz','metodo_diagnostico','descripcion_correccion','tipo_pruebas','estado_equipo','acciones_preventivas','herramienta_material','refacciones','tecnico_asignado','gerente_mantenimiento','supervisor_uo_timt','estado'];
  const sets = []; const p = [];
  for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); p.push(req.body[f]); } }
  if (req.body.folio && req.body.folio !== req.params.folio) {
    run(`UPDATE incidencias SET folio = ? WHERE folio = ?`, [req.body.folio, req.params.folio]);
    // also update photos
    run('UPDATE fotos SET folio = ? WHERE folio = ?', [req.body.folio, req.params.folio]);
  }
  if (sets.length) {
    p.push(req.params.folio);
    run(`UPDATE incidencias SET ${sets.join(', ')} WHERE folio = ?`, p);
    if (req.body.estado === 'LISTO PARA AUDITORÍA') generarYEnviarPDF(req.params.folio);
  }
  res.json({ success: true });
});

app.post('/api/upload/:folio', upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
  const url = `/uploads/${req.file.filename}`;
  run('INSERT INTO fotos (folio, url_foto, tipo) VALUES (?, ?, ?)', [req.params.folio, url, req.body.tipo || 'general']);
  res.json({ url, tipo: req.body.tipo });
});

app.delete('/api/fotos/:id', (req, res) => {
  const f = get('SELECT * FROM fotos WHERE id = ?', [req.params.id]);
  if (f) { const fp = path.join(__dirname, f.url_foto); if (fs.existsSync(fp)) fs.unlinkSync(fp); run('DELETE FROM fotos WHERE id = ?', [req.params.id]); }
  res.json({ success: true });
});

// --- EXCEL ---
async function generarExcel(folio) {
  const i = get('SELECT * FROM incidencias WHERE folio = ?', [folio]);
  if (!i) throw new Error('No encontrado');
  const fotos = query('SELECT * FROM fotos WHERE folio = ? ORDER BY tipo, id', [folio]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'App Hitchi';
  const ws = wb.addWorksheet('Reporte', {
    pageSetup: { paperSize: 9, orientation: 'portrait', margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 } }
  });

  const R = 'FFCC0000';
  const G = 'FFF2F2F2';
  const L = 'AA';

  ws.columns = [
    { width: 1.5 },
    { width: 1.5 },
    { width: 17 },
    { width: 14 },
    { width: 1 },
    { width: 17 },
    { width: 14 },
    { width: 1 },
    { width: 17 },
    { width: 14 },
    { width: 1 },
    { width: 17 },
    { width: 14 },
    { width: 1.5 },
  ];

  function colLetter(n) {
    let s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s || 'A';
  }

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

  function addBorderRange(r1, c1, r2, c2) {
    for (let r = r1; r <= r2; r++) addBorder(r, c1, c2);
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
    const font = { size: opts.fontSize || 9 };
    if (opts.bold) font.bold = true;
    if (opts.color) font.color = { argb: opts.color };
    if (opts.fontSize) font.size = opts.fontSize;
    cell.font = font;
    if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
    return cell;
  }

  function pair(label, value, col, opts = {}) {
    c(r, col, label, { bold: true, fill: G, fontSize: 7, align: 'center' });
    c(r, col + 1, value || '', { fontSize: 8, align: 'center' });
    addBorder(r, col, col + 1);
  }

  function trio(l1, v1, l2, v2, l3, v3) {
    pair(l1, v1, 3);
    pair(l2, v2, 6);
    pair(l3, v3, 9);
    r++;
  }

  function fullLabel(label, col, ncols) {
    c(r, col, label, { bold: true, fill: G, fontSize: 7 });
    if (ncols > 1) ws.mergeCells(r, col, r, col + ncols - 1);
    addBorder(r, col, col + ncols - 1);
  }

  function sectionHeader(label) {
    ws.mergeCells(r, 2, r, 13);
    c(r, 2, label, { bold: true, fill: R, color: 'FFFFFF', fontSize: 9, align: 'center' });
    ws.getRow(r).height = 18;
    r++;
  }

  function checkboxRow(options, selected, labelCol) {
    c(r, labelCol || 3, '', { fill: G });
    addBorder(r, labelCol || 3, labelCol || 3);
    let col = 4;
    options.forEach(o => {
      const chk = selected === o ? '☑' : '☐';
      const ncol = Math.min(3, Math.max(1, Math.ceil(o.length / 12)));
      const endCol = Math.min(col + ncol - 1, 12);
      if (ncol > 1) try { ws.mergeCells(r, col, r, endCol); } catch(e) {}
      c(r, col, `${chk} ${o}`, { fontSize: 7, align: 'center' });
      addBorder(r, col, endCol);
      col = endCol + 1;
    });
    while (col <= 12) { addBorder(r, col, col); col++; }
    r++;
  }

  // HEADER
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, `Fecha: ${i.f_reporte || ''}`, { fontSize: 7, align: 'right' }); r++;
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, 'Reporte de Atención de Incidencia Mantenimiento Correctivo Versión 4', { fontSize: 11, bold: true, align: 'center' });
  ws.getRow(r).height = 22;
  r++;

  // DATOS GENERALES
  sectionHeader('DATOS GENERALES');
  trio('Fecha de Reporte', i.f_reporte, 'Fecha de Llegada', i.f_llegada, 'Fecha de Cierre', i.fecha_cierre);
  trio('Hora de Reporte', i.h_reporte, 'Hora de Llegada', i.h_llegada, 'Hora de Cierre', i.hora_cierre);
  trio('Equipo', i.equipo, 'Location ID', i.loc_id, 'Folio', i.folio);
  pair('Estación', i.estacion || '', 3);
  r++;

  // DESCRIPCIÓN DE LA FALLA
  sectionHeader('DESCRIPCIÓN DE LA FALLA');
  fullLabel('Fecha de Reporte', 3, 10);
  c(r, 3, i.falla_fecha_reporte || '', { fontSize: 8 });
  addBorder(r, 3, 12);
  r++;
  fullLabel('Como fue identificado el Fallo', 3, 1);
  addBorder(r, 3, 3);
  checkboxRow(['CCO', 'MAU', 'Recorrido Técnico', 'Jefe de Estación', 'Otro'], i.como_fue_identificado);

  // DIAGNÓSTICO
  sectionHeader('DIAGNÓSTICO');
  fullLabel('Causa raíz del fallo', 3, 10);
  c(r, 3, i.causa_raiz || '', { fontSize: 8 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 30;
  r++;
  fullLabel('Metodo Utilizado de Diagnóstico', 3, 1);
  addBorder(r, 3, 3);
  checkboxRow(['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'], i.metodo_diagnostico);

  // ACCIONES CORRECTIVAS
  sectionHeader('ACCIONES CORRECTIVAS EJECUTADAS');
  fullLabel('Descripción de la Corrección', 3, 10);
  c(r, 3, i.descripcion_correccion || '', { fontSize: 8 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 30;
  r++;
  fullLabel('Tipo de Pruebas realizadas', 3, 1);
  addBorder(r, 3, 3);
  checkboxRow(['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'], i.tipo_pruebas);

  // RESULTADOS
  sectionHeader('RESULTADOS');
  fullLabel('Estado en que se deja el equipo', 3, 1);
  addBorder(r, 3, 3);
  checkboxRow(['Equipo Operativo', 'Equipo en Pruebas', 'Equipo Fuera de Serv.', 'Equipo pendiente de Refacción', 'Otro'], i.estado_equipo);

  // ACCIONES PREVENTIVAS
  sectionHeader('ACCIONES PREVENTIVAS SUGERIDAS');
  fullLabel('Acciones preventivas', 3, 10);
  c(r, 3, i.acciones_preventivas || '', { fontSize: 8 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 28;
  r++;

  // HERRAMIENTAS
  sectionHeader('HERRAMIENTAS Y/O MATERIAL UTILIZADO');
  fullLabel('Herramienta / Material', 3, 10);
  c(r, 3, i.herramienta_material || '', { fontSize: 8 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 28;
  r++;
  fullLabel('Refacciones', 3, 10);
  c(r, 3, i.refacciones || '', { fontSize: 8 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 28;
  r++;

  // REPORTE FOTOGRÁFICO
  sectionHeader('REPORTE FOTOGRÁFICO');
  if (fotos && fotos.length > 0) {
    const antes = fotos.filter(f => f.tipo === 'antes');
    const despues = fotos.filter(f => f.tipo === 'despues');
    const maxFotos = Math.max(antes.length, despues.length, 1);
    for (let idx = 0; idx < maxFotos; idx++) {
      c(r, 3, idx === 0 ? 'Antes' : '', { bold: true, fontSize: 8, color: 'FFCC0000', align: 'center' });
      try { ws.mergeCells(r, 3, r, 7); } catch(e) {}
      addBorder(r, 3, 7);
      c(r, 9, idx === 0 ? 'Después' : '', { bold: true, fontSize: 8, color: 'FF2e7d32', align: 'center' });
      try { ws.mergeCells(r, 9, r, 12); } catch(e) {}
      addBorder(r, 9, 12);
      r++;
      const addPhoto = (foto, col) => {
        if (!foto) return;
        try {
          const fp = path.join(__dirname, foto.url_foto);
          if (fs.existsSync(fp)) {
            const img = wb.addImage({ filename: fp, extension: 'png' });
            ws.addImage(img, `${colLetter(col)}${r}:${colLetter(col + 4)}${r + 5}`);
          }
        } catch (e) { /* skip */ }
      };
      addPhoto(antes[idx], 3);
      addPhoto(despues[idx], 9);
      ws.getRow(r).height = 110;
      for (let rr = r; rr <= r + 5; rr++) {
        for (let cc = 3; cc <= 7; cc++) addBorder(rr, cc, cc);
        for (let cc = 9; cc <= 12; cc++) addBorder(rr, cc, cc);
      }
      r += 6;
    }
  } else {
    ws.mergeCells(r, 3, r, 12);
    c(r, 3, 'Sin fotografías', { fontSize: 8, align: 'center' });
    addBorder(r, 3, 12);
    r++;
  }

  // SIGNATURES
  sectionHeader('FIRMAS');
  const sigs = [
    { role: 'Técnico', name: i.tecnico_asignado || '' },
    { role: 'Gerente de Mantenimiento', name: i.gerente_mantenimiento || '' },
    { role: 'Supervisor UO-TIMT', name: i.supervisor_uo_timt || '' }
  ];
  sigs.forEach((s, idx) => {
    const baseCol = 3 + idx * 4;
    try { ws.mergeCells(r, baseCol, r, baseCol + 1); } catch(e) {}
    ws.getCell(r, baseCol).border = { bottom: { style: 'medium', color: { argb: 'FF333333' } } };
    addBorder(r, baseCol, baseCol + 1);
    try { ws.mergeCells(r + 1, baseCol, r + 1, baseCol + 1); } catch(e) {}
    c(r + 1, baseCol, s.name, { fontSize: 9, align: 'center' });
    try { ws.mergeCells(r + 2, baseCol, r + 2, baseCol + 1); } catch(e) {}
    c(r + 2, baseCol, s.role, { bold: true, fontSize: 8, color: '555555', align: 'center' });
    try { ws.mergeCells(r + 3, baseCol, r + 3, baseCol + 1); } catch(e) {}
    c(r + 3, baseCol, 'Nombre y Firma', { fontSize: 7, color: '888888', align: 'center' });
  });
  r += 5;
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, '©Hitachi 2025 All Rights Reserved', { fontSize: 6, color: '999999', align: 'center' });

  return wb;
}

// --- PDF ---
function generarPDF(folio) {
  return new Promise((resolve, reject) => {
    const i = get('SELECT * FROM incidencias WHERE folio = ?', [folio]);
    if (!i) return reject(new Error('No encontrado'));
    const fotos = query('SELECT * FROM fotos WHERE folio = ? ORDER BY tipo, id', [folio]);

    const doc = new PDFDocument({ margin: 35, size: 'LETTER' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = 35, W = 542, rowH = 16, smallH = 14;

    // Logos
    const logoIzq = path.join(__dirname, 'public', 'logo-izquierdo.png');
    const logoDer = path.join(__dirname, 'public', 'logo-derecho.png');
    if (fs.existsSync(logoIzq)) try { doc.image(logoIzq, M, 15, { width: 55 }); } catch(e) {}
    if (fs.existsSync(logoDer)) try { doc.image(logoDer, M + W - 55, 15, { width: 55 }); } catch(e) {}

    let y = 50;

    function drawSectionTitle(title, ypos) {
      doc.rect(M, ypos, W, 16).fill('#CC0000');
      doc.fill('#FFFFFF').fontSize(7.5).font('Helvetica-Bold').text(title, M + 5, ypos + 4);
    }

    function drawCheckbox(x, ypos, label, checked, w) {
      const size = 9;
      doc.rect(x, ypos, size, size).stroke('#000');
      if (checked) {
        doc.lineWidth(1.8).moveTo(x + 2, ypos + 2).lineTo(x + size - 2, ypos + size - 2).stroke('#000');
        doc.lineWidth(1.8).moveTo(x + size - 2, ypos + 2).lineTo(x + 2, ypos + size - 2).stroke('#000');
        doc.lineWidth(0.5);
      }
      doc.fill('#000').fontSize(7).font('Helvetica').text(label, x + size + 5, ypos, { width: (w || 80) - size - 5 });
    }

    function drawTextLabel(x, ypos, w, h, label, value) {
      doc.rect(x, ypos, w, h).stroke('#cccccc');
      doc.fill('#555').fontSize(6).font('Helvetica-Bold').text(label, x + 3, ypos + 1, { width: w - 6 });
      if (value) doc.fill('#000').fontSize(7).font('Helvetica').text(value, x + 3, ypos + 8, { width: w - 6 });
    }

    // Header
    doc.fontSize(7).font('Helvetica').fill('#555555').text(`Fecha: ${i.f_reporte || ''}`, M, y, { width: W, align: 'right' });
    y += 4;
    doc.fontSize(10).font('Helvetica-Bold').fill('#000000').text('Reporte de Atención de Incidencia Mantenimiento Correctivo Versión 4', M, y, { width: W, align: 'center' });
    y += 16;

    // DATOS GENERALES
    drawSectionTitle('DATOS GENERALES', y); y += 16;
    const col3 = W / 3;
    drawTextLabel(M, y, col3 - 2, rowH, 'Fecha de Reporte', i.f_reporte);
    drawTextLabel(M + col3, y, col3 - 2, rowH, 'Fecha de Llegada', i.f_llegada);
    drawTextLabel(M + col3 * 2, y, col3, rowH, 'Fecha de Cierre', i.fecha_cierre); y += rowH;
    drawTextLabel(M, y, col3 - 2, rowH, 'Hora de Reporte', i.h_reporte);
    drawTextLabel(M + col3, y, col3 - 2, rowH, 'Hora de Llegada', i.h_llegada);
    drawTextLabel(M + col3 * 2, y, col3, rowH, 'Hora de Cierre', i.hora_cierre); y += rowH;

    const col4 = W / 4;
    drawTextLabel(M, y, col4 - 2, rowH, 'Equipo', i.equipo);
    drawTextLabel(M + col4, y, col4 - 2, rowH, 'Location ID', i.loc_id);
    drawTextLabel(M + col4 * 2, y, col4 - 2, rowH, 'Folio', i.folio);
    drawTextLabel(M + col4 * 3, y, col4, rowH, 'Estación', i.estacion); y += rowH + 4;

    // DESCRIPCIÓN DE LA FALLA
    if (y > 680) { doc.addPage(); y = M; }
    drawSectionTitle('DESCRIPCIÓN DE LA FALLA', y); y += 16;
    drawTextLabel(M, y, W, smallH, 'Fecha de Reporte', i.falla_fecha_reporte); y += smallH;
    doc.rect(M, y, W, smallH + 2).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Como fue identificado el Fallo', M + 3, y + 1, { width: 130 });
    let cx = M + 135;
    ['CCO','MAU','Recorrido Técnico','Jefe de Estación','Otro'].forEach(o => { drawCheckbox(cx, y + 2, o, i.como_fue_identificado === o, 82); cx += 82; });
    y += smallH + 2;

    // DIAGNÓSTICO
    if (y > 680) { doc.addPage(); y = M; }
    drawSectionTitle('DIAGNÓSTICO', y); y += 16;
    doc.rect(M, y, W, 28).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Causa raíz del fallo', M + 3, y + 1);
    doc.fill('#000').fontSize(7).font('Helvetica').text(i.causa_raiz || '', M + 3, y + 10, { width: W - 6 }); y += 28;
    doc.rect(M, y, W, smallH + 2).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Metodo Utilizado de Diagnóstico', M + 3, y + 1, { width: 145 });
    cx = M + 150;
    ['Inspección Visual','Prueba de Medición','Prueba de Funcionamiento','Otro'].forEach(o => { drawCheckbox(cx, y + 2, o, i.metodo_diagnostico === o, 90); cx += 90; });
    y += smallH + 4;

    // ACCIONES CORRECTIVAS
    if (y > 680) { doc.addPage(); y = M; }
    drawSectionTitle('ACCIONES CORRECTIVAS EJECUTADAS', y); y += 16;
    doc.rect(M, y, W, 28).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Descripción de la Corrección', M + 3, y + 1);
    doc.fill('#000').fontSize(7).font('Helvetica').text(i.descripcion_correccion || '', M + 3, y + 10, { width: W - 6 }); y += 28;
    doc.rect(M, y, W, smallH + 2).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Tipo de Pruebas realizadas', M + 3, y + 1, { width: 130 });
    cx = M + 135;
    ['Inspección Visual','Prueba de Medición','Prueba de Funcionamiento','Otro'].forEach(o => { drawCheckbox(cx, y + 2, o, i.tipo_pruebas === o, 90); cx += 90; });
    y += smallH + 4;

    // RESULTADOS
    if (y > 680) { doc.addPage(); y = M; }
    drawSectionTitle('RESULTADOS', y); y += 16;
    doc.rect(M, y, W, smallH + 2).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Estado en que se deja el equipo', M + 3, y + 1, { width: 145 });
    cx = M + 150;
    ['Equipo Operativo','Equipo en Pruebas','Equipo Fuera de Serv.','Equipo pendiente de Refacción','Otro'].forEach(o => { drawCheckbox(cx, y + 2, o, i.estado_equipo === o, 78); cx += 80; });
    y += smallH + 4;

    // ACCIONES PREVENTIVAS
    if (y > 680) { doc.addPage(); y = M; }
    drawSectionTitle('ACCIONES PREVENTIVAS SUGERIDAS', y); y += 16;
    doc.rect(M, y, W, 26).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Acciones preventivas', M + 3, y + 1);
    doc.fill('#000').fontSize(7).font('Helvetica').text(i.acciones_preventivas || '', M + 3, y + 10, { width: W - 6 }); y += 28;

    // HERRAMIENTAS
    if (y > 680) { doc.addPage(); y = M; }
    drawSectionTitle('HERRAMIENTAS Y/O MATERIAL UTILIZADO', y); y += 16;
    doc.rect(M, y, W, 26).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Herramienta / Material', M + 3, y + 1);
    doc.fill('#000').fontSize(7).font('Helvetica').text(i.herramienta_material || '', M + 3, y + 10, { width: W - 6 }); y += 26;
    doc.rect(M, y, W, 22).stroke('#cccccc');
    doc.fill('#555').fontSize(6).font('Helvetica-Bold').text('Refacciones', M + 3, y + 1);
    doc.fill('#000').fontSize(7).font('Helvetica').text(i.refacciones || '', M + 3, y + 10, { width: W - 6 }); y += 24;

    // REPORTE FOTOGRÁFICO
    if (y > 680) { doc.addPage(); y = M; }
    drawSectionTitle('REPORTE FOTOGRÁFICO', y); y += 18;
    const antes = fotos.filter(f => f.tipo === 'antes');
    const despues = fotos.filter(f => f.tipo === 'despues');
    const photoW = (W - 10) / 2, photoH = 95;
    doc.fill('#CC0000').fontSize(8).font('Helvetica-Bold').text('Antes', M + 3, y);
    doc.fill('#2e7d32').fontSize(8).font('Helvetica-Bold').text('Después.', M + photoW + 10, y); y += 11;
    for (let idx = 0; idx < Math.max(antes.length, despues.length, 1); idx++) {
      if (y + photoH > 700) { doc.addPage(); y = M; }
      if (idx < antes.length) { const fp = path.join(__dirname, antes[idx].url_foto); if (fs.existsSync(fp)) try { doc.image(fp, M, y, { fit: [photoW - 5, photoH] }); } catch(e) {} }
      if (idx < despues.length) { const fp = path.join(__dirname, despues[idx].url_foto); if (fs.existsSync(fp)) try { doc.image(fp, M + photoW + 8, y, { fit: [photoW - 5, photoH] }); } catch(e) {} }
      y += photoH + 4;
    }

    // SIGNATURES
    if (y > 690) { doc.addPage(); y = M; }
    y += 12;
    const blockW = (W - 30) / 3;
    const starts = [M, M + blockW + 15, M + 2 * (blockW + 15)];
    [
      { role: 'Técnico', name: i.tecnico_asignado || '' },
      { role: 'Gerente de Mantenimiento', name: i.gerente_mantenimiento || '' },
      { role: 'Supervisor UO-TIMT', name: i.supervisor_uo_timt || '' }
    ].forEach((s, idx) => {
      const x = starts[idx];
      const lineW = blockW - 10;
      doc.moveTo(x, y).lineTo(x + lineW, y).stroke('#333');
      doc.fill('#000').fontSize(8).font('Helvetica').text(s.name, x, y + 6, { width: lineW, align: 'center' });
      doc.fill('#555').fontSize(7).font('Helvetica-Bold').text(s.role, x, y + 18, { width: lineW, align: 'center' });
      doc.fill('#888').fontSize(6).font('Helvetica-Oblique').text('Nombre y Firma', x, y + 30, { width: lineW, align: 'center' });
    });
    y += 50;
    doc.fill('#999').fontSize(6).font('Helvetica').text('©Hitachi 2025 All Rights Reserved', M, y, { width: W, align: 'center' });
    doc.end();
  });
}

// --- ROUTES: PDF & EXCEL ---
app.get('/api/incidencias/:folio/pdf', async (req, res) => {
  try { const pdf = await generarPDF(req.params.folio); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename=reporte-${req.params.folio}.pdf`); res.send(pdf); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/incidencias/:folio/excel', async (req, res) => {
  try { const wb = await generarExcel(req.params.folio); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename=reporte-${req.params.folio}.xlsx`); await wb.xlsx.write(res); res.end(); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/excel-completo', async (req, res) => {
  try {
    const rows = query('SELECT * FROM incidencias ORDER BY created_at DESC');
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
      { header: 'Identificado', key: 'como_fue_identificado', width: 18 },
      { header: 'Causa Raíz', key: 'causa_raiz', width: 25 },
      { header: 'Diagnóstico', key: 'metodo_diagnostico', width: 18 },
      { header: 'Corrección', key: 'descripcion_correccion', width: 25 },
      { header: 'Pruebas', key: 'tipo_pruebas', width: 18 },
      { header: 'Estado Equipo', key: 'estado_equipo', width: 18 },
      { header: 'Acciones Preventivas', key: 'acciones_preventivas', width: 25 },
      { header: 'Herramienta', key: 'herramienta_material', width: 20 },
      { header: 'Refacciones', key: 'refacciones', width: 20 },
      { header: 'Hora Reporte', key: 'h_reporte', width: 10 },
      { header: 'Hora Llegada', key: 'h_llegada', width: 10 },
      { header: 'Hora Cierre', key: 'hora_cierre', width: 10 },
      { header: 'Fecha Llegada', key: 'f_llegada', width: 12 },
      { header: 'Fecha Cierre', key: 'fecha_cierre', width: 12 },
      { header: 'Gerente', key: 'gerente_mantenimiento', width: 18 },
      { header: 'Supervisor', key: 'supervisor_uo_timt', width: 18 },
    ];
    ws.columns = columns;
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } };
    headerRow.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    rows.forEach(row => ws.addRow(row));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=todos-los-reportes.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function generarYEnviarPDF(folio) {
  try {
    const i = get('SELECT * FROM incidencias WHERE folio = ?', [folio]); if (!i) return;
    const pdf = await generarPDF(folio);
    const ue = process.env.EMAIL_USER || '', up = process.env.EMAIL_PASS || '';
    if (!ue || !up) { console.log('Email no configurado. PDF generado para', folio); return; }
    const t = nodemailer.createTransport({ host:'smtp.gmail.com', port:587, secure:false, auth:{user:ue, pass:up} });
    await t.sendMail({ from:`"App Hitchi" <${ue}>`, to:'timtboletaje@gmail.com', cc:'marianozar.c@gmail.com', subject:`Reporte de Mantenimiento - ${folio}`, text:`Folio: ${folio}\nEstación: ${i.estacion}\nEquipo: ${i.equipo}\nTécnico: ${i.tecnico_asignado}`, attachments:[{filename:`reporte-${folio}.pdf`, content:pdf}] });
    console.log(`Email enviado: ${folio}`);
  } catch(e) { console.error('Error email:', e.message); }
}

app.post('/api/incidencias/:folio/enviar', async (req, res) => {
  try { await generarYEnviarPDF(req.params.folio); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

start().then(() => {
  app.listen(PORT, () => { console.log(`✅ App Hitchi en http://localhost:${PORT}`); console.log(`📊 ${equipos.length} equipos en ${estacionesUnicas.length} estaciones`); });
}).catch(e => { console.error('Error:', e); process.exit(1); });
