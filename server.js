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
const DATA_PATH = process.env.DATA_PATH || '.';
const UPLOADS_PATH = path.join(DATA_PATH, 'uploads');
const DB_PATH = path.join(DATA_PATH, 'hitchi.db');
let db;

if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_PATH));

const upload = multer({ dest: UPLOADS_PATH + '/', limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => { if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('Solo imágenes')); } });

app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

const equipos = JSON.parse(fs.readFileSync('equipos.json', 'utf8'));
const estacionesUnicas = [...new Set(equipos.map(e => e.estacion))].sort();
const tiposEquipoUnicos = [...new Set(equipos.map(e => e.equipo))].sort();

function saveDB() { const d = db.export(); fs.writeFileSync(DB_PATH, Buffer.from(d)); }
function query(sql, params = []) { const s = db.prepare(sql); if (params.length) s.bind(params); const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r; }
function run(sql, params = []) { db.run(sql, params); saveDB(); }
function get(sql, params = []) { const r = query(sql, params); return r.length ? r[0] : null; }

async function start() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();

  // Create incidencias and fotos tables (new schema)
  db.run(`CREATE TABLE IF NOT EXISTS incidencias (folio TEXT PRIMARY KEY, f_reporte TEXT, h_reporte TEXT, f_llegada TEXT, h_llegada TEXT, fecha_cierre TEXT, hora_cierre TEXT, estacion TEXT, equipo TEXT, loc_id TEXT, falla_fecha_reporte TEXT, como_fue_identificado TEXT, causa_raiz TEXT, metodo_diagnostico TEXT, descripcion_correccion TEXT, tipo_pruebas TEXT, estado_equipo TEXT, acciones_preventivas TEXT, herramienta_material TEXT, refacciones TEXT, tecnico_asignado TEXT, gerente_mantenimiento TEXT, supervisor_uo_timt TEXT, estado TEXT DEFAULT 'EN PROCESO', revisado INTEGER DEFAULT 0, nota_supervision TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now', '-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS fotos (id INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT, url_foto TEXT, tipo TEXT, fecha_toma TEXT DEFAULT (datetime('now', '-6 hours')), FOREIGN KEY (folio) REFERENCES incidencias(folio))`);
  // Add columns if table existed without them
  try { db.run("ALTER TABLE incidencias ADD COLUMN revisado INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE incidencias ADD COLUMN nota_supervision TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("UPDATE incidencias SET created_at = datetime('now', '-6 hours') WHERE created_at IS NULL"); } catch(e) {}
  try { db.run("UPDATE incidencias SET f_reporte = date('now') WHERE f_reporte IS NULL OR f_reporte = ''"); } catch(e) {}
  try { db.run("UPDATE fotos SET fecha_toma = datetime('now', '-6 hours') WHERE fecha_toma IS NULL"); } catch(e) {}

  // Migrate usuarios table: check if old schema (with correo column)
  const cols = query("PRAGMA table_info('usuarios')");
  const hasCorreo = cols.length > 0 && cols.some(c => c.name === 'correo');
  if (hasCorreo) {
    db.run("DROP TABLE IF EXISTS usuarios_old");
    db.run("ALTER TABLE usuarios RENAME TO usuarios_old");
    db.run("CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, rol TEXT DEFAULT 'tecnico')");
    // Handle duplicate nombres: keep first occurrence
    db.run("INSERT OR IGNORE INTO usuarios (id, nombre, rol) SELECT id, nombre, rol FROM usuarios_old");
    db.run("DROP TABLE IF EXISTS usuarios_old");
  }
  const cols2 = query("PRAGMA table_info('usuarios')");
  if (cols2.length === 0) {
    db.run("CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE NOT NULL, rol TEXT DEFAULT 'tecnico')");
  }
  if (query('SELECT COUNT(*) as c FROM usuarios')[0].c === 0) {
    run('INSERT INTO usuarios (nombre, rol) VALUES (?, ?)', ['Técnico Demo', 'tecnico']);
  }

  saveDB();
}

// --- LOGIN ---
app.post('/api/login', (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  let u = get('SELECT * FROM usuarios WHERE nombre = ? AND rol = ?', [nombre.trim(), 'tecnico']);
  if (!u) {
    run('INSERT INTO usuarios (nombre, rol) VALUES (?, ?)', [nombre.trim(), 'tecnico']);
    u = get('SELECT * FROM usuarios WHERE nombre = ?', [nombre.trim()]);
  }
  res.json(u);
});

app.post('/api/login-admin', (req, res) => {
  const { nombre, password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  if (password !== adminPass) return res.status(401).json({ error: 'Contraseña incorrecta' });
  let u = get('SELECT * FROM usuarios WHERE nombre = ? AND rol = ?', [nombre.trim(), 'admin']);
  if (!u) {
    run('INSERT INTO usuarios (nombre, rol) VALUES (?, ?)', [nombre.trim(), 'admin']);
    u = get('SELECT * FROM usuarios WHERE nombre = ?', [nombre.trim()]);
  }
  res.json(u);
});

app.get('/api/estaciones', (req, res) => res.json(estacionesUnicas));
app.get('/api/tipos-equipo', (req, res) => res.json(tiposEquipoUnicos));
app.get('/api/tecnicos', (req, res) => {
  res.json(query('SELECT DISTINCT nombre FROM usuarios WHERE rol = ? ORDER BY nombre', ['tecnico']));
});
app.get('/api/equipos-por-estacion', (req, res) => {
  const est = req.query.estacion;
  if (!est) return res.json(tiposEquipoUnicos);
  const filtrados = [...new Set(equipos.filter(e => e.estacion === est).map(e => e.equipo))].sort();
  res.json(filtrados);
});
app.get('/api/locations', (req, res) => {
  let r = equipos;
  if (req.query.estacion) r = r.filter(e => e.estacion === req.query.estacion);
  if (req.query.equipo) r = r.filter(e => e.equipo === req.query.equipo);
  res.json(r.map(e => e.loc_id));
});

// --- INCIDENCIAS ---
app.post('/api/incidencias', (req, res) => {
  const d = req.body;
  if (!d.estacion || !d.equipo) return res.status(400).json({ error: 'Estación y equipo requeridos' });
  const folio = d.folio || `HIT-${new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)}`;
  run(`INSERT INTO incidencias (folio, f_reporte, h_reporte, f_llegada, h_llegada, fecha_cierre, hora_cierre, estacion, equipo, loc_id, falla_fecha_reporte, como_fue_identificado, causa_raiz, metodo_diagnostico, descripcion_correccion, tipo_pruebas, estado_equipo, acciones_preventivas, herramienta_material, refacciones, tecnico_asignado, gerente_mantenimiento, supervisor_uo_timt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '-6 hours'))`,
    [folio, d.f_reporte||new Date().toISOString().split('T')[0], d.h_reporte||'', d.f_llegada||'', d.h_llegada||'', d.fecha_cierre||'', d.hora_cierre||'', d.estacion, d.equipo, d.loc_id||'', d.falla_fecha_reporte||'', d.como_fue_identificado||'', d.causa_raiz||'', d.metodo_diagnostico||'', d.descripcion_correccion||'', d.tipo_pruebas||'', d.estado_equipo||'', d.acciones_preventivas||'', d.herramienta_material||'', d.refacciones||'', d.tecnico_asignado||'', d.gerente_mantenimiento||'', d.supervisor_uo_timt||'']);
  res.json({ folio });
});

app.get('/api/incidencias', (req, res) => {
  let sql = 'SELECT * FROM incidencias';
  const p = []; const w = [];
  if (req.query.tecnico) { w.push('tecnico_asignado = ?'); p.push(req.query.tecnico); }
  if (req.query.estacion) { w.push('estacion = ?'); p.push(req.query.estacion); }
  if (req.query.estado) { w.push('estado = ?'); p.push(req.query.estado); }
  if (req.query.fecha_desde) { w.push('f_reporte >= ?'); p.push(req.query.fecha_desde); }
  if (req.query.fecha_hasta) { w.push('f_reporte <= ?'); p.push(req.query.fecha_hasta); }
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
  const fields = ['folio','f_reporte','h_reporte','f_llegada','h_llegada','fecha_cierre','hora_cierre','estacion','equipo','loc_id','falla_fecha_reporte','como_fue_identificado','causa_raiz','metodo_diagnostico','descripcion_correccion','tipo_pruebas','estado_equipo','acciones_preventivas','herramienta_material','refacciones','tecnico_asignado','gerente_mantenimiento','supervisor_uo_timt','estado','revisado','nota_supervision'];
  const sets = []; const p = [];
  for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); p.push(req.body[f]); } }
  if (req.body.folio && req.body.folio !== req.params.folio) {
    run(`UPDATE incidencias SET folio = ? WHERE folio = ?`, [req.body.folio, req.params.folio]);
    run('UPDATE fotos SET folio = ? WHERE folio = ?', [req.body.folio, req.params.folio]);
  }
  if (sets.length) {
    p.push(req.params.folio);
    run(`UPDATE incidencias SET ${sets.join(', ')} WHERE folio = ?`, p);
    if (req.body.estado === 'ENVIADO') generarYEnviarPDF(req.params.folio);
  }
  res.json({ success: true });
});

app.post('/api/upload/:folio', upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
  const url = `/uploads/${req.file.filename}`;
  run(`INSERT INTO fotos (folio, url_foto, tipo, fecha_toma) VALUES (?, ?, ?, datetime('now', '-6 hours'))`, [req.params.folio, url, req.body.tipo || 'general']);
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
      if (ncol > 1) try { ws.mergeCells(r, col, r, endCol); } catch(e) {}
      c(r, col, `${chk} ${o}`, { fontSize: 6, align: 'center' });
      addBorder(r, col, endCol);
      col = endCol + 1;
    });
    while (col <= 12) { addBorder(r, col, col); col++; }
    r++;
  }

  // HEADER
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, `Fecha: ${i.f_reporte || ''}`, { fontSize: 6, align: 'right' }); r++;
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, 'Reporte de Atención de Incidencia Mantenimiento Correctivo Versión 4', { fontSize: 10, bold: true, align: 'center' });
  ws.getRow(r).height = 20;
  r++;

  sectionHeader('DATOS GENERALES');
  trio('Fecha de Reporte', i.f_reporte, 'Fecha de Llegada', i.f_llegada, 'Fecha de Cierre', i.fecha_cierre);
  trio('Hora de Reporte', i.h_reporte, 'Hora de Llegada', i.h_llegada, 'Hora de Cierre', i.hora_cierre);
  trio('Equipo', i.equipo, 'Location ID', i.loc_id, 'Folio', i.folio);
  pair('Estación', i.estacion || '', 3);
  r++;

  sectionHeader('DESCRIPCIÓN DE LA FALLA');
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, i.falla_fecha_reporte || '', { fontSize: 6, fill: 'FFF9F9F9' });
  addBorder(r, 3, 12);
  r++;
  c(r, 3, 'Como fue identificado el Fallo', { bold: true, fill: G, fontSize: 6 });
  addBorder(r, 3, 3);
  checkboxRow(['CCO', 'MAU', 'Recorrido Técnico', 'Jefe de Estación', 'Otro'], i.como_fue_identificado);

  sectionHeader('DIAGNÓSTICO');
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, i.causa_raiz || '', { fontSize: 6 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 22;
  r++;
  c(r, 3, 'Metodo Utilizado de Diagnóstico', { bold: true, fill: G, fontSize: 6 });
  addBorder(r, 3, 3);
  checkboxRow(['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'], i.metodo_diagnostico);

  sectionHeader('ACCIONES CORRECTIVAS EJECUTADAS');
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, i.descripcion_correccion || '', { fontSize: 6 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 22;
  r++;
  c(r, 3, 'Tipo de Pruebas realizadas', { bold: true, fill: G, fontSize: 6 });
  addBorder(r, 3, 3);
  checkboxRow(['Inspección Visual', 'Prueba de Medición', 'Prueba de Funcionamiento', 'Otro'], i.tipo_pruebas);

  sectionHeader('RESULTADOS');
  c(r, 3, 'Estado en que se deja el equipo', { bold: true, fill: G, fontSize: 6 });
  addBorder(r, 3, 3);
  checkboxRow(['Equipo Operativo', 'Equipo en Pruebas', 'Equipo Fuera de Serv.', 'Equipo pendiente de Refacción', 'Otro'], i.estado_equipo);

  sectionHeader('ACCIONES PREVENTIVAS SUGERIDAS');
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, i.acciones_preventivas || '', { fontSize: 6 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 20;
  r++;

  sectionHeader('HERRAMIENTAS Y/O MATERIAL UTILIZADO');
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, i.herramienta_material || '', { fontSize: 6 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 20;
  r++;
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, i.refacciones || '', { fontSize: 6 });
  addBorder(r, 3, 12);
  ws.getRow(r).height = 18;
  r++;

  // REPORTE FOTOGRÁFICO - 2x2 grid per side, fixed 140px
  sectionHeader('REPORTE FOTOGRÁFICO');
  const antes = fotos.filter(f => f.tipo === 'antes');
  const despues = fotos.filter(f => f.tipo === 'despues');
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
    if (i < antes.length) {
      const fp = path.join(__dirname, antes[i].url_foto);
      if (fs.existsSync(fp)) {
        try {
          const img = wb.addImage({ filename: fp, extension: 'png' });
          ws.addImage(img, `${colLetter(col)}${rr}:${colLetter(col + 1)}${rr}`);
        } catch(e) {}
      }
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
    if (i < despues.length) {
      const fp = path.join(__dirname, despues[i].url_foto);
      if (fs.existsSync(fp)) {
        try {
          const img = wb.addImage({ filename: fp, extension: 'png' });
          ws.addImage(img, `${colLetter(col)}${rr}:${colLetter(col + 1)}${rr}`);
        } catch(e) {}
      }
    }
    ws.mergeCells(rr, col, rr, col + 1);
    c(rr, col, i < despues.length ? '' : '—', { fontSize: 5, align: 'center', fill: 'FFF5F5F5' });
    addBorder(rr, col, col + 1);
    ws.getRow(rr).height = rowH;
  }
  r += 2;

  // SIGNATURES
  const sigs = [
    { role: 'Técnico', name: i.tecnico_asignado || '' },
    { role: 'Gerente de Mantenimiento', name: i.gerente_mantenimiento || '' },
    { role: 'Supervisor UO-TIMT', name: i.supervisor_uo_timt || '' }
  ];
  sigs.forEach((s, idx) => {
    const baseCol = 3 + idx * 4;
    try { ws.mergeCells(r, baseCol, r, baseCol + 1); } catch(e) {}
    c(r, baseCol, s.name, { fontSize: 8, align: 'center' });
    try { ws.mergeCells(r + 1, baseCol, r + 1, baseCol + 1); } catch(e) {}
    ws.getCell(r + 1, baseCol).border = { bottom: { style: 'medium', color: { argb: 'FF333333' } } };
    addBorder(r + 1, baseCol, baseCol + 1);
    try { ws.mergeCells(r + 2, baseCol, r + 2, baseCol + 1); } catch(e) {}
    c(r + 2, baseCol, s.role, { bold: true, fontSize: 7, color: '555555', align: 'center' });
    try { ws.mergeCells(r + 3, baseCol, r + 3, baseCol + 1); } catch(e) {}
    c(r + 3, baseCol, 'Nombre y Firma', { fontSize: 6, color: '888888', align: 'center' });
  });
  r += 5;
  ws.mergeCells(r, 3, r, 12);
  c(r, 3, '©Hitachi 2025 All Rights Reserved', { fontSize: 5, color: '999999', align: 'center' });

  return wb;
}

// --- PDF ---
function generarPDF(folio) {
  return new Promise((resolve, reject) => {
    const i = get('SELECT * FROM incidencias WHERE folio = ?', [folio]);
    if (!i) return reject(new Error('No encontrado'));
    const fotos = query('SELECT * FROM fotos WHERE folio = ? ORDER BY tipo, id', [folio]);

    const doc = new PDFDocument({ margin: 30, size: 'LETTER' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = 30, W = 552, PH = 792, rowH = 14, smallH = 12;

    // Logos
    const logoIzq = path.join(__dirname, 'public', 'logo-izquierdo.png');
    const logoDer = path.join(__dirname, 'public', 'logo-derecho.png');
    if (fs.existsSync(logoIzq)) try { doc.image(logoIzq, M, 12, { width: 50 }); } catch(e) {}
    if (fs.existsSync(logoDer)) try { doc.image(logoDer, M + W - 50, 12, { width: 50 }); } catch(e) {}

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

    // Header
    doc.fontSize(6.5).font('Helvetica').fill('#555555').text(`Fecha: ${i.f_reporte || ''}`, M, y, { width: W, align: 'right' });
    y += 3;
    doc.fontSize(9).font('Helvetica-Bold').fill('#000000').text('Reporte de Atención de Incidencia Mantenimiento Correctivo Versión 4', M, y, { width: W, align: 'center' });
    y += 14;

    // DATOS GENERALES
    drawSectionTitle('DATOS GENERALES', y); y += 14;
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
    drawTextLabel(M + col4 * 3, y, col4, rowH, 'Estación', i.estacion); y += rowH + 2;

    // DESCRIPCIÓN DE LA FALLA
    drawSectionTitle('DESCRIPCIÓN DE LA FALLA', y); y += 14;
    drawTextLabel(M, y, W, smallH, 'Fecha de Reporte', i.falla_fecha_reporte); y += smallH;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Como fue identificado el Fallo', M + 2, y + 1, { width: 130 });
    let cx = M + 132;
    ['CCO','MAU','Recorrido Técnico','Jefe de Estación','Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, i.como_fue_identificado === o, 80); cx += 80; });
    y += smallH + 2;

    // DIAGNÓSTICO
    drawSectionTitle('DIAGNÓSTICO', y); y += 14;
    doc.rect(M, y, W, 24).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Causa raíz del fallo', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(i.causa_raiz || '', M + 2, y + 9, { width: W - 4 }); y += 24;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Metodo Utilizado de Diagnóstico', M + 2, y + 1, { width: 145 });
    cx = M + 147;
    ['Inspección Visual','Prueba de Medición','Prueba de Funcionamiento','Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, i.metodo_diagnostico === o, 95); cx += 95; });
    y += smallH + 2;

    // ACCIONES CORRECTIVAS
    drawSectionTitle('ACCIONES CORRECTIVAS EJECUTADAS', y); y += 14;
    doc.rect(M, y, W, 24).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Descripción de la Corrección', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(i.descripcion_correccion || '', M + 2, y + 9, { width: W - 4 }); y += 24;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Tipo de Pruebas realizadas', M + 2, y + 1, { width: 130 });
    cx = M + 132;
    ['Inspección Visual','Prueba de Medición','Prueba de Funcionamiento','Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, i.tipo_pruebas === o, 95); cx += 95; });
    y += smallH + 2;

    // RESULTADOS
    drawSectionTitle('RESULTADOS', y); y += 14;
    doc.rect(M, y, W, smallH + 1).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Estado en que se deja el equipo', M + 2, y + 1, { width: 145 });
    cx = M + 147;
    ['Equipo Operativo','Equipo en Pruebas','Equipo Fuera de Serv.','Equipo pendiente de Refacción','Otro'].forEach(o => { drawCheckbox(cx, y + 1.5, o, i.estado_equipo === o, 78); cx += 80; });
    y += smallH + 2;

    // ACCIONES PREVENTIVAS
    drawSectionTitle('ACCIONES PREVENTIVAS SUGERIDAS', y); y += 14;
    doc.rect(M, y, W, 22).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Acciones preventivas', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(i.acciones_preventivas || '', M + 2, y + 9, { width: W - 4 }); y += 22;

    // HERRAMIENTAS
    drawSectionTitle('HERRAMIENTAS Y/O MATERIAL UTILIZADO', y); y += 14;
    doc.rect(M, y, W, 20).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Herramienta / Material', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(i.herramienta_material || '', M + 2, y + 9, { width: W - 4 }); y += 20;
    doc.rect(M, y, W, 18).stroke('#cccccc');
    doc.fill('#555').fontSize(5.5).font('Helvetica-Bold').text('Refacciones', M + 2, y + 1);
    doc.fill('#000').fontSize(6.5).font('Helvetica').text(i.refacciones || '', M + 2, y + 9, { width: W - 4 }); y += 18;

    // REPORTE FOTOGRÁFICO - 2x2 grid per side, fills available space
    const antesF = fotos.filter(f => f.tipo === 'antes');
    const despuesF = fotos.filter(f => f.tipo === 'despues');
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
      if (i < antesF.length) {
        const fp = path.join(__dirname, antesF[i].url_foto);
        if (fs.existsSync(fp)) try { doc.image(fp, px + 1, py + 1, { fit: [cellW - 2, cellH - 2] }); } catch(e) {}
      }
      doc.rect(px, py, cellW, cellH).stroke('#cccccc');
    }
    for (let i = 0; i < 4; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const px = M + halfW + 10 + col * (cellW + 4);
      const py = y + row * cellH;
      if (i < despuesF.length) {
        const fp = path.join(__dirname, despuesF[i].url_foto);
        if (fs.existsSync(fp)) try { doc.image(fp, px + 1, py + 1, { fit: [cellW - 2, cellH - 2] }); }catch(e) {}
      }
      doc.rect(px, py, cellW, cellH).stroke('#cccccc');
    }
    y += photoSectionH + 3;

    // SIGNATURES - line below the name
    y += 6;
    const blockW = (W - 30) / 3;
    const starts = [M, M + blockW + 15, M + 2 * (blockW + 15)];
    [
      { role: 'Técnico', name: i.tecnico_asignado || '' },
      { role: 'Gerente de Mantenimiento', name: i.gerente_mantenimiento || '' },
      { role: 'Supervisor UO-TIMT', name: i.supervisor_uo_timt || '' }
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
  app.listen(PORT, () => { console.log(`App Hitchi en http://localhost:${PORT}`); console.log(`Equipos: ${equipos.length} en ${estacionesUnicas.length} estaciones`); });
}).catch(e => { console.error('Error:', e); process.exit(1); });
