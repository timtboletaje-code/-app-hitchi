#!/usr/bin/env node
// Regenera pwa/equiposData.js a partir de equipos.json
// Uso: node actualizar-equipos.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = path.join(root, 'equipos.json');
const dst = path.join(root, 'pwa', 'equiposData.js');

if (!fs.existsSync(src)) {
  console.error('No existe ' + src);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(src, 'utf8'));

const errores = [];
data.forEach((e, i) => {
  ['estacion', 'equipo', 'loc_id'].forEach(k => {
    if (typeof e[k] !== 'string' || !e[k].trim()) errores.push(`fila ${i + 1}: falta "${k}"`);
  });
});
if (errores.length) {
  console.error('Equipos.json tiene errores:');
  errores.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

const dups = new Map();
data.forEach(e => {
  const k = e.estacion + '|' + e.equipo + '|' + e.loc_id;
  dups.set(k, (dups.get(k) || 0) + 1);
});
const repetidos = [...dups.entries()].filter(([, n]) => n > 1);
if (repetidos.length) {
  console.warn(`AVISO: hay ${repetidos.length} filas duplicadas`);
}

const out = 'window.EQUIPOS = ' + JSON.stringify(data) + ';\n';
fs.writeFileSync(dst, out);

console.log(`OK: ${data.length} filas escritas en ${path.relative(root, dst)}`);
