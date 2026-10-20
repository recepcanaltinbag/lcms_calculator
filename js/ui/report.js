// Experiment report: parameter panel, results, calibration, QC and data tabs.
// Used by report.html (registered experiments) and analyzer.html (uploads).
import { runExperiment, label, plainLabel, chem } from '../engine/index.js';
import {
  draw, exportFigure, calibrationFigure, accuracyFigure, endpointFigure, heatmapFigure,
  timecourseFigure, overlayFigure, rateFigure, isTraceFigure, timeLabel, toUnit, seriesColor,
} from './charts.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (tag, attrs = {}, html = '') => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  if (html) el.innerHTML = html;
  return el;
};
const fmt = (v, d = 3) => Number.isFinite(v) ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : String(+v.toPrecision(d))) : '—';
const pm = (m, s, d = 3) => Number.isFinite(m) ? `${fmt(m, d)}${Number.isFinite(s) ? ` ± ${fmt(s, 2)}` : ''}` : '—';
const pFmt = p => p == null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3);

const FLAG_INFO = {
  'IS missing': ['bad', 'Internal standard < 10 % of the run median; no concentration reported.'],
  'IS deviation': ['warn', 'Internal standard outside 50–150 % of the run median (matrix effect, injection or spiking error).'],
  'not detected': ['warn', 'No peak integrated; reported as 0.'],
  '≤ 3× blank': ['warn', 'Peak area not above 3× the median solvent blank: indistinguishable from carry-over/background.'],
  '< LLOQ': ['warn', 'Below the lowest accepted calibration standard: value is an estimate.'],
  '> ULOQ': ['warn', 'Above the highest accepted standard (×1.15): extrapolated; dilute and re-inject for an exact value.'],
  'ion ratio': ['warn', 'Qualifier/quantifier ratio deviates > 30 % from the standards: possible interference.'],
  'no calibration': ['bad', 'No accepted calibration curve for this analyte.'],
};
const flagBadge = f => `<span class="badge ${FLAG_INFO[f]?.[0] || ''}" title="${esc(FLAG_INFO[f]?.[1] || '')}">${esc(f)}</span>`;

function download(name, text, type = 'text/csv') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}
const csv = rows => rows.map(r => r.map(v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n');

function chartCard(title, sub, fig, { file = 'figure', widthMm = 89, heightMm } = {}) {
  const card = h('div', { class: 'chart-card' });
  const head = h('div', { class: 'chart-head' }, `<h3>${title}</h3>`);
  const actions = h('div', { class: 'chart-actions' });
  const plot = h('div', { class: 'plot' });
  for (const fmtName of ['svg', 'png']) actions.appendChild(h('button', {
    title: `Download ${fmtName.toUpperCase()} in print style (${widthMm} mm wide)`,
    onclick: () => exportFigure(plot, { format: fmtName, widthMm, heightMm, filename: file }),
  }, fmtName.toUpperCase()));
  head.appendChild(actions);
  card.appendChild(head);
  if (sub) card.appendChild(h('div', { class: 'sub' }, sub));
  card.appendChild(plot);
  card._draw = () => draw(plot, fig);
  return card;
}

function mount(container, cards) {
  for (const c of cards) container.appendChild(c);
  // Callers append the container right after mounting; draw once that has run.
  queueMicrotask(() => cards.forEach(c => c._draw?.()));
}

// ── Persistence of viewer choices (per experiment) ────────────────────────
const store = {
  get(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export async function renderExperiment(root, { registry, expId, readText, source = 'registry' }) {
  const exp = registry.experiments.find(e => e.id === expId);
  const skey = `lcms:${source}:${expId}`;
  const saved = store.get(skey, {});
  const state = {
    params: { dilution: exp.dilution ?? 1, isConcSample: exp.isConcSample ?? null, weighting: '1/x2', origin: false, autoExclude: true, ...saved.params },
    view: { metric: exp.mode === 'relative' ? 'pct' : 'conc', log: false, tab: 'results', ...saved.view },
    excluded: saved.excluded || [],
  };
  const assumed = new Set(exp.assumed || []);
  const unit = exp.displayTimeUnit || 'h';
  let run;

  const persist = () => store.set(skey, { params: state.params, view: state.view, excluded: state.excluded });

  async function compute() {
    const calOverrides = {};
    for (const id of exp.calibrations || []) calOverrides[id] = { weighting: state.params.weighting, origin: state.params.origin, autoExclude: state.params.autoExclude };
    run = await runExperiment(registry, expId, readText, {
      dilution: Number(state.params.dilution) || 1,
      isConcSample: state.params.isConcSample === '' || state.params.isConcSample == null ? null : Number(state.params.isConcSample),
      exclude: [...(exp.exclude || []), ...state.excluded],
      calOverrides,
    });
  }

  root.innerHTML = '';
  const head = h('section');
  head.innerHTML = `
    <div class="muted small">${esc(exp.design === 'timecourse' ? 'Time course' : 'End-point')} · <span class="mono">${esc(exp.file)}</span></div>
    <h1>${esc(exp.title)}</h1>
    ${exp.note ? `<div class="callout info">${esc(exp.note)}</div>` : ''}
    ${assumed.size ? `<div class="callout">Highlighted parameters (${[...assumed].map(esc).join(', ')}) were carried over from the old analysis and are <b>not yet confirmed</b>. Check them against the lab notebook; results scale linearly with dilution.</div>` : ''}
    ${(exp.rules || []).filter(r => r.why).map(r => `<div class="callout info">${esc(r.why)}</div>`).join('')}`;
  root.appendChild(head);

  // Parameter toolbar
  const bar = h('div', { class: 'toolbar card' });
  const numField = (key, lbl, placeholder = '') => {
    const f = h('label', { class: `field${assumed.has(key) || (key === 'isConcSample' && assumed.has('isConc')) ? ' assumed' : ''}` }, `<span>${lbl}</span>`);
    const inp = h('input', { type: 'number', step: 'any', min: '0', placeholder });
    inp.value = state.params[key] ?? '';
    inp.addEventListener('change', () => { state.params[key] = inp.value === '' ? null : Number(inp.value); refresh(); });
    f.appendChild(inp); return f;
  };
  const selField = (key, lbl, opts) => {
    const f = h('label', { class: 'field' }, `<span>${lbl}</span>`);
    const s = h('select');
    for (const [v, t] of opts) { const o = h('option', { value: v }, t); if (String(state.params[key]) === v) o.selected = true; s.appendChild(o); }
    s.addEventListener('change', () => { state.params[key] = s.value === 'true' ? true : s.value === 'false' ? false : s.value; refresh(); });
    f.appendChild(s); return f;
  };
  const seg = (key, lbl, opts) => {
    const f = h('div', { class: 'field' }, `<span>${lbl}</span>`);
    const g = h('div', { class: 'seg' });
    for (const [v, t] of opts) {
      const b = h('button', { class: state.view[key] === v ? 'on' : '' }, t);
      b.addEventListener('click', () => { state.view[key] = v; [...g.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); persist(); renderTabs(); });
      g.appendChild(b);
    }
    f.appendChild(g); return f;
  };
  bar.append(
    numField('dilution', 'Dilution factor'),
    numField('isConcSample', 'IS in samples (µM)', '= standards'),
    selField('weighting', 'Calibration weighting', [['1/x2', '1/x²'], ['1/x', '1/x'], ['none', 'none']]),
    selField('origin', 'Intercept', [['false', 'fitted'], ['true', 'forced through 0']]),
    selField('autoExclude', 'Failing standards', [['true', 'auto-exclude'], ['false', 'keep all']]),
  );
  if (exp.mode !== 'relative') bar.append(seg('metric', 'Show', [['conc', 'µM'], ['pct', '% of t₀']]));
  bar.append(seg('log', 'Y scale', [[false, 'linear'], [true, 'log']]));
  const resetBtn = h('button', { class: 'btn', onclick: () => { store.set(skey, {}); renderExperiment(root, { registry, expId, readText, source }); } }, 'Reset');
  const cfgBtn = h('button', { class: 'btn', title: 'Download this experiment entry with your current settings, ready to paste into experiments.json', onclick: () => {
    const out = { ...exp, dilution: state.params.dilution, isConcSample: state.params.isConcSample, exclude: [...(exp.exclude || []), ...state.excluded] };
    download(`${expId}.config.json`, JSON.stringify(out, null, 2), 'application/json');
  } }, 'Export config');
  bar.append(h('div', { class: 'field' }, '<span>&nbsp;</span>'), resetBtn, cfgBtn);
  root.appendChild(bar);

  const statsEl = h('div', { class: 'stats' });
  const tabsEl = h('div', { class: 'tabs' });
  const body = h('div');
  root.append(statsEl, tabsEl, body);

  async function refresh() { persist(); await compute(); renderStats(); renderTabs(); }

  function renderStats() {
    const r = run.result;
    const subs = r.records.filter(x => x.role === 'substrate');
    const flagged = subs.filter(x => x.flags.length).length;
    const nSamples = new Set(r.records.map(x => x.name)).size;
    const tiles = [
      [nSamples, 'samples'],
      [r.injections.length, 'injections'],
      [run.calibrations.reduce((n, c) => n + Object.values(c.curves).filter(v => v.status === 'ok').length, 0), 'accepted curves'],
      [flagged, 'flagged results'],
      [r.records.filter(x => x.excluded).length, 'excluded'],
    ];
    statsEl.innerHTML = tiles.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  }

  const TABS = [['results', 'Results'], ['calibration', 'Calibration'], ['qc', 'Quality control'], ['data', 'Data table']];
  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const [id, t] of TABS) {
      const b = h('button', { class: state.view.tab === id ? 'on' : '' }, t);
      b.addEventListener('click', () => { state.view.tab = id; persist(); renderTabs(); });
      tabsEl.appendChild(b);
    }
    body.innerHTML = '';
    ({ results: renderResults, calibration: renderCalibration, qc: renderQC, data: renderData })[state.view.tab](body);
  }

  // ── Results ─────────────────────────────────────────────────────────────
  const order = (list, key, pref) => {
    const p = pref || [];
    return [...list].sort((a, b) => {
      const ia = p.indexOf(key(a)), ib = p.indexOf(key(b));
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || String(key(a)).localeCompare(String(key(b)));
    });
  };
  const conditionsOf = r => order([...new Set(r.series.map(s => s.condition))], x => x, exp.conditionOrder);

  function renderResults(el) {
    const r = run.result;
    if (r.notes.length) el.appendChild(h('div', { class: 'callout info' }, `<b>Notes</b><ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`));
    const metric = exp.mode === 'relative' ? 'pct' : state.view.metric;
    if (exp.design === 'timecourse') return renderTimecourse(el, metric);

    const conds = conditionsOf(r);
    const substrates = order(r.series.filter(s => s.role === 'substrate'), s => s.group, exp.groupOrder);
    const groups = [...new Set(substrates.map(s => s.group))];
    const tEnd = Math.max(...r.times);

    if (groups.length > 1) {
      const heat = heatmapFigure(conds.map(c => c || 'All'), groups, (c, g) => {
        const s = substrates.find(x => (x.condition || 'All') === c && x.group === g);
        const p = s?.points.find(q => q.time === tEnd);
        return p && Number.isFinite(p.pctMean) ? p.pctMean : null;
      });
      const grid = h('div', { class: 'grid' });
      el.appendChild(h('h2', {}, `Substrate remaining after ${timeLabel(tEnd, unit)}`));
      mount(grid, [chartCard('% of t₀ remaining', 'Mean of replicates relative to the mean t₀ value of the same condition.', heat, { file: `${expId}_heatmap`, widthMm: 183, heightMm: 30 + 12 * conds.length })]);
      el.appendChild(grid);
    }

    el.appendChild(h('h2', {}, 'Substrates'));
    const grid = h('div', { class: 'grid cols-2' });
    const cards = conds.map(c => {
      const ss = substrates.filter(s => s.condition === c);
      const rel = ss.every(s => s.mode === 'relative');
      const m = rel ? 'pct' : metric;
      const fig = endpointFigure(ss, { metric: m, unit, log: state.view.log, c0: exp.c0 });
      const sub = rel ? 'Relative quantification (% of t₀) — no matching internal standard for absolute µM.' : m === 'conc' ? `Calibrated concentration in the reaction (× ${state.params.dilution} dilution). Hollow dots: flagged replicates.` : 'Relative to the mean t₀ of each substrate.';
      return chartCard(esc(c || exp.title), sub, fig, { file: `${expId}_${c || 'all'}_substrates` });
    });
    mount(grid, cards);
    el.appendChild(grid);

    const products = order(r.series.filter(s => s.role === 'product'), s => s.group, exp.groupOrder);
    if (products.length) {
      el.appendChild(h('h2', {}, 'Transformation products'));
      el.appendChild(h('p', { class: 'muted small' }, 'BDMA from benzyl-QACs and DDMA from C<sub>10-10</sub>DMA<sup>+</sup>, on the same µM axis as the substrates.'));
      const g2 = h('div', { class: 'grid cols-2' });
      mount(g2, conds.filter(c => products.some(p => p.condition === c)).map(c => {
        const ps = products.filter(p => p.condition === c).map(p => ({ ...p, analyte: p.analyte, records: p.records, _lbl: p.group }));
        const fig = endpointFigure(ps, { metric: 'conc', unit, log: state.view.log });
        fig.layout.xaxis.ticktext = ps.map(p => `${label(p.analyte)}<br><span style="font-size:10px">from ${label(p.group)}</span>`);
        return chartCard(`${esc(c || 'All')} · products`, '', fig, { file: `${expId}_${c || 'all'}_products` });
      }));
      el.appendChild(g2);
    }

    el.appendChild(h('h2', {}, 'Summary table'));
    const t0 = Math.min(...r.times);
    const rows = substrates.map(s => {
      const a = s.points.find(p => p.time === t0), b = s.points.find(p => p.time === tEnd);
      const u = s.records.find(x => x.unit)?.unit || '';
      return [s.condition, label(s.group), u, pm(a?.mean, a?.sd), pm(b?.mean, b?.sd), pm(b?.pctMean, b?.pctSd, 3), pFmt(s.test?.p), `${a?.n ?? 0} / ${b?.n ?? 0}`,
        products.filter(p => p.condition === s.condition && p.group === s.group).map(p => { const q = p.points.find(x => x.time === tEnd); return `${label(p.analyte)} ${pm(q?.mean, q?.sd)}`; }).join('')];
    });
    el.appendChild(table(['Condition', 'Substrate', 'Unit', `t = ${timeLabel(t0, unit)}`, `t = ${timeLabel(tEnd, unit)}`, '% remaining', 'p (Welch)', 'n', 'Product (µM)'], rows, [3, 4, 5, 6, 7]));
    const dl = h('button', { class: 'btn', onclick: () => download(`${expId}_summary.csv`, csv([
      ['condition', 'substrate', 'unit', 't0_mean', 't0_sd', 'tend_mean', 'tend_sd', 'pct_remaining', 'pct_sd', 'p_welch', 'n_t0', 'n_tend'],
      ...substrates.map(s => { const a = s.points.find(p => p.time === t0), b = s.points.find(p => p.time === tEnd); return [s.condition, s.group, s.records.find(x => x.unit)?.unit, a?.mean, a?.sd, b?.mean, b?.sd, b?.pctMean, b?.pctSd, s.test?.p, a?.n, b?.n]; }),
    ])) }, 'Download summary CSV');
    el.appendChild(h('div', { style: 'margin-top:10px' })).appendChild(dl);
  }

  function renderTimecourse(el, metric) {
    const r = run.result;
    for (const c of conditionsOf(r)) {
      const subs = order(r.series.filter(s => s.role === 'substrate' && s.condition === c), s => s.group, exp.groupOrder);
      if (c) el.appendChild(h('h2', {}, esc(c)));
      const top = h('div', { class: 'grid cols-2' });
      mount(top, [
        chartCard('Substrate depletion', 'Mean % of t₀ per substrate. Hover for SD.', overlayFigure(subs, { unit, log: state.view.log }), { file: `${expId}_overlay`, widthMm: 120 }),
        chartCard('Rate vs chain length', 'First-order rate constant with 95 % CI, fitted on ln C over replicates above LLOQ.', rateFigure(subs, { perMin: unit === 'min' }), { file: `${expId}_rates` }),
      ]);
      el.appendChild(top);
      el.appendChild(h('h2', {}, 'Per substrate'));
      const grid = h('div', { class: 'grid cols-3' });
      mount(grid, subs.map((s, i) => {
        const k = s.kinetics;
        const sub = k ? `k = ${fmt(unit === 'min' ? k.k / 60 : k.k)} ${unit === 'min' ? 'min⁻¹' : 'h⁻¹'} · t½ = ${fmt(unit === 'min' ? k.halfLife * 60 : k.halfLife)} ${unit} · R² = ${k.r2.toFixed(3)}` : 'Not enough points above LLOQ for a rate fit.';
        return chartCard(label(s.group), sub, timecourseFigure(s, { unit, metric, log: state.view.log, color: seriesColor(i) }), { file: `${expId}_${s.group}` });
      }));
      el.appendChild(grid);

      const prods = r.series.filter(s => s.role === 'product' && s.condition === c);
      if (prods.length) {
        el.appendChild(h('h2', {}, 'Transformation products'));
        const g = h('div', { class: 'grid cols-3' });
        mount(g, prods.map(p => chartCard(`${label(p.analyte)} from ${label(p.group)}`, 'µM formed over time.', timecourseFigure(p, { unit, metric: 'conc', log: false, color: seriesColor(4) }), { file: `${expId}_${p.analyte}_${p.group}` })));
        el.appendChild(g);
      }

      el.appendChild(h('h2', {}, 'Kinetics table'));
      const kf = unit === 'min' ? 1 / 60 : 1, ku = unit === 'min' ? 'min⁻¹' : 'h⁻¹';
      el.appendChild(table(['Substrate', `k (${ku})`, '95 % CI', `t½ (${unit})`, 'R²', 'points', `C₀ fit (${subs[0]?.records.find(x => x.unit)?.unit || ''})`],
        subs.map(s => { const k = s.kinetics; return k ? [label(s.group), fmt(k.k * kf), `${fmt(k.kLow * kf)} – ${fmt(k.kHigh * kf)}`, fmt(unit === 'min' ? k.halfLife * 60 : k.halfLife), k.r2.toFixed(3), k.n, fmt(k.c0)] : [label(s.group), '—', '—', '—', '—', '—', '—']; }), [1, 2, 3, 4, 5, 6]));
      const dl = h('button', { class: 'btn', onclick: () => download(`${expId}_kinetics.csv`, csv([
        ['condition', 'substrate', 'k_per_h', 'k_low', 'k_high', 'half_life_h', 'r2', 'n', 'c0_fit'],
        ...subs.map(s => { const k = s.kinetics || {}; return [s.condition, s.group, k.k, k.kLow, k.kHigh, k.halfLife, k.r2, k.n, k.c0]; }),
      ])) }, 'Download kinetics CSV');
      el.appendChild(h('div', { style: 'margin-top:10px' })).appendChild(dl);
    }
  }

  // ── Calibration ─────────────────────────────────────────────────────────
  function renderCalibration(el) {
    const used = new Set(run.result.records.map(r => `${r.calId}|${r.analyte}`));
    if (!run.calibrations.length) { el.appendChild(h('p', { class: 'muted' }, 'This experiment uses relative quantification only; no calibration curves are applied.')); return; }
    for (const cal of run.calibrations) el.appendChild(calibrationSection(cal, a => used.has(`${cal.id}|${a}`)));
  }

  // ── QC ──────────────────────────────────────────────────────────────────
  function renderQC(el) {
    const r = run.result;
    const counts = {};
    r.records.forEach(x => x.flags.forEach(f => counts[f] = (counts[f] || 0) + 1));
    el.appendChild(h('h2', {}, 'Flags'));
    el.appendChild(Object.keys(counts).length
      ? table(['Flag', 'Results', 'Meaning'], Object.entries(counts).map(([f, n]) => [flagBadge(f), n, esc(FLAG_INFO[f]?.[1] || '')]), [1])
      : h('p', { class: 'muted' }, 'No flags raised.'));

    const isIds = r.runIS.map(x => x.id);
    if (isIds.length) {
      el.appendChild(h('h2', {}, 'Internal standard across the run'));
      const calMed = run.calibrations.find(c => isIds.includes(c.config.is));
      if (calMed) {
        const runMed = r.runIS.find(x => x.id === calMed.config.is)?.median;
        const ratio = runMed / calMed.isAreaMedian;
        if (ratio > 2 || ratio < 0.5) el.appendChild(h('div', { class: 'callout' }, `${plainLabel(calMed.config.is)} response in these samples is <b>${ratio.toFixed(1)}×</b> that in the calibration standards (${fmt(runMed)} vs ${fmt(calMed.isAreaMedian)}). If the same IS concentration was spiked, this is an instrument-sensitivity change that the IS ratio corrects for; if a different amount was spiked, enter it under “IS in samples”.`));
      }
      const grid = h('div', { class: 'grid cols-2' });
      mount(grid, r.runIS.map(x => chartCard(`${label(x.id)} peak area`, `Injections that use ${plainLabel(x.id)} as IS (${x.rows.length}) and blanks. Green band: 50–150 % of their median; red: outside.`, isTraceFigure(r.injections.filter(j => j.blank || x.rows.includes(j.row)), x.id, x.median), { file: `${expId}_IS_${x.id}`, widthMm: 120 })));
      el.appendChild(grid);
    }

    // Carry-over: analyte signal in blanks, expressed as µM-equivalent in the vial.
    const analytes = [...new Set(r.records.filter(x => x.role === 'substrate').map(x => x.analyte))];
    if (r.blanks.length && analytes.length) {
      el.appendChild(h('h2', {}, 'Solvent blanks (carry-over)'));
      el.appendChild(h('p', { class: 'muted small' }, 'Peak areas of each substrate in the blank injections. Large values right after high samples point to carry-over; these set the “≤ 3× blank” threshold.'));
      el.appendChild(table(['#', 'Blank', ...analytes.map(label)], r.blanks.map(b => [b.row + 1, esc(b.name), ...analytes.map(a => fmt(b.areas[`${a}|1`]))]), analytes.map((_, i) => i + 2)));
    }
    if (run.result.notes.length) {
      el.appendChild(h('h2', {}, 'File notes'));
      el.appendChild(h('ul', {}, run.result.notes.map(n => `<li>${esc(n)}</li>`).join('')));
    }
  }

  // ── Data ────────────────────────────────────────────────────────────────
  function renderData(el) {
    const r = run.result;
    el.appendChild(h('p', { class: 'muted small' }, 'Untick a row to exclude that injection from means, % remaining and fits. Your choices are kept in this browser; use “Export config” to make them permanent.'));
    const wrap = h('div', { class: 'table-wrap table-scroll' });
    const tbl = h('table');
    tbl.innerHTML = `<thead><tr><th>Use</th><th>#</th><th>Sample</th><th>Condition</th><th>Analyte</th><th class="num">Time</th><th class="num">Rep</th><th class="num">Area</th><th class="num">IS area</th><th class="num">Value</th><th>Unit</th><th class="num">% t₀</th><th>Flags</th></tr></thead>`;
    const tb = h('tbody');
    for (const x of r.records) {
      const tr = h('tr', { class: x.excluded ? 'excluded' : '' });
      const userEx = state.excluded.some(e => e.name === x.name && (!e.analyte || e.analyte === x.analyte));
      const cfgEx = x.excluded && !userEx;
      tr.innerHTML = `<td class="keep"><input type="checkbox" ${x.excluded ? '' : 'checked'} ${cfgEx ? 'disabled title="' + esc(x.reason) + '"' : ''}></td>
        <td>${x.row + 1}</td><td class="mono">${esc(x.name)}</td><td>${esc(x.condition)}</td><td>${label(x.analyte)}</td>
        <td class="num">${timeLabel(x.time, unit)}</td><td class="num">${x.rep}</td><td class="num">${fmt(x.area)}</td><td class="num">${fmt(x.isArea)}</td>
        <td class="num">${fmt(x.value)}</td><td>${esc(x.unit || '')}</td><td class="num">${fmt(x.percent)}</td>
        <td class="keep">${x.flags.map(flagBadge).join(' ')}${x.excluded ? ` <span class="badge">${esc(x.reason)}</span>` : ''}</td>`;
      tr.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) state.excluded = state.excluded.filter(q => !(q.name === x.name && q.analyte === x.analyte));
        else state.excluded.push({ name: x.name, analyte: x.analyte, reason: 'excluded in viewer' });
        refresh();
      });
      tb.appendChild(tr);
    }
    tbl.appendChild(tb); wrap.appendChild(tbl); el.appendChild(wrap);
    const dl = h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => download(`${expId}_results.csv`, csv([
      ['row', 'sample', 'condition', 'substrate', 'analyte', 'role', 'time_h', 'rep', 'area', 'is', 'is_area', 'y', 'vial_uM', 'dilution', 'value', 'unit', 'pct_of_t0', 'flags', 'excluded', 'reason', 'calibration'],
      ...r.records.map(x => [x.row + 1, x.name, x.condition, x.group, x.analyte, x.role, x.time, x.rep, x.area, x.is, x.isArea, x.y, x.vial, x.dilution, x.value, x.unit, x.percent, x.flags.join('; '), x.excluded, x.reason, x.calId]),
    ])) }, 'Download all results (CSV)');
    el.appendChild(dl);
  }

  await compute();
  renderStats();
  renderTabs();
}

// ── Shared pieces ─────────────────────────────────────────────────────────
export function table(headers, rows, numCols = []) {
  const wrap = h('div', { class: 'table-wrap' });
  wrap.innerHTML = `<table><thead><tr>${headers.map((x, i) => `<th class="${numCols.includes(i) ? 'num' : ''}">${x}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${numCols.includes(i) ? 'num' : ''}">${v ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return wrap;
}

const statusBadge = c => c.status === 'ok'
  ? (c.warnings.length ? '<span class="badge warn">ok · check</span>' : '<span class="badge good">ok</span>')
  : c.status === 'no-response' ? '<span class="badge">not in standards</span>' : '<span class="badge bad">failed</span>';

export function calibrationSection(cal, isUsed = null) {
  const badges = !!isUsed;
  isUsed = isUsed || (() => true);
  const sec = h('section');
  const cfg = cal.config;
  sec.appendChild(h('h2', {}, `${esc(cal.label)}`));
  sec.appendChild(h('p', { class: 'muted small' }, `<span class="mono">${esc(cal.fileName)}</span> · ${cfg.is ? `IS ${label(cfg.is)} ${cfg.isConc} µM (median area ${fmt(cal.isAreaMedian)}, CV ${fmt(cal.isAreaCV, 2)} %)` : 'external calibration (no IS)'} · weighting ${cfg.weighting}${cfg.origin ? ', through origin' : ''} · acceptance ±${cfg.accTol} % (±${cfg.lloqTol} % at LLOQ)`));
  if (cal.warnings.length) sec.appendChild(h('div', { class: 'callout' }, `<ul>${cal.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`));
  const curves = Object.values(cal.curves).sort((a, b) => (a.status !== 'ok') - (b.status !== 'ok'));
  sec.appendChild(table(
    ['Analyte', 'Status', 'Slope', 'Intercept', 'R²', 'Range (µM)', 'Levels', 'LOD (µM)', 'LOQ (µM)', 'Mean |bias| %', 'Ion ratio (CV)', 'Excluded standards'],
    curves.map(c => c.status !== 'ok' ? [label(c.chem), statusBadge(c), '', '', '', '', '', '', '', '', '', `<span class="muted small">${esc(c.warnings[0] || '')}</span>`] : [
      label(c.chem) + (badges && isUsed(c.chem) ? ' <span class="badge accent">used</span>' : ''), statusBadge(c), fmt(c.fit.slope, 4), fmt(c.fit.intercept, 3), c.fit.r2.toFixed(4),
      `${c.lloq} – ${c.uloq}`, c.levels, fmt(c.lod, 2), fmt(c.loq, 2), fmt(c.meanAbsError, 2),
      c.ionRatio ? `${c.ionRatio.mean.toFixed(2)} (${c.ionRatio.cv.toFixed(0)} %)` : '—',
      c.points.filter(p => p.excluded).map(p => `${p.x} µM <span class="muted">(${esc(p.reason)})</span>`).join(', ') || '—',
    ]), [2, 3, 4, 6, 7, 8, 9]));
  const ok = curves.filter(c => c.status === 'ok' && isUsed(c.chem));
  if (ok.length) {
    const det = h('details', { class: 'section', open: '' }, `<summary>Curves and back-calculated accuracy (${ok.length})</summary>`);
    const grid = h('div', { class: 'grid cols-2', style: 'margin-top:10px' });
    det.appendChild(grid);
    const cards = ok.flatMap(c => [
      chartCard(`${label(c.chem)} · response`, `y = ${fmt(c.fit.slope, 4)}·x ${c.fit.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(c.fit.intercept), 3)} · R² ${c.fit.r2.toFixed(4)}`, calibrationFigure(c, { isLabel: cfg.is ? plainLabel(cfg.is) : null }), { file: `cal_${cal.id}_${c.chem}` }),
      chartCard(`${label(c.chem)} · accuracy`, `Green band ±${cfg.accTol} %. Hollow red = excluded.`, accuracyFigure(c, cfg), { file: `cal_${cal.id}_${c.chem}_accuracy` }),
    ]);
    sec.appendChild(det);
    det.addEventListener('toggle', () => det.open && cards.forEach(c => c._draw()));
    mount(grid, cards);
  }
  return sec;
}
