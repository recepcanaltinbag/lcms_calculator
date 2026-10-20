// Sample quantification: parse sample names into design factors, convert
// peak areas to concentrations with the calibration curves, flag QC issues,
// then aggregate replicates and fit degradation kinetics.
import { area } from './parse.js';
import { chem, DEFAULT_GROUPS } from './chemicals.js';
import { invert } from './calibration.js';
import { mean, sd, median, wls, t95, welch } from './stats.js';

export const EXP_DEFAULTS = {
  dilution: 1,              // sample dilution before injection
  isConcSample: null,       // µM IS in the vial; null = same as the calibration standards
  mode: 'absolute',         // 'absolute' (calibrated µM) | 'relative' (% of t0 only)
  c0: null,                 // nominal starting concentration, µM (shown as a reference line)
  products: true,           // also quantify transformation products (BDMA, DDMA)
  naming: { order: null, bareTimeUnit: 'h' },
  groups: {},               // extra group codes → chemical id
  conditions: {},           // name token → condition label (enzyme, plasmid, strain…)
  defaultCondition: '',
  rules: [],                // [{ where: {condition, group, name}, set: {...} }]
  exclude: [],              // [{ name, analyte?, reason }]
  renames: [],              // [{ row, name }] fix mislabelled injections
  ionRatioTol: 30,          // % deviation of qualifier/quantifier ratio
  isLow: 0.5, isHigh: 1.5,  // IS area window relative to the run median
};

export const isBlank = n => /^(acn|blank|water|solvent|meoh|ctrl_?blank)/i.test(n);

const TIME_RE = /^(t|d)?(\d+(?:\.\d+)?)(h|hr|hrs|m|min|d)?$/i;
const REP_RE = /^r?(\d+)$/i;

function timeToHours(tok, bareUnit) {
  const m = tok.match(TIME_RE);
  if (!m) return null;
  const v = Number(m[2]);
  const unit = (m[3] || (m[1]?.toLowerCase() === 'd' ? 'd' : m[1] ? 'h' : bareUnit)).toLowerCase();
  if (unit === 'd') return v * 24;
  if (unit === 'm' || unit === 'min') return v / 60;
  return v;
}

export function parseSampleName(name, exp) {
  if (isBlank(name)) return { blank: true };
  const groups = Object.fromEntries(Object.entries({ ...DEFAULT_GROUPS, ...exp.groups }).map(([k, v]) => [k.toLowerCase(), v]));
  const conds = Object.fromEntries(Object.entries(exp.conditions).map(([k, v]) => [k.toLowerCase(), v]));
  const tokens = name.split(/[_\s]+/).filter(Boolean);
  const out = { condition: exp.defaultCondition || '', group: null, groupCode: null, time: null, rep: 1 };
  const order = exp.naming?.order;
  const bare = exp.naming?.bareTimeUnit || 'h';

  if (order) {
    order.forEach((field, i) => {
      const tok = tokens[i];
      if (tok == null || field === 'skip') return;
      if (field === 'condition') out.condition = conds[tok.toLowerCase()] ?? tok;
      else if (field === 'group') { out.groupCode = tok; out.group = groups[tok.toLowerCase()] ?? null; }
      else if (field === 'time') out.time = timeToHours(tok, bare);
      else if (field === 'rep') { const m = tok.match(REP_RE); out.rep = m ? Number(m[1]) : 1; }
    });
  } else {
    const rest = [];
    let condSet = false;
    for (const tok of tokens) {
      const low = tok.toLowerCase();
      if (!condSet && conds[low] != null) { out.condition = conds[low]; condSet = true; }
      else if (!out.group && groups[low]) { out.group = groups[low]; out.groupCode = tok; }
      else rest.push(tok);
    }
    // Last bare/"r"-prefixed integer is the replicate; the first time-like token is the time.
    const repIdx = rest.length > 1 || /^r\d+$/i.test(rest[0] || '')
      ? rest.map((t, i) => [t, i]).reverse().find(([t]) => REP_RE.test(t))?.[1] : undefined;
    if (repIdx != null) out.rep = Number(rest[repIdx].match(REP_RE)[1]);
    const timeTok = rest.find((t, i) => i !== repIdx && TIME_RE.test(t));
    if (timeTok != null) out.time = timeToHours(timeTok, bare);
  }
  if (!out.group || out.time == null) return { unparsed: true };
  return out;
}

function ruleMatches(where = {}, rec, name) {
  if (where.condition != null && [].concat(where.condition).every(c => c.toLowerCase() !== String(rec.condition).toLowerCase())) return false;
  if (where.group != null && ![].concat(where.group).some(g => g === rec.group || g.toLowerCase() === String(rec.groupCode).toLowerCase())) return false;
  if (where.name != null && !new RegExp(where.name, 'i').test(name)) return false;
  if (where.time != null && where.time !== rec.time) return false;
  return true;
}

// When an analyte responds in several calibrations, take the one where it was
// actually spiked: its top-standard peak area is far larger than cross-talk or
// contamination in another set of standards. Ties keep the listed order.
function pickCurve(calibrations, chemId, only) {
  let best = null;
  for (const cal of calibrations) {
    if (only && !only.includes(cal.id)) continue;
    const c = cal.curves[chemId];
    if (!c || c.status !== 'ok') continue;
    if (!best || c.topArea > 10 * best.curve.topArea) best = { cal, curve: c };
  }
  return best;
}

export function quantify(parsed, calibrations, config = {}) {
  const exp = { ...EXP_DEFAULTS, ...config, naming: { ...EXP_DEFAULTS.naming, ...(config.naming || {}) } };
  const notes = [...parsed.warnings];

  // Apply renames to a copy of the rows.
  const rows = parsed.rows.map(r => ({ ...r }));
  for (const rn of exp.renames) {
    const r = rows[rn.row];
    if (r) { notes.push(`Row ${rn.row} renamed "${r.name}" → "${rn.name}"${rn.reason ? ` (${rn.reason})` : ''}.`); r.originalName = r.name; r.name = rn.name; }
  }

  const blanks = rows.filter(r => isBlank(r.name));
  const samples = [], unparsed = [];
  for (const r of rows) {
    if (isBlank(r.name)) continue;
    const info = parseSampleName(r.name, exp);
    if (info.unparsed) unparsed.push(r.name); else samples.push({ row: r, info });
  }
  if (unparsed.length) notes.push(`Sample names not understood (skipped): ${unparsed.join(', ')}`);

  // Re-injections: keep the last injection of each design point.
  const seen = new Map();
  for (const s of samples) {
    const k = `${s.info.condition}|${s.info.group}|${s.info.time}|${s.info.rep}`;
    if (seen.has(k)) seen.get(k).superseded = true;
    seen.set(k, s);
  }

  const blankLevel = chemId => {
    const v = blanks.map(b => area(b, chemId, 1)).filter(x => x > 0);
    return v.length ? median(v) : 0;
  };

  // Pass 1: decide, for every sample × analyte, the settings, the curve and the IS.
  const plans = [];
  const missingProducts = new Set();
  for (const s of samples) {
    const { row, info } = s;
    let set = { mode: exp.mode, dilution: exp.dilution, isConcSample: exp.isConcSample, is: undefined, calibrations: null };
    for (const rule of exp.rules) if (ruleMatches(rule.where, info, row.name)) set = { ...set, ...rule.set };
    const analytes = [{ id: info.group, role: 'substrate' }];
    const prod = chem(info.group).product;
    if (exp.products && prod && set.mode === 'absolute') {
      if (pickCurve(calibrations, prod, set.calibrations)) analytes.push({ id: prod, role: 'product' });
      else missingProducts.add(prod);
    }
    for (const an of analytes) {
      const picked = set.mode === 'absolute' ? pickCurve(calibrations, an.id, set.calibrations) : null;
      const isChem = set.mode === 'absolute' ? picked?.cal.config.is : set.is;
      plans.push({ s, set, an, picked, isChem: isChem || null });
    }
  }

  // Median IS area per IS compound, over the injections that use it as IS.
  const isRows = {};
  for (const p of plans) if (p.isChem) (isRows[p.isChem] ||= new Map()).set(p.s.row.index, p.s.row);
  const runIS = {};
  for (const [id, rowsUsing] of Object.entries(isRows))
    runIS[id] = median([...rowsUsing.values()].map(r => area(r, id, 1)).filter(v => v > 0));

  // Pass 2: compute.
  const records = [];
  for (const { s, set, an, picked, isChem } of plans) {
    const { row, info } = s;
    const rec = {
      row: row.index, name: row.name, originalName: row.originalName, condition: info.condition,
      group: info.group, groupCode: info.groupCode, time: info.time, rep: info.rep,
      analyte: an.id, role: an.role, mode: set.mode, flags: [], excluded: false,
      area: area(row, an.id, 1), qual: area(row, an.id, 2),
    };
    records.push(rec);
    if (s.superseded) { rec.excluded = true; rec.reason = 're-injected later in the run'; }
    const ex = exp.exclude.find(e => (e.name === row.name || e.name === row.originalName) && (!e.analyte || e.analyte === an.id));
    if (ex) { rec.excluded = true; rec.reason = ex.reason || 'excluded manually'; }

    if (set.mode === 'absolute') {
      if (!picked) { rec.flags.push('no calibration'); rec.value = null; continue; }
      rec.calId = picked.cal.id;
    }
    rec.is = isChem;
    rec.isArea = isChem ? area(row, isChem, 1) : null;
    if (isChem) {
      const med = runIS[isChem];
      const rel = rec.isArea > 0 && med > 0 ? rec.isArea / med : 0;
      rec.isRel = rel;
      if (rel < 0.1) { rec.flags.push('IS missing'); rec.value = null; continue; }
      if (rel < exp.isLow || rel > exp.isHigh) rec.flags.push('IS deviation');
    }
    const a = rec.area > 0 ? rec.area : 0;
    if (!(rec.area > 0)) rec.flags.push('not detected');
    else if (rec.area <= 3 * blankLevel(an.id)) rec.flags.push('≤ 3× blank');
    rec.y = isChem ? a / rec.isArea : a;

    if (set.mode === 'absolute') {
      const { cal, curve } = picked;
      const isScale = isChem ? (set.isConcSample ?? cal.config.isConc) / cal.config.isConc : 1;
      rec.vial = Math.max(0, invert(curve, rec.y) * isScale);
      rec.value = rec.vial * set.dilution;
      rec.unit = 'µM';
      rec.dilution = set.dilution;
      if (rec.area > 0 && rec.vial < curve.lloq) rec.flags.push('< LLOQ');
      if (rec.vial > curve.uloq * 1.15) rec.flags.push('> ULOQ');
      if (curve.ionRatio && rec.qual > 0 && rec.vial >= curve.lloq) {
        const dev = 100 * Math.abs(rec.qual / rec.area / curve.ionRatio.mean - 1);
        if (dev > exp.ionRatioTol) rec.flags.push('ion ratio');
        rec.ionRatioDev = dev;
      }
    } else {
      rec.value = rec.y;
      rec.unit = isChem ? 'area ratio' : 'area';
    }
  }

  if (missingProducts.size) notes.push(`No calibration for product(s) ${[...missingProducts].join(', ')}; not quantified.`);

  // Aggregate replicates per design point.
  const keyOf = r => `${r.condition}|${r.group}|${r.analyte}`;
  const series = new Map();
  for (const r of records) {
    if (!series.has(keyOf(r))) series.set(keyOf(r), { condition: r.condition, group: r.group, analyte: r.analyte, role: r.role, mode: r.mode, records: [] });
    series.get(keyOf(r)).records.push(r);
  }
  const times = [...new Set(records.map(r => r.time))].sort((a, b) => a - b);
  for (const sr of series.values()) {
    const used = sr.records.filter(r => !r.excluded && Number.isFinite(r.value));
    const ts = [...new Set(sr.records.map(r => r.time))].sort((a, b) => a - b);
    sr.points = ts.map(t => {
      const v = used.filter(r => r.time === t).map(r => r.value);
      return { time: t, n: v.length, mean: mean(v), sd: sd(v), values: v };
    });
    const t0 = sr.points[0];
    // Percent of the mean starting value, per replicate (substrates only).
    if (sr.role === 'substrate' && t0 && t0.mean > 0) {
      for (const r of sr.records) r.percent = Number.isFinite(r.value) ? 100 * r.value / t0.mean : null;
      for (const p of sr.points) {
        const v = used.filter(r => r.time === p.time).map(r => r.percent);
        p.pctMean = mean(v); p.pctSd = sd(v);
      }
    }
    if (sr.role === 'substrate' && ts.length === 2) {
      const a = used.filter(r => r.time === ts[0]).map(r => r.value);
      const b = used.filter(r => r.time === ts[1]).map(r => r.value);
      sr.test = welch(a, b);
    }
    if (sr.role === 'substrate' && ts.length >= 3) sr.kinetics = fitFirstOrder(used);
  }

  return {
    config: exp, records, series: [...series.values()], times, notes,
    blanks: blanks.map(b => ({ row: b.index, name: b.name, areas: b.areas })),
    runIS: Object.entries(runIS).map(([id, med]) => ({ id, median: med, rows: [...isRows[id].keys()] })),
    injections: rows.map(r => ({ row: r.index, name: r.name, blank: isBlank(r.name), areas: r.areas })),
  };
}

// First-order decay C = C0·e^(−k·t), fitted on ln C. Points below LLOQ or not
// detected carry no information about the rate and are left out of the fit.
export function fitFirstOrder(records) {
  const pts = records.filter(r => r.value > 0 && !r.flags.some(f => f === 'not detected' || f === '< LLOQ' || f === '≤ 3× blank'));
  const times = new Set(pts.map(r => r.time));
  if (times.size < 3) return null;
  const f = wls(pts.map(r => r.time), pts.map(r => Math.log(r.value)));
  const k = -f.slope;
  const ci = t95(f.df) * f.seSlope;
  return {
    k, kLow: k - ci, kHigh: k + ci, c0: Math.exp(f.intercept), r2: f.r2, n: f.n,
    halfLife: k > 0 ? Math.LN2 / k : Infinity,
  };
}
