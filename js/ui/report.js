// Experiment report: summary header, calculation and figure settings, and
// Results / Checks / Calibration / Data tabs. Used by report.html (registered
// experiments) and analyzer.html (uploaded files).
import { runExperiment, audit, label, plainLabel, chem } from '../engine/index.js';
import {
  draw, exportFigure, calibrationFigure, accuracyFigure, endpointFigure, heatmapFigure,
  timecourseFigure, overlayFigure, rateFigure, isTraceFigure, timeLabel, kinColor, FIG_DEFAULTS, hmm,
} from './charts.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const h = (tag, attrs = {}, html = '') => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  if (html) el.innerHTML = html;
  return el;
};
export const fmt = (v, d = 3) => Number.isFinite(v) ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : String(+v.toPrecision(d))) : '—';
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
const SEV = { error: ['bad', 'Error', '!'], warn: ['warn', 'Check', '?'], info: ['', 'Note', 'i'] };
const KIND_LABEL = { label: 'Sample label', duplicate: 'Re-injection', injection: 'Failed injection', outlier: 'Replicate outlier', spread: 'Replicate spread', units: 'Units / dilution', range: 'Above range', increase: 'No decrease', carryover: 'Carry-over', 'is-level': 'IS level', calibration: 'Calibration' };

export function download(name, text, type = 'text/csv') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}
const csv = rows => rows.map(r => r.map(v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n');

export function chartCard(title, sub, fig, { file = 'figure', widthMm = 89, heightMm, wide = false } = {}) {
  const card = h('div', { class: `chart-card${wide ? ' wide' : ''}` });
  const head = h('div', { class: 'chart-head' }, `<h3>${title}</h3>`);
  const actions = h('div', { class: 'chart-actions' });
  const plot = h('div', { class: 'plot' });
  for (const fmtName of ['svg', 'png']) actions.appendChild(h('button', {
    title: `Download ${fmtName.toUpperCase()} in print style (${widthMm} mm wide${fmtName === 'png' ? ', 600 dpi' : ''})`,
    onclick: () => exportFigure(plot, { format: fmtName, widthMm, heightMm, filename: file }),
  }, `↓ ${fmtName.toUpperCase()}`));
  head.appendChild(actions);
  card.appendChild(head);
  if (sub) card.appendChild(h('div', { class: 'sub' }, sub));
  card.appendChild(plot);
  card._draw = () => draw(plot, fig);
  return card;
}

export function mount(container, cards) {
  for (const c of cards) container.appendChild(c);
  // Callers append the container right after mounting; draw once that has run.
  queueMicrotask(() => cards.forEach(c => c._draw?.()));
}

const store = {
  get(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// Small form helpers for the settings panels.
function field(lbl, input, { hint = '', cls = '' } = {}) {
  const f = h('label', { class: `field ${cls}` }, `<span>${lbl}</span>`);
  f.appendChild(input);
  if (hint) f.appendChild(h('small', {}, hint));
  return f;
}
function segmented(options, value, onChange) {
  const g = h('div', { class: 'seg', role: 'group' });
  for (const [v, t] of options) {
    const b = h('button', { type: 'button', class: String(v) === String(value) ? 'on' : '' }, t);
    b.addEventListener('click', () => { [...g.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); onChange(v); });
    g.appendChild(b);
  }
  return g;
}
function checkbox(value, onChange, text) {
  const l = h('label', { class: 'check' });
  const c = h('input', { type: 'checkbox' });
  c.checked = !!value;
  c.addEventListener('change', () => onChange(c.checked));
  l.append(c, document.createTextNode(` ${text}`));
  return l;
}

export async function renderExperiment(root, { registry, expId, readText, source = 'registry' }) {
  const exp = registry.experiments.find(e => e.id === expId);
  const skey = `lcms:${source}:${expId}`;
  const saved = store.get(skey, {});
  const state = {
    params: { dilution: exp.dilution ?? 1, isConcSample: exp.isConcSample ?? null, weighting: '1/x2', origin: false, autoExclude: true, ...saved.params },
    view: { metric: exp.mode === 'relative' ? 'pct' : 'conc', log: false, tab: 'results', ...saved.view },
    fig: { ...FIG_DEFAULTS, ...(exp.figure || {}), ...saved.fig },
    excluded: saved.excluded || [],
  };
  const assumed = new Set(exp.assumed || []);
  const unit = exp.displayTimeUnit || 'h';
  let run, findings = [];

  const persist = () => store.set(skey, { params: state.params, view: state.view, fig: state.fig, excluded: state.excluded });

  async function compute() {
    const calOverrides = {};
    for (const id of exp.calibrations || []) calOverrides[id] = { weighting: state.params.weighting, origin: state.params.origin, autoExclude: state.params.autoExclude };
    run = await runExperiment(registry, expId, readText, {
      dilution: Number(state.params.dilution) || 1,
      isConcSample: state.params.isConcSample === '' || state.params.isConcSample == null ? null : Number(state.params.isConcSample),
      exclude: [...(exp.exclude || []), ...state.excluded],
      calOverrides,
    });
    findings = audit(run);
  }

  root.innerHTML = '';
  const hero = h('section', { class: 'report-hero' });
  const settings = h('section', { class: 'settings' });
  const statsEl = h('div', { class: 'stats' });
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'tab-body' });
  root.append(hero, settings, statsEl, tabsEl, body);

  function renderHero() {
    const conds = [...new Set(run.result.series.map(s => s.condition).filter(Boolean))];
    const nErr = findings.filter(f => f.severity === 'error').length, nWarn = findings.filter(f => f.severity === 'warn').length;
    hero.innerHTML = `
      <div class="crumbs"><a href="experiments.html">Experiments</a> <span>/</span> ${esc(exp.id)}</div>
      <h1>${esc(exp.title)}</h1>
      <div class="chips">
        <span class="chip">${exp.design === 'timecourse' ? 'Time course' : 'End-point'}</span>
        <span class="chip mono">${esc(exp.file.split('/').pop())}</span>
        ${conds.length ? `<span class="chip">${conds.map(esc).join(' · ')}</span>` : ''}
        <span class="chip">${exp.mode === 'relative' ? 'relative (% of t₀)' : `${state.params.dilution}× dilution`}</span>
      </div>
      <button class="check-summary ${nErr ? 'bad' : nWarn ? 'warn' : 'good'}" type="button">
        <span class="dot"></span>${nErr || nWarn ? `<b>${nErr}</b> error${nErr === 1 ? '' : 's'} · <b>${nWarn}</b> to check` : 'No problems found'}
        <span class="go">Review checks →</span></button>
      ${exp.note ? `<div class="callout info">${esc(exp.note)}</div>` : ''}
      ${(exp.rules || []).filter(r => r.why).map(r => `<div class="callout info">${esc(r.why)}</div>`).join('')}
      ${assumed.size ? `<div class="callout">Parameters marked <span class="badge warn">to confirm</span> below were carried over from the old analysis. Results scale with them.</div>` : ''}`;
    hero.querySelector('.check-summary').addEventListener('click', () => { state.view.tab = 'checks'; persist(); renderTabs(); tabsEl.scrollIntoView({ behavior: 'smooth' }); });
  }

  function renderSettings() {
    settings.innerHTML = '';
    // Calculation
    const calc = h('details', { class: 'panel' }, '<summary><span class="icon">⚙</span> Calculation <small>dilution, internal standard, calibration model</small></summary>');
    const cBody = h('div', { class: 'panel-body' });
    const num = (key, placeholder = '') => {
      const i = h('input', { type: 'number', step: 'any', min: '0', placeholder });
      i.value = state.params[key] ?? '';
      i.addEventListener('change', () => { state.params[key] = i.value === '' ? null : Number(i.value); refresh(); });
      return i;
    };
    const sel = (key, opts) => {
      const s = h('select');
      for (const [v, t] of opts) { const o = h('option', { value: v }, t); if (String(state.params[key]) === v) o.selected = true; s.appendChild(o); }
      s.addEventListener('change', () => { state.params[key] = s.value === 'true' ? true : s.value === 'false' ? false : s.value; refresh(); });
      return s;
    };
    const conf = k => assumed.has(k) ? ' <span class="badge warn">to confirm</span>' : '';
    cBody.append(
      field(`Dilution factor${conf('dilution')}`, num('dilution'), { hint: 'Reaction → vial', cls: assumed.has('dilution') ? 'assumed' : '' }),
      field(`IS in samples (µM)${conf('isConc')}`, num('isConcSample', '= standards'), { hint: 'Leave empty if same as standards' }),
      field('Weighting', sel('weighting', [['1/x2', '1/x²'], ['1/x', '1/x'], ['none', 'none']]), { hint: '1/x² suits 50-fold ranges' }),
      field('Intercept', sel('origin', [['false', 'fitted'], ['true', 'through 0']])),
      field('Failing standards', sel('autoExclude', [['true', 'auto-exclude'], ['false', 'keep all']]), { hint: '±15 % (±20 % LLOQ)' }),
    );
    const actions = h('div', { class: 'panel-actions' });
    actions.append(
      h('button', { class: 'btn', type: 'button', onclick: () => { store.set(skey, {}); renderExperiment(root, { registry, expId, readText, source }); } }, 'Reset everything'),
      h('button', { class: 'btn', type: 'button', title: 'Registry entry with your current settings and exclusions', onclick: () => {
        const out = { ...exp, dilution: state.params.dilution, isConcSample: state.params.isConcSample, exclude: [...(exp.exclude || []), ...state.excluded], figure: state.fig };
        download(`${expId}.config.json`, JSON.stringify(out, null, 2), 'application/json');
      } }, 'Export config'),
    );
    cBody.appendChild(actions);
    calc.appendChild(cBody);

    // Figure style
    const fig = h('details', { class: 'panel' }, '<summary><span class="icon">◐</span> Figure style <small>colours, metric, error bars, labels</small></summary>');
    const fBody = h('div', { class: 'panel-body' });
    const setFig = (k, v) => { state.fig[k] = v; persist(); renderTabs(); };
    const setView = (k, v) => { state.view[k] = v; persist(); renderTabs(); };
    const labelIn = h('input', { type: 'text', placeholder: 'e.g. A: <i>E. coli</i> BL21(DE3) pET::qxyA', style: 'min-width:280px' });
    labelIn.value = state.fig.label;
    labelIn.addEventListener('change', () => setFig('label', labelIn.value));
    fBody.append(field('Colours', segmented([['prism', 'Prism'], ['screen', 'Bright'], ['mono', 'Greyscale']], state.fig.palette, v => setFig('palette', v))));
    if (exp.design !== 'timecourse') {
      const metrics = exp.mode === 'relative' ? [['pct', '% remaining'], ['deg', '% degraded']] : [['conc', 'µM'], ['pct', '% remaining'], ['deg', '% degraded']];
      fBody.append(field('Bars show', segmented(metrics, state.view.metric, v => setView('metric', v))));
      const nd = h('select');
      for (const [v, t] of [['', 'off'], ['25', '≥ 25 % left'], ['50', '≥ 50 % left'], ['75', '≥ 75 % left']]) { const o = h('option', { value: v }, t); if (String(state.fig.notDeg ?? '') === v) o.selected = true; nd.appendChild(o); }
      nd.addEventListener('change', () => setFig('notDeg', nd.value === '' ? null : Number(nd.value)));
      fBody.append(field('“Not degraded” group', nd, { hint: 'Moved right, shaded' }));
    } else {
      fBody.append(
        field('Y axis', segmented([['deg', '% degraded'], ['pct', '% remaining'], ['conc', 'µM']], state.fig.kinY, v => setFig('kinY', v))),
        field('Time axis', segmented([['hmm', 'h:mm'], ['min', 'min'], ['h', 'h']], state.fig.timeFmt, v => setFig('timeFmt', v))),
      );
      const xm = h('input', { type: 'number', min: '1', step: '10', placeholder: 'all' });
      xm.value = state.fig.xMax ?? '';
      xm.addEventListener('change', () => setFig('xMax', xm.value === '' ? null : Number(xm.value)));
      fBody.append(field('Show up to (min)', xm));
      fBody.append(field('Panels', h('div', { class: 'checks' }, '')));
      const cks = fBody.lastChild.querySelector('.checks');
      cks.append(checkbox(state.fig.split, v => setFig('split', v), 'benzyl / non-benzyl'), checkbox(state.fig.fit, v => setFig('fit', v), 'first-order fit'));
    }
    fBody.append(
      field('Error bars', segmented([['sd', 'SD'], ['sem', 'SEM'], ['none', 'none']], state.fig.err, v => setFig('err', v))),
      field('Y scale', segmented([[false, 'linear'], [true, 'log']], state.view.log, v => setView('log', v === true || v === 'true'))),
      field('Points', h('div', { class: 'checks' })),
      field('Panel label (HTML allowed)', labelIn, { cls: 'wide' }),
    );
    fBody.querySelectorAll('.checks')[fBody.querySelectorAll('.checks').length - 1].append(checkbox(state.fig.dots, v => setFig('dots', v), 'replicate dots'));
    fig.appendChild(fBody);
    settings.append(calc, fig);
  }

  async function refresh() { persist(); await compute(); renderHero(); renderStats(); renderTabs(); }

  function renderStats() {
    const r = run.result;
    const subs = r.records.filter(x => x.role === 'substrate');
    const nSamples = new Set(r.records.map(x => x.name)).size;
    const tiles = [
      [nSamples, 'samples'],
      [r.injections.length, 'injections'],
      [run.calibrations.reduce((n, c) => n + Object.values(c.curves).filter(v => v.status === 'ok').length, 0), 'calibration curves'],
      [subs.filter(x => x.flags.length).length, 'flagged results'],
      [r.records.filter(x => x.excluded).length, 'excluded'],
    ];
    statsEl.innerHTML = tiles.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  }

  function renderTabs() {
    const nIssues = findings.filter(f => f.severity !== 'info').length;
    const TABS = [['results', 'Results'], ['checks', `Checks${nIssues ? ` <span class="count">${nIssues}</span>` : ''}`], ['calibration', 'Calibration'], ['data', 'Data']];
    tabsEl.innerHTML = '';
    for (const [id, t] of TABS) {
      const b = h('button', { type: 'button', role: 'tab', class: state.view.tab === id ? 'on' : '' }, t);
      b.addEventListener('click', () => { state.view.tab = id; persist(); renderTabs(); });
      tabsEl.appendChild(b);
    }
    body.innerHTML = '';
    ({ results: renderResults, checks: renderChecks, calibration: renderCalibration, data: renderData }[state.view.tab] || renderResults)(body);
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
    if (exp.design === 'timecourse') return renderTimecourse(el);
    const fs = state.fig;
    const conds = conditionsOf(r);
    const substrates = order(r.series.filter(s => s.role === 'substrate'), s => s.group, exp.groupOrder);
    const groups = [...new Set(substrates.map(s => s.group))];
    const t0 = Math.min(...r.times), tEnd = Math.max(...r.times);

    el.appendChild(h('h2', {}, 'Substrates'));
    const grid = h('div', { class: `grid ${conds.length > 1 ? 'cols-2' : ''}` });
    mount(grid, conds.map(c => {
      const ss = substrates.filter(s => s.condition === c);
      const rel = ss.every(s => s.mode === 'relative');
      const m = rel && state.view.metric === 'conc' ? 'pct' : state.view.metric;
      const fig = endpointFigure(ss, { metric: m, unit, log: state.view.log, c0: exp.c0, fs });
      const sub = rel ? 'Relative quantification — no matching internal standard for µM.' : m === 'conc' ? `Calibrated concentration in the reaction. Hollow dots: flagged replicates.` : m === 'deg' ? 'Per replicate, relative to the mean t₀ of the same substrate.' : 'Relative to the mean t₀ of each substrate.';
      return chartCard(esc(c || exp.title), sub, fig, { file: `${expId}_${c || 'all'}`, widthMm: conds.length > 1 ? 120 : 183, heightMm: 80 });
    }));
    el.appendChild(grid);

    if (groups.length > 1 && conds.length > 1) {
      el.appendChild(h('h2', {}, `Remaining after ${timeLabel(tEnd, unit)}`));
      const heat = heatmapFigure(conds.map(c => c || 'All'), groups, (c, g) => {
        const s = substrates.find(x => (x.condition || 'All') === c && x.group === g);
        const p = s?.points.find(q => q.time === tEnd);
        return p && Number.isFinite(p.pctMean) ? p.pctMean : null;
      });
      const g = h('div', { class: 'grid' });
      mount(g, [chartCard('% of t₀ remaining', 'Each cell: mean of replicates relative to the mean t₀ of the same condition and substrate.', heat, { file: `${expId}_heatmap`, widthMm: 183, heightMm: 30 + 12 * conds.length })]);
      el.appendChild(g);
    }

    const products = order(r.series.filter(s => s.role === 'product'), s => s.group, exp.groupOrder);
    if (products.length) {
      el.appendChild(h('h2', {}, 'Transformation products'));
      el.appendChild(h('p', { class: 'muted small' }, 'BDMA from benzyl-QACs and DDMA from C<sub>10-10</sub>DMA<sup>+</sup>, in µM.'));
      const g2 = h('div', { class: 'grid cols-2' });
      mount(g2, conds.filter(c => products.some(p => p.condition === c)).map(c => {
        const ps = products.filter(p => p.condition === c);
        const fig = endpointFigure(ps, { metric: 'conc', unit, log: state.view.log, fs: { ...fs, notDeg: null, label: '' } });
        fig.layout.xaxis.ticktext = ps.map(p => `${label(p.analyte)}<br><span style="font-size:10px">from ${label(p.group)}</span>`);
        return chartCard(`${esc(c || 'All')} · products`, '', fig, { file: `${expId}_${c || 'all'}_products` });
      }));
      el.appendChild(g2);
    }

    el.appendChild(h('h2', {}, 'Summary'));
    const rows = substrates.map(s => {
      const a = s.points.find(p => p.time === t0), b = s.points.find(p => p.time === tEnd);
      const u = s.records.find(x => x.unit)?.unit || '';
      const pct = b?.pctMean;
      const bar = Number.isFinite(pct) ? `<span class="minibar"><i style="width:${Math.min(100, Math.max(0, pct)).toFixed(0)}%"></i></span> ${fmt(pct, 3)} %` : '—';
      return [esc(s.condition), label(s.group), u, pm(a?.mean, a?.sd), pm(b?.mean, b?.sd), bar, pFmt(s.test?.p), `${a?.n ?? 0} / ${b?.n ?? 0}`,
        products.filter(p => p.condition === s.condition && p.group === s.group).map(p => { const q = p.points.find(x => x.time === tEnd); return `${label(p.analyte)} ${pm(q?.mean, q?.sd)}`; }).join('')];
    });
    el.appendChild(table(['Condition', 'Substrate', 'Unit', `t = ${timeLabel(t0, unit)}`, `t = ${timeLabel(tEnd, unit)}`, '% remaining', 'p (Welch)', 'n', 'Product (µM)'], rows, [3, 4, 6, 7]));
    el.appendChild(h('div', { class: 'row-actions' })).appendChild(h('button', { class: 'btn', onclick: () => download(`${expId}_summary.csv`, csv([
      ['condition', 'substrate', 'unit', 't0_mean', 't0_sd', 'tend_mean', 'tend_sd', 'pct_remaining', 'pct_sd', 'p_welch', 'n_t0', 'n_tend'],
      ...substrates.map(s => { const a = s.points.find(p => p.time === t0), b = s.points.find(p => p.time === tEnd); return [s.condition, s.group, s.records.find(x => x.unit)?.unit, a?.mean, a?.sd, b?.mean, b?.sd, b?.pctMean, b?.pctSd, s.test?.p, a?.n, b?.n]; }),
    ])) }, '↓ Summary CSV'));
  }

  function renderTimecourse(el) {
    const r = run.result;
    const fs = state.fig;
    for (const c of conditionsOf(r)) {
      const subs = order(r.series.filter(s => s.role === 'substrate' && s.condition === c), s => s.group, exp.groupOrder);
      if (c) el.appendChild(h('h2', {}, esc(c)));
      const panels = fs.split
        ? [['Benzyl QACs', subs.filter(s => chem(s.group).cls === 'BAC')], ['Non-benzyl QACs', subs.filter(s => chem(s.group).cls !== 'BAC')]].filter(([, l]) => l.length)
        : [['', subs]];
      const top = h('div', { class: `grid ${panels.length > 1 ? 'cols-2' : ''}` });
      mount(top, panels.map(([t, list], i) => chartCard(t || 'Substrate depletion', i === 0 && fs.fit ? 'Markers: mean ± error bar · lines: first-order fit.' : '',
        overlayFigure(list, { unit, log: state.view.log, fs: { ...fs, label: i === 0 ? fs.label : '' }, title: '' }),
        { file: `${expId}_${t ? t.split(' ')[0].toLowerCase() : 'overlay'}`, widthMm: panels.length > 1 ? 89 : 183, heightMm: 75 })));
      el.appendChild(top);

      el.appendChild(h('h2', {}, 'Rates'));
      const kf = unit === 'min' ? 1 / 60 : 1, ku = unit === 'min' ? 'min⁻¹' : 'h⁻¹';
      const g = h('div', { class: 'grid cols-2' });
      mount(g, [chartCard('Rate vs chain length', 'First-order k with 95 % CI (ln C fit over replicates above LLOQ).', rateFigure(subs, { perMin: unit === 'min' }), { file: `${expId}_rates` })]);
      const tbl = table(['Substrate', `k (${ku})`, '95 % CI', `t½`, 'R²', 'n'],
        order(subs, s => -(s.kinetics?.k ?? -1)).map(s => { const k = s.kinetics; return k ? [label(s.group), fmt(k.k * kf), `${fmt(k.kLow * kf)} – ${fmt(k.kHigh * kf)}`, k.halfLife < 1e6 ? (fs.timeFmt === 'hmm' ? hmm(k.halfLife * 60) : `${fmt(unit === 'min' ? k.halfLife * 60 : k.halfLife)} ${unit}`) : '—', k.r2.toFixed(3), k.n] : [label(s.group), '—', '—', '—', '—', '—']; }), [1, 2, 3, 4, 5]);
      g.appendChild(h('div', { class: 'card flush' })).appendChild(tbl);
      el.appendChild(g);
      el.appendChild(h('div', { class: 'row-actions' })).appendChild(h('button', { class: 'btn', onclick: () => download(`${expId}_kinetics.csv`, csv([
        ['condition', 'substrate', 'k_per_h', 'k_low', 'k_high', 'half_life_h', 'r2', 'n', 'c0_fit'],
        ...subs.map(s => { const k = s.kinetics || {}; return [s.condition, s.group, k.k, k.kLow, k.kHigh, k.halfLife, k.r2, k.n, k.c0]; }),
      ])) }, '↓ Kinetics CSV'));

      const det = h('details', { class: 'section' }, `<summary>Each substrate separately (${subs.length})</summary>`);
      const grid = h('div', { class: 'grid cols-3', style: 'margin-top:10px' });
      det.appendChild(grid);
      el.appendChild(det);
      const cards = subs.map((s, i) => {
        const k = s.kinetics;
        const sub = k ? `t½ ${fmt(unit === 'min' ? k.halfLife * 60 : k.halfLife)} ${unit} · R² ${k.r2.toFixed(3)}` : 'No rate fit (too few points above LLOQ).';
        return chartCard(label(s.group), sub, timecourseFigure(s, { unit, metric: fs.kinY === 'conc' ? 'conc' : 'pct', log: state.view.log, color: kinColor(i, fs) }), { file: `${expId}_${s.group}` });
      });
      det.addEventListener('toggle', () => { if (det.open && !grid.childElementCount) mount(grid, cards); });

      const prods = r.series.filter(s => s.role === 'product' && s.condition === c);
      if (prods.length) {
        el.appendChild(h('h2', {}, 'Transformation products'));
        const pg = h('div', { class: 'grid cols-3' });
        mount(pg, prods.map(p => chartCard(`${label(p.analyte)} from ${label(p.group)}`, 'µM formed over time.', timecourseFigure(p, { unit, metric: 'conc', color: kinColor(4, fs) }), { file: `${expId}_${p.analyte}_${p.group}` })));
        el.appendChild(pg);
      }
    }
  }

  // ── Checks ──────────────────────────────────────────────────────────────
  function renderChecks(el) {
    const r = run.result;
    el.appendChild(h('p', { class: 'muted' }, 'Automatic checks on labels, injections, replicates, units, carry-over and calibration. Nothing is changed automatically — exclude a sample here if you agree.'));
    if (!findings.length) el.appendChild(h('div', { class: 'callout info' }, 'No problems found.'));
    const list = h('div', { class: 'findings' });
    for (const f of findings) {
      const [cls, sevText, icon] = SEV[f.severity];
      const item = h('div', { class: `finding ${cls}` });
      item.innerHTML = `<span class="sev">${icon}</span><div class="ftext"><div class="fkind">${esc(KIND_LABEL[f.kind] || f.kind)} · ${sevText}</div><div>${esc(f.message)}</div></div>`;
      const canExclude = ['outlier', 'label', 'injection'].includes(f.kind) && f.samples.length === 1;
      if (canExclude) {
        const name = f.samples[0];
        const isEx = state.excluded.some(e => e.name === name);
        item.appendChild(h('button', { class: 'btn small', type: 'button', onclick: () => {
          if (isEx) state.excluded = state.excluded.filter(e => e.name !== name);
          else state.excluded.push({ name, reason: `${KIND_LABEL[f.kind] || f.kind} (checks)` });
          refresh();
        } }, isEx ? 'Include again' : 'Exclude'));
      }
      list.appendChild(item);
    }
    el.appendChild(list);

    const counts = {};
    r.records.forEach(x => x.flags.forEach(fl => counts[fl] = (counts[fl] || 0) + 1));
    if (Object.keys(counts).length) {
      el.appendChild(h('h2', {}, 'Result flags'));
      el.appendChild(table(['Flag', 'Results', 'Meaning'], Object.entries(counts).map(([fl, n]) => [flagBadge(fl), n, esc(FLAG_INFO[fl]?.[1] || '')]), [1]));
    }
    if (r.runIS.length) {
      el.appendChild(h('h2', {}, 'Internal standard across the run'));
      const grid = h('div', { class: 'grid cols-2' });
      mount(grid, r.runIS.map(x => chartCard(`${label(x.id)} peak area`, `${x.rows.length} injections use it as IS, plus blanks. Band: 50–150 % of their median.`, isTraceFigure(r.injections.filter(j => j.blank || x.rows.includes(j.row)), x.id, x.median), { file: `${expId}_IS_${x.id}`, widthMm: 120 })));
      el.appendChild(grid);
    }
    const analytes = [...new Set(r.records.filter(x => x.role === 'substrate').map(x => x.analyte))];
    if (r.blanks.length && analytes.length) {
      const det = h('details', { class: 'section' }, `<summary>Solvent blanks (${r.blanks.length}) — substrate peak areas</summary>`);
      det.appendChild(table(['#', 'Blank', ...analytes.map(label)], r.blanks.map(b => [b.row + 1, esc(b.name), ...analytes.map(a => fmt(b.areas[`${a}|1`]))]), analytes.map((_, i) => i + 2)));
      el.appendChild(det);
    }
    if (r.notes.length) el.appendChild(h('div', { class: 'callout info' }, `<b>File notes</b><ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`));
  }

  // ── Calibration ─────────────────────────────────────────────────────────
  function renderCalibration(el) {
    const used = new Set(run.result.records.map(r => `${r.calId}|${r.analyte}`));
    if (!run.calibrations.length) { el.appendChild(h('p', { class: 'muted' }, 'This experiment uses relative quantification only; no calibration curves are applied.')); return; }
    for (const cal of run.calibrations) el.appendChild(calibrationSection(cal, a => used.has(`${cal.id}|${a}`)));
  }

  // ── Data ────────────────────────────────────────────────────────────────
  function renderData(el) {
    const r = run.result;
    const top = h('div', { class: 'row-actions' });
    const search = h('input', { type: 'search', placeholder: 'Filter samples…', class: 'search' });
    const onlyFlagged = checkbox(false, () => apply(), 'only flagged');
    top.append(search, onlyFlagged, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => download(`${expId}_results.csv`, csv([
      ['row', 'sample', 'condition', 'substrate', 'analyte', 'role', 'time_h', 'rep', 'area', 'is', 'is_area', 'y', 'vial_uM', 'dilution', 'value', 'unit', 'pct_of_t0', 'flags', 'excluded', 'reason', 'calibration'],
      ...r.records.map(x => [x.row + 1, x.name, x.condition, x.group, x.analyte, x.role, x.time, x.rep, x.area, x.is, x.isArea, x.y, x.vial, x.dilution, x.value, x.unit, x.percent, x.flags.join('; '), x.excluded, x.reason, x.calId]),
    ])) }, '↓ All results CSV'));
    el.appendChild(top);
    el.appendChild(h('p', { class: 'muted small' }, 'Untick a row to leave that injection out of means, % remaining and fits. Choices are kept in this browser; “Export config” makes them permanent.'));
    const wrap = h('div', { class: 'table-wrap table-scroll' });
    const tbl = h('table');
    tbl.innerHTML = `<thead><tr><th>Use</th><th>#</th><th>Sample</th><th>Condition</th><th>Analyte</th><th class="num">Time</th><th class="num">Rep</th><th class="num">Area</th><th class="num">IS area</th><th class="num">Value</th><th>Unit</th><th class="num">% t₀</th><th>Flags</th></tr></thead>`;
    const tb = h('tbody');
    const rows = r.records.map(x => {
      const tr = h('tr', { class: x.excluded ? 'excluded' : '' });
      const userEx = state.excluded.some(e => e.name === x.name && (!e.analyte || e.analyte === x.analyte));
      const cfgEx = x.excluded && !userEx;
      tr.innerHTML = `<td class="keep"><input type="checkbox" ${x.excluded ? '' : 'checked'} ${cfgEx ? `disabled title="${esc(x.reason)}"` : ''}></td>
        <td>${x.row + 1}</td><td class="mono">${esc(x.name)}</td><td>${esc(x.condition)}</td><td>${label(x.analyte)}</td>
        <td class="num">${timeLabel(x.time, unit)}</td><td class="num">${x.rep}</td><td class="num">${fmt(x.area)}</td><td class="num">${fmt(x.isArea)}</td>
        <td class="num">${fmt(x.value)}</td><td>${esc(x.unit || '')}</td><td class="num">${fmt(x.percent)}</td>
        <td class="keep">${x.flags.map(flagBadge).join(' ')}${x.excluded ? ` <span class="badge">${esc(x.reason)}</span>` : ''}</td>`;
      tr.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) state.excluded = state.excluded.filter(q => !(q.name === x.name && (!q.analyte || q.analyte === x.analyte)));
        else state.excluded.push({ name: x.name, analyte: x.analyte, reason: 'excluded in viewer' });
        refresh();
      });
      tb.appendChild(tr);
      return [tr, x];
    });
    function apply() {
      const q = search.value.trim().toLowerCase(), fl = onlyFlagged.querySelector('input').checked;
      for (const [tr, x] of rows) tr.hidden = (q && !x.name.toLowerCase().includes(q)) || (fl && !x.flags.length && !x.excluded);
    }
    search.addEventListener('input', apply);
    tbl.appendChild(tb); wrap.appendChild(tbl); el.appendChild(wrap);
  }

  await compute();
  renderHero();
  renderSettings();
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

export function calibrationSection(cal, isUsed = null, { open = true } = {}) {
  const badges = !!isUsed;
  isUsed = isUsed || (() => true);
  const sec = h('section', { class: 'cal-section' });
  const cfg = cal.config;
  sec.appendChild(h('h2', {}, `${esc(cal.label)}`));
  sec.appendChild(h('p', { class: 'muted small' }, `<span class="mono">${esc(cal.fileName)}</span> · ${cfg.is ? `IS ${label(cfg.is)} ${cfg.isConc} µM (median area ${fmt(cal.isAreaMedian)}, CV ${fmt(cal.isAreaCV, 2)} %)` : 'external calibration (no IS)'} · weighting ${cfg.weighting}${cfg.origin ? ', through origin' : ''} · acceptance ±${cfg.accTol} % (±${cfg.lloqTol} % at LLOQ)`));
  if (cal.warnings.length) sec.appendChild(h('div', { class: 'callout' }, `<ul>${cal.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`));
  const curves = Object.values(cal.curves).sort((a, b) => (a.status !== 'ok') - (b.status !== 'ok'));
  const okCurves = curves.filter(c => c.status === 'ok'), absent = curves.filter(c => c.status !== 'ok');
  sec.appendChild(table(
    ['Analyte', 'Status', 'Slope', 'Intercept', 'R²', 'Range (µM)', 'Levels', 'LOD (µM)', 'LOQ (µM)', 'Mean |bias| %', 'Ion ratio (CV)', 'Excluded standards'],
    okCurves.map(c => [
      label(c.chem) + (badges && isUsed(c.chem) ? ' <span class="badge accent">used</span>' : ''), statusBadge(c), fmt(c.fit.slope, 4), fmt(c.fit.intercept, 3), c.fit.r2.toFixed(4),
      `${c.lloq} – ${c.uloq}`, c.levels, fmt(c.lod, 2), fmt(c.loq, 2), fmt(c.meanAbsError, 2),
      c.ionRatio ? `${c.ionRatio.mean.toFixed(2)} (${c.ionRatio.cv.toFixed(0)} %)` : '—',
      c.points.filter(p => p.excluded).map(p => `${p.x} µM <span class="muted">(${esc(p.reason)})</span>`).join(', ') || '—',
    ]), [2, 3, 4, 6, 7, 8, 9]));
  if (absent.length) sec.appendChild(h('p', { class: 'muted small' }, `Not in these standards (no concentration response): ${absent.map(c => label(c.chem)).join(', ')}.`));
  const ok = okCurves.filter(c => isUsed(c.chem));
  if (ok.length) {
    const det = h('details', { class: 'section' }, `<summary>Curves and back-calculated accuracy (${ok.length})</summary>`);
    if (open) det.setAttribute('open', '');
    const grid = h('div', { class: 'grid cols-2', style: 'margin-top:10px' });
    det.appendChild(grid);
    const cards = ok.flatMap(c => [
      chartCard(`${label(c.chem)} · response`, `y = ${fmt(c.fit.slope, 4)}·x ${c.fit.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(c.fit.intercept), 3)} · R² ${c.fit.r2.toFixed(4)}`, calibrationFigure(c, { isLabel: cfg.is ? plainLabel(cfg.is) : null }), { file: `cal_${cal.id}_${c.chem}` }),
      chartCard(`${label(c.chem)} · accuracy`, `Band ±${cfg.accTol} %. Hollow red = excluded.`, accuracyFigure(c, cfg), { file: `cal_${cal.id}_${c.chem}_accuracy` }),
    ]);
    sec.appendChild(det);
    let drawn = false;
    const go = () => { if (!drawn && det.open) { drawn = true; mount(grid, cards); } };
    det.addEventListener('toggle', go);
    queueMicrotask(go);
  }
  return sec;
}
