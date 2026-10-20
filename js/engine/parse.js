// Parse SCIEX/Analyst-style peak-area exports: one row per injection, a
// "Sample Name" column, then "<Compound>-<transition>" area columns.
import { resolveChemical } from './chemicals.js';

const NA = new Set(['', 'n/a', 'na', 'nan', 'null', '-', '#n/a', 'no peak']);

function toNumber(s) {
  const t = String(s ?? '').trim();
  if (NA.has(t.toLowerCase())) return null;
  const v = Number(t.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function detectSep(line) {
  const count = ch => line.split(ch).length - 1;
  const tab = count('\t'), com = count(','), semi = count(';');
  if (tab >= com && tab >= semi) return '\t';
  return semi > com ? ';' : ',';
}

const sigDigits = s => s.replace(/^-?0*\.?0*/, '').replace('.', '').length;

// Two rows glued by a missing line break: the shared field holds
// "<last area of row A><sample name of row B>". Pick the split whose right
// side looks like a sample name, preferring one already seen in the file.
function repairGlued(fields, nCols, knownNames) {
  if (fields.length !== 2 * nCols - 1) return null;
  const glued = fields[nCols - 1];
  const options = [];
  for (let k = 1; k < glued.length; k++) {
    const left = glued.slice(0, k), right = glued.slice(k);
    if (!/^-?\d+(\.\d+)?$/.test(left) || !/^[A-Za-z0-9]/.test(right)) continue;
    options.push({ left, right, score: (knownNames.has(right) ? 100 : 0) - Math.abs(sigDigits(left) - 15) });
  }
  if (!options.length) return null;
  options.sort((a, b) => b.score - a.score);
  const { left, right } = options[0];
  return [
    [...fields.slice(0, nCols - 1), left],
    [right, ...fields.slice(nCols)],
  ];
}

// Returns { columns, rows, warnings }:
//   columns: [{ key, header, chem, transition, fuzzy }]
//   rows:    [{ index, name, areas: { "<chemId>|<transition>": number|null } }]
export function parseExport(text, fileName = '') {
  const warnings = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error(`${fileName}: fewer than two lines`);
  const sep = detectSep(lines[0]);
  const header = lines[0].split(sep).map(h => h.trim());
  const nameCol = header.findIndex(h => /sample\s*name/i.test(h));
  if (nameCol < 0) throw new Error(`${fileName}: no "Sample Name" column`);

  const columns = [];
  const unknown = [];
  header.forEach((h, i) => {
    if (i === nameCol || !h) return;
    const m = h.match(/^(.*?)[\s_-]+(\d)$/);
    const base = m ? m[1] : h;
    const transition = m ? Number(m[2]) : 1;
    const r = resolveChemical(base);
    if (!r) { unknown.push(h); return; }
    if (r.fuzzy) warnings.push(`Column "${h}" matched to ${r.id} by spelling similarity.`);
    const key = `${r.id}|${transition}`;
    if (columns.some(c => c.key === key)) { warnings.push(`Duplicate column for ${key} ("${h}") ignored.`); return; }
    columns.push({ index: i, key, header: h, chem: r.id, transition, fuzzy: r.fuzzy });
  });
  if (unknown.length) warnings.push(`Unrecognised columns ignored: ${unknown.join(', ')}`);

  const raw = lines.slice(1).map(l => l.split(sep));
  const knownNames = new Set(raw.filter(f => f.length === header.length).map(f => f[nameCol].trim()));
  const rows = [];
  raw.forEach((fields, li) => {
    let chunks = [fields];
    if (fields.length > header.length) {
      const fixed = repairGlued(fields, header.length, knownNames);
      if (fixed) {
        warnings.push(`Line ${li + 2}: two rows were joined without a line break; split into "${fixed[0][nameCol]}" and "${fixed[1][nameCol]}".`);
        chunks = fixed;
      } else {
        warnings.push(`Line ${li + 2}: ${fields.length} fields (expected ${header.length}); extra fields ignored.`);
      }
    }
    for (const f of chunks) {
      const name = (f[nameCol] ?? '').trim();
      if (!name) continue;
      const areas = {};
      for (const c of columns) areas[c.key] = toNumber(f[c.index]);
      rows.push({ index: rows.length, name, areas });
    }
  });
  return { fileName, columns, rows, warnings };
}

export const area = (row, chemId, transition = 1) => {
  const v = row.areas[`${chemId}|${transition}`];
  return v == null ? null : v;
};

export const chemicalsIn = parsed => [...new Set(parsed.columns.map(c => c.chem))];
