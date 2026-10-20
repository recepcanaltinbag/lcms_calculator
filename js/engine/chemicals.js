// Chemical catalog: canonical ids, display labels, cation masses and the
// column-name spellings seen in instrument exports (typos included).
// Labels use <sub>/<sup>, which both HTML and Plotly render.

export const CHEMICALS = [
  // Benzyldimethylalkylammonium (BAC) series
  { id: 'C8BDMA',  label: 'C<sub>8</sub>BDMA<sup>+</sup>',  cls: 'BAC', chain: 8,  mw: 248.43, product: 'BDMA',
    names: ['Benzyloctyldimethylammonium', 'Benzyl octyl dimethyl ammonium', 'Benzyldimethyloctylammonium'] },
  { id: 'C10BDMA', label: 'C<sub>10</sub>BDMA<sup>+</sup>', cls: 'BAC', chain: 10, mw: 276.48, product: 'BDMA',
    names: ['Benzyldimethyldecylammonium', 'Benzyl dimethyl decyl ammonium'] },
  { id: 'C12BDMA', label: 'C<sub>12</sub>BDMA<sup>+</sup>', cls: 'BAC', chain: 12, mw: 304.54, product: 'BDMA',
    names: ['Benzyldimethyldodecylammonium'] },
  { id: 'C14BDMA', label: 'C<sub>14</sub>BDMA<sup>+</sup>', cls: 'BAC', chain: 14, mw: 332.59, product: 'BDMA',
    names: ['Benzyldimethyltetradecylammonium'] },
  { id: 'C16BDMA', label: 'C<sub>16</sub>BDMA<sup>+</sup>', cls: 'BAC', chain: 16, mw: 360.64, product: 'BDMA',
    names: ['Benzyldimethylhexadecylammonium'] },
  // Alkyltrimethylammonium (ATMA) series
  { id: 'C6TMA',  label: 'C<sub>6</sub>TMA<sup>+</sup>',  cls: 'ATMA', chain: 6,  mw: 144.28,
    names: ['Hexyltrimethylammonium', 'Hexyltrimethylammonuim', 'Hexyl trimethyl ammonium'] },
  { id: 'C8TMA',  label: 'C<sub>8</sub>TMA<sup>+</sup>',  cls: 'ATMA', chain: 8,  mw: 172.33,
    names: ['Octyltrimethylammonium', 'Octyl trimethyl ammonium'] },
  { id: 'C10TMA', label: 'C<sub>10</sub>TMA<sup>+</sup>', cls: 'ATMA', chain: 10, mw: 200.38,
    names: ['Decyltrimethylammonium', 'Decyl trimethyl ammonium'] },
  { id: 'C12TMA', label: 'C<sub>12</sub>TMA<sup>+</sup>', cls: 'ATMA', chain: 12, mw: 228.44,
    names: ['Dodecyltrimethylammonium', 'Dodecyltrimehylammonium', 'Dodecyl trimethyl ammonium'] },
  { id: 'C14TMA', label: 'C<sub>14</sub>TMA<sup>+</sup>', cls: 'ATMA', chain: 14, mw: 256.49,
    names: ['Tetradecyltrimethylammonium', 'Myristyltrimethylammonium', 'Mysristyltrimethylammonium', 'Mysristyl trimethyl ammonium'] },
  { id: 'C16TMA', label: 'C<sub>16</sub>TMA<sup>+</sup>', cls: 'ATMA', chain: 16, mw: 284.55,
    names: ['Hexadecyltrimethyl ammonium', 'Hexadecyltrimethylammonium', 'Cetyltrimethylammonium', 'CTAB'] },
  // Dialkyldimethylammonium (DADMA) series
  { id: 'C10-10DMA', label: 'C<sub>10-10</sub>DMA<sup>+</sup>', cls: 'DADMA', chain: 10, mw: 326.62, product: 'DDMA',
    names: ['Didecyldimethyl ammonium', 'Didecyldimethylammonium', 'DDAC'] },
  { id: 'C12-12DMA', label: 'C<sub>12-12</sub>DMA<sup>+</sup>', cls: 'DADMA', chain: 12, mw: 382.73,
    names: ['Didodecyldimethylammonium', 'Didodecyldimethyammonium', 'Didodecyl dimethyl ammonium', 'DDAB'] },
  // Others
  { id: 'C16Pyr', label: 'C<sub>16</sub>Pyr<sup>+</sup>', cls: 'Pyr', chain: 16, mw: 304.54,
    names: ['Hexadecylpyridinium', 'Cetylpyridinium'] },
  { id: 'TOA', label: 'TOA<sup>+</sup>', cls: 'TAA', chain: 8, mw: 466.89,
    names: ['Tetraoctylammonium', 'Tetraocytl ammonium'] },
  { id: 'TBA', label: 'TBA<sup>+</sup>', cls: 'TAA', chain: 4, mw: 242.47,
    names: ['Tetrabutylammonium', 'Tetrabutyl ammonium'] },
  { id: 'Carnitine', label: 'L-carnitine', cls: 'natural', mw: 161.20,
    names: ['L-carnitine', 'Carnitine'] },
  // Transformation products
  { id: 'BDMA', label: 'BDMA', cls: 'product', mw: 135.21, names: ['BDMA', 'Benzyldimethylamine'] },
  { id: 'DDMA', label: 'DDMA', cls: 'product', mw: 185.35, names: ['DDMA', 'Decyldimethylamine'] },
  { id: 'BTMA', label: 'BTMA<sup>+</sup>', cls: 'product', mw: 150.24, names: ['BTMA', 'Benzyltrimethylammonium'] },
  { id: 'Pyridine', label: 'Pyridine', cls: 'product', mw: 79.10, names: ['Pyr', 'Pyridine'] },
  // Internal standards
  { id: 'd3MTP', label: 'd<sub>3</sub>-MTP', cls: 'IS', names: ['d3MTP', 'd3-MTP'] },
];

const BY_ID = new Map(CHEMICALS.map(c => [c.id, c]));

// Default sample-name group codes → chemical id. Experiments can extend or
// override this (e.g. "dd" means C10-10DMA in one series, C12-12DMA in another).
export const DEFAULT_GROUPS = {
  c8b: 'C8BDMA', b8: 'C8BDMA',
  c10b: 'C10BDMA', b10: 'C10BDMA',
  c12: 'C12BDMA', b12: 'C12BDMA', c12b: 'C12BDMA', bc12: 'C12BDMA',
  c14: 'C14BDMA', b14: 'C14BDMA', c14b: 'C14BDMA', bc14: 'C14BDMA',
  c16: 'C16BDMA', b16: 'C16BDMA', c16b: 'C16BDMA', bc16: 'C16BDMA',
  c6t: 'C6TMA', t6: 'C6TMA',
  c8t: 'C8TMA', t8: 'C8TMA',
  c10t: 'C10TMA', t10: 'C10TMA',
  c12t: 'C12TMA', t12: 'C12TMA',
  c14t: 'C14TMA', t14: 'C14TMA',
  c16t: 'C16TMA', t16: 'C16TMA', ctab: 'C16TMA', ct: 'C16TMA',
  ddac: 'C10-10DMA', ddab: 'C12-12DMA',
  pyr: 'C16Pyr', toa: 'TOA', tba: 'TBA',
};

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const NAME_INDEX = new Map();
for (const c of CHEMICALS) {
  NAME_INDEX.set(norm(c.id), c.id);
  for (const n of c.names) NAME_INDEX.set(norm(n), c.id);
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Resolve an export column base name (without the "-1"/"-2" suffix) to a
// chemical id. Returns { id, fuzzy } or null for unknown names.
export function resolveChemical(name) {
  const key = norm(name);
  if (NAME_INDEX.has(key)) return { id: NAME_INDEX.get(key), fuzzy: false };
  if (key.length < 8) return null;
  let best = null, bestD = Infinity;
  for (const [k, id] of NAME_INDEX) {
    if (k.length < 8) continue;
    const d = levenshtein(key, k);
    if (d < bestD) { bestD = d; best = id; }
  }
  return bestD <= 2 ? { id: best, fuzzy: true } : null;
}

export function chem(id) {
  return BY_ID.get(id) || { id, label: id, cls: 'unknown', names: [] };
}

export const label = id => chem(id).label;
export const plainLabel = id => chem(id).label.replace(/<[^>]+>/g, '');
