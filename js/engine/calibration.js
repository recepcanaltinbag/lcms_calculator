// Calibration curves with internal-standard (or external) normalisation,
// weighted regression and automatic exclusion of standards that fail the
// back-calculated accuracy criteria (±15 %, ±20 % at the lowest level).
import { area, chemicalsIn } from './parse.js';
import { chem } from './chemicals.js';
import { wls, spearman, median, mean, sd } from './stats.js';

export const CAL_DEFAULTS = {
  is: 'd3MTP',          // internal standard chemical id, or null for external calibration
  isConc: 0.022,        // µM of IS in the standards
  concPattern: '^\\s*([0-9]*\\.?[0-9]+)',  // first number in the sample name = concentration
  unit: 'µM',
  weighting: '1/x2',    // '1/x2' | '1/x' | 'none'
  origin: false,        // force through zero
  accTol: 15,           // % allowed deviation of back-calculated standards
  lloqTol: 20,          // % allowed at the lowest level
  minLevels: 5,         // never drop below this many concentration levels
  autoExclude: true,
  exclude: [],          // [{ chem?, name?, row? }] manual exclusions
};

const isBlankName = n => /^(acn|blank|water|solvent|meoh|sample\b)/i.test(n);

function matchesExclusion(rule, chemId, row) {
  if (rule.chem && rule.chem !== chemId) return false;
  if (rule.name != null && rule.name !== row.name) return false;
  if (rule.row != null && rule.row !== row.index) return false;
  return true;
}

function fitPoints(points, cfg) {
  const inc = points.filter(p => !p.excluded);
  const fit = wls(inc.map(p => p.x), inc.map(p => p.y), { weighting: cfg.weighting, origin: cfg.origin });
  const lowest = Math.min(...inc.map(p => p.x));
  for (const p of points) {
    p.backCalc = (p.y - fit.intercept) / fit.slope;
    p.accuracy = 100 * p.backCalc / p.x;
    p.tol = p.x === lowest ? cfg.lloqTol : cfg.accTol;
  }
  return fit;
}

function buildCurve(parsed, chemId, cfg, isAreaMedian) {
  const re = new RegExp(cfg.concPattern);
  const points = [];
  for (const row of parsed.rows) {
    if (isBlankName(row.name)) continue;
    const m = row.name.match(re);
    if (!m) continue;
    const x = Number(m[1]);
    if (!(x > 0)) continue;
    const a = area(row, chemId, 1);
    const isA = cfg.is ? area(row, cfg.is, 1) : null;
    const p = { row: row.index, name: row.name, x, area: a, isArea: isA, qual: area(row, chemId, 2), excluded: false, reason: '' };
    if (!(a > 0)) { p.excluded = true; p.reason = 'no peak'; p.y = NaN; }
    else if (cfg.is && !(isA > 0)) { p.excluded = true; p.reason = 'no IS peak'; p.y = NaN; }
    else {
      p.y = cfg.is ? a / isA : a;
      if (cfg.is && isAreaMedian > 0 && (isA < 0.5 * isAreaMedian || isA > 2 * isAreaMedian)) {
        p.excluded = true; p.reason = `IS area ${(100 * isA / isAreaMedian).toFixed(0)} % of median`;
      }
    }
    const rule = cfg.exclude.find(r => matchesExclusion(r, chemId, row));
    if (rule && !p.excluded) { p.excluded = true; p.reason = rule.reason || 'excluded manually'; p.manual = true; }
    points.push(p);
  }
  const curve = { chem: chemId, points, warnings: [], status: 'ok' };
  const usable = points.filter(p => Number.isFinite(p.y));
  const levels = [...new Set(usable.map(p => p.x))];
  if (levels.length < 3) {
    curve.status = 'no-response';
    curve.warnings.push('Fewer than three concentration levels with a peak.');
    return curve;
  }
  // Is the analyte actually present in these standards? Signal must rise with
  // concentration, and by a meaningful fraction of the concentration span.
  const rho = spearman(usable.map(p => p.x), usable.map(p => p.y));
  const lo = Math.min(...levels), hi = Math.max(...levels);
  const yLo = median(usable.filter(p => p.x === lo).map(p => p.y));
  const yHi = median(usable.filter(p => p.x === hi).map(p => p.y));
  if (!(rho > 0.8) || !(yHi / yLo > 0.2 * hi / lo)) {
    curve.status = 'no-response';
    curve.rho = rho; curve.signalFold = yHi / yLo; curve.concFold = hi / lo;
    curve.warnings.push(`No concentration response (ρ = ${rho.toFixed(2)}, signal ×${(yHi / yLo).toFixed(1)} over ×${(hi / lo).toFixed(0)} concentration): analyte not in these standards.`);
    return curve;
  }

  let fit = fitPoints(points, cfg);
  if (cfg.autoExclude) {
    const nTotal = usable.length;
    for (;;) {
      const inc = points.filter(p => !p.excluded);
      const failing = inc.filter(p => Math.abs(p.accuracy - 100) > p.tol)
        .sort((a, b) => Math.abs(b.accuracy - 100) / b.tol - Math.abs(a.accuracy - 100) / a.tol);
      if (!failing.length) break;
      const incLevels = [...new Set(inc.map(p => p.x))].sort((a, b) => a - b);
      const candidate = failing.find(p => {
        const sameLevel = inc.filter(q => q.x === p.x).length;
        const levelsAfter = incLevels.length - (sameLevel === 1 ? 1 : 0);
        const atEnd = p.x === incLevels[0] || p.x === incLevels[incLevels.length - 1];
        return levelsAfter >= cfg.minLevels && (atEnd || inc.length - 1 >= Math.ceil(0.75 * nTotal));
      });
      if (!candidate) break;
      candidate.excluded = true;
      candidate.reason = `accuracy ${candidate.accuracy.toFixed(0)} %`;
      candidate.auto = true;
      fit = fitPoints(points, cfg);
    }
  }
  const inc = points.filter(p => !p.excluded);
  const still = inc.filter(p => Math.abs(p.accuracy - 100) > p.tol);
  if (still.length) curve.warnings.push(`${still.length} standard(s) outside accuracy limits could not be removed without losing the minimum of ${cfg.minLevels} levels.`);
  if (fit.slope <= 0) { curve.status = 'failed'; curve.warnings.push('Non-positive slope.'); }

  const incLevels = [...new Set(inc.map(p => p.x))].sort((a, b) => a - b);
  curve.fit = { ...fit, weighting: cfg.weighting, origin: cfg.origin };
  curve.levels = incLevels.length;
  curve.lloq = incLevels[0];
  curve.uloq = incLevels[incLevels.length - 1];
  curve.meanAbsError = mean(inc.map(p => Math.abs(p.accuracy - 100)));
  curve.topArea = median(inc.filter(p => p.x === curve.uloq).map(p => p.area));

  // Statistical LOD/LOQ (ICH Q2): residual SD of an unweighted fit over the
  // lowest three levels, divided by the slope.
  const low = inc.filter(p => p.x <= incLevels[Math.min(2, incLevels.length - 1)]);
  if (low.length >= 3) {
    const lf = wls(low.map(p => p.x), low.map(p => p.y), { origin: cfg.origin });
    if (lf.sres > 0 && fit.slope > 0) {
      curve.lod = 3.3 * lf.sres / fit.slope;
      curve.loq = 10 * lf.sres / fit.slope;
    }
  }
  // Qualifier/quantifier ion ratio from the accepted standards.
  const ratios = inc.filter(p => p.qual > 0 && p.area > 0).map(p => p.qual / p.area);
  if (ratios.length >= 3) curve.ionRatio = { mean: mean(ratios), cv: 100 * sd(ratios) / mean(ratios) };
  return curve;
}

export function buildCalibration(parsed, config = {}) {
  const cfg = { ...CAL_DEFAULTS, ...config, exclude: config.exclude || [] };
  const isAreas = cfg.is
    ? parsed.rows.filter(r => !isBlankName(r.name)).map(r => area(r, cfg.is, 1)).filter(v => v > 0)
    : [];
  const isAreaMedian = median(isAreas);
  const analytes = (cfg.analytes || chemicalsIn(parsed))
    .filter(id => id !== cfg.is && chem(id).cls !== 'IS');
  const curves = {};
  for (const id of analytes) curves[id] = buildCurve(parsed, id, cfg, isAreaMedian);
  return {
    id: cfg.id, label: cfg.label || parsed.fileName, fileName: parsed.fileName,
    config: cfg, curves, isAreaMedian, isAreaCV: isAreas.length > 1 ? 100 * sd(isAreas) / mean(isAreas) : NaN,
    warnings: parsed.warnings,
  };
}

// Back-calculate a response ratio to a concentration in the vial.
export const invert = (curve, y) => (y - curve.fit.intercept) / curve.fit.slope;
