// Plotly figure builders. Every builder returns { data, layout } so the same
// figure can be drawn on screen (themed) or re-rendered for publication export.
/* global Plotly */
import { label, chem } from '../engine/chemicals.js';

export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const seriesColor = i => css(`--series-${(i % 8) + 1}`);

export function timeLabel(hours, unit) {
  if (unit === 'min') return `${+(hours * 60).toFixed(1)} min`;
  if (unit === 'd') return `${+(hours / 24).toFixed(2)} d`;
  return `${+hours.toFixed(2)} h`;
}
export const toUnit = (hours, unit) => unit === 'min' ? hours * 60 : unit === 'd' ? hours / 24 : hours;

const fmt = (v, d = 3) => Number.isFinite(v) ? (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0) ? v.toExponential(2) : +v.toPrecision(d)) : '—';

function axis(extra = {}) {
  return {
    gridcolor: css('--grid'), linecolor: css('--text-muted'), zeroline: false, ticks: 'outside',
    tickcolor: css('--text-muted'), ticklen: 4, automargin: true, showline: true,
    title: { font: { size: 12, color: css('--text-secondary') } }, ...extra,
  };
}

export function baseLayout(extra = {}) {
  return {
    paper_bgcolor: css('--surface-1'), plot_bgcolor: css('--surface-1'),
    font: { family: css('--font'), size: 12, color: css('--text-secondary') },
    margin: { l: 56, r: 16, t: 12, b: 48 },
    hoverlabel: { bgcolor: css('--surface-1'), bordercolor: css('--border'), font: { color: css('--text-primary'), size: 12 } },
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 12, color: css('--text-primary') } },
    showlegend: true,
    ...extra,
    xaxis: axis(extra.xaxis), yaxis: axis(extra.yaxis),
  };
}

const CONFIG = { displaylogo: false, responsive: true, displayModeBar: false };

export function draw(el, fig) {
  el._fig = fig;
  return Plotly.react(el, fig.data, fig.layout, CONFIG);
}

// Re-render with a print style (white, black ink, Arial) at a journal column
// width, then download. widthMm 89 = single column, 183 = double column.
export async function exportFigure(el, { format = 'svg', widthMm = 89, heightMm, filename = 'figure' } = {}) {
  const fig = el._fig;
  if (!fig) return;
  const px = mm => Math.round(mm / 25.4 * 96);
  const w = px(widthMm), h = px(heightMm || widthMm * 0.72);
  const ink = '#000000';
  const restyleAxis = a => a && ({ ...a, gridcolor: '#ffffff', showgrid: false, linecolor: ink, tickcolor: ink, linewidth: 0.75, tickfont: { family: 'Arial', size: 9, color: ink }, title: { ...(a.title || {}), font: { family: 'Arial', size: 10, color: ink } } });
  const layout = JSON.parse(JSON.stringify(fig.layout));
  Object.assign(layout, {
    paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff', width: w, height: h,
    font: { family: 'Arial', size: 9, color: ink },
    legend: { ...(layout.legend || {}), font: { family: 'Arial', size: 9, color: ink } },
  });
  for (const k of Object.keys(layout)) if (/^[xy]axis\d*$/.test(k)) layout[k] = restyleAxis(layout[k]);
  if (layout.annotations) layout.annotations = layout.annotations.map(a => ({ ...a, font: { ...(a.font || {}), family: 'Arial', color: ink } }));
  const tmp = document.createElement('div');
  tmp.style.cssText = 'position:fixed;left:-10000px;top:0;';
  document.body.appendChild(tmp);
  try {
    await Plotly.newPlot(tmp, fig.data, layout, { staticPlot: true });
    await Plotly.downloadImage(tmp, { format, width: w, height: h, scale: format === 'png' ? 600 / 96 : 1, filename });
  } finally {
    Plotly.purge(tmp); tmp.remove();
  }
}

// ── Calibration ───────────────────────────────────────────────────────────
export function calibrationFigure(curve, { log = true, isLabel = 'IS' } = {}) {
  const inc = curve.points.filter(p => !p.excluded && Number.isFinite(p.y));
  const exc = curve.points.filter(p => p.excluded && Number.isFinite(p.y));
  const data = [];
  if (curve.fit) {
    const xs = curve.points.map(p => p.x);
    const lo = Math.min(...xs), hi = Math.max(...xs), n = 60;
    const lx = Array.from({ length: n }, (_, i) => log ? lo * (hi / lo) ** (i / (n - 1)) : lo + (hi - lo) * i / (n - 1));
    data.push({ x: lx, y: lx.map(x => curve.fit.slope * x + curve.fit.intercept), mode: 'lines', name: 'Fit', line: { color: css('--text-muted'), width: 1.5 }, hoverinfo: 'skip' });
  }
  const hover = p => `<b>${p.name}</b><br>${p.x} µM · y = ${fmt(p.y)}<br>back-calc ${fmt(p.backCalc)} µM (${Number.isFinite(p.accuracy) ? p.accuracy.toFixed(0) : '—'} %)${p.reason ? `<br><i>${p.reason}</i>` : ''}<extra></extra>`;
  data.push({ x: inc.map(p => p.x), y: inc.map(p => p.y), mode: 'markers', name: 'Used', marker: { color: seriesColor(0), size: 8, line: { color: css('--surface-1'), width: 1.5 } }, hovertemplate: inc.map(hover) });
  if (exc.length) data.push({ x: exc.map(p => p.x), y: exc.map(p => p.y), mode: 'markers', name: 'Excluded', marker: { color: 'rgba(0,0,0,0)', size: 8, line: { color: css('--bad'), width: 1.5 }, symbol: 'circle' }, hovertemplate: exc.map(hover) });
  return {
    data,
    layout: baseLayout({
      height: 260, showlegend: false,
      xaxis: { type: log ? 'log' : 'linear', title: { text: 'Concentration (µM)' }, tickvals: [...new Set(curve.points.map(p => p.x))] },
      yaxis: { type: log ? 'log' : 'linear', title: { text: isLabel ? `Area ratio (analyte / ${isLabel})` : 'Peak area' }, exponentformat: 'power', dtick: log ? 1 : undefined },
    }),
  };
}

export function accuracyFigure(curve, cfg) {
  const pts = curve.points.filter(p => Number.isFinite(p.accuracy));
  const xs = pts.map(p => p.x);
  const lo = Math.min(...xs) / 1.4, hi = Math.max(...xs) * 1.4;
  const ok = p => Math.abs(p.accuracy - 100) <= p.tol;
  const data = [{
    x: pts.map(p => p.x), y: pts.map(p => p.accuracy), mode: 'markers', showlegend: false,
    marker: {
      size: 8, color: pts.map(p => p.excluded ? 'rgba(0,0,0,0)' : ok(p) ? seriesColor(0) : css('--bad')),
      line: { width: 1.5, color: pts.map(p => p.excluded ? css('--bad') : css('--surface-1')) },
    },
    hovertemplate: pts.map(p => `<b>${p.name}</b><br>${p.x} µM → ${p.accuracy.toFixed(1)} %${p.reason ? `<br><i>${p.reason}</i>` : ''}<extra></extra>`),
  }];
  const band = (y0, y1, op) => ({ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0, y1, fillcolor: css('--good'), opacity: op, line: { width: 0 }, layer: 'below' });
  return {
    data,
    layout: baseLayout({
      height: 260,
      xaxis: { type: 'log', title: { text: 'Concentration (µM)' }, range: [Math.log10(lo), Math.log10(hi)], tickvals: [...new Set(xs)] },
      yaxis: { title: { text: 'Back-calculated (% nominal)' } },
      shapes: [band(100 - cfg.accTol, 100 + cfg.accTol, 0.10),
        { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 100, y1: 100, line: { color: css('--text-muted'), width: 1, dash: 'dot' } }],
    }),
  };
}

// ── Figure style ──────────────────────────────────────────────────────────
// Options the viewer can change; shared by end-point and kinetics figures.
export const FIG_DEFAULTS = {
  palette: 'prism',     // 'prism' (green/blue, as in the thesis figures) | 'screen' | 'mono'
  err: 'sd',            // 'sd' | 'sem' | 'none'
  dots: true,           // replicate dots
  label: '',            // panel label, e.g. "A: <i>E. coli</i> BL21(DE3) pET::qxyA"
  notDeg: 50,           // % remaining at the last time point treated as "not degraded" (null = off)
  kinY: 'deg',          // 'deg' (% degraded) | 'pct' (% remaining) | 'conc'
  split: true,          // kinetics: separate panels for benzyl and non-benzyl QACs
  timeFmt: 'hmm',       // 'min' | 'hmm' | 'h'
  xMax: null,           // kinetics: last time shown (minutes)
  fit: true,            // kinetics: draw first-order fit
};

const TIME_COLORS = {
  prism: ['#6ab46a', '#5b9bd5', '#f4a259', '#9b8ec4'],
  mono: ['#c4c4c4', '#4a4a4a', '#8a8a8a', '#1f1f1f'],
};
const KIN_COLORS = {
  prism: ['#222222', '#2e6fbd', '#43a047', '#8e44ad', '#e53935', '#f39c12', '#8d6e63', '#9e9e9e'],
  mono: ['#000000', '#3a3a3a', '#5c5c5c', '#7a7a7a', '#999999', '#b5b5b5', '#2a2a2a', '#6a6a6a'],
};
export const SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up', 'triangle-down', 'cross', 'x', 'star', 'hexagon', 'pentagon'];
export const timeColor = (j, fs) => TIME_COLORS[fs.palette]?.[j % 4] ?? seriesColor(j);
export const kinColor = (i, fs) => KIN_COLORS[fs.palette]?.[i % 8] ?? seriesColor(i);
const errOf = (sdv, n, fs) => fs.err === 'none' || !Number.isFinite(sdv) ? 0 : fs.err === 'sem' ? sdv / Math.sqrt(n || 1) : sdv;

function panelLabel(fs, extra = []) {
  return fs.label ? [{ xref: 'paper', yref: 'paper', x: 0, y: 1, xanchor: 'left', yanchor: 'bottom', yshift: 26, text: fs.label, showarrow: false, font: { size: 13, color: css('--text-primary') }, align: 'left' }, ...extra] : extra;
}

// ── Endpoint bars with replicate dots ─────────────────────────────────────
// series: substrate (or product) series of one condition, in display order.
// metric: 'conc' | 'pct' (% of t₀) | 'deg' (% degraded at later times).
export function endpointFigure(series, { metric = 'conc', unit = 'h', log = false, c0 = null, title = '', fs = FIG_DEFAULTS } = {}) {
  let times = [...new Set(series.flatMap(s => s.points.map(p => p.time)))].sort((a, b) => a - b);
  const tEnd = times[times.length - 1];
  // "Not degraded" substrates move to the right behind a shaded band.
  let ordered = series, nd = 0;
  if (fs.notDeg != null && series[0]?.role === 'substrate' && times.length > 1) {
    const pctEnd = s => s.points.find(p => p.time === tEnd)?.pctMean;
    const isNd = s => pctEnd(s) >= fs.notDeg;
    ordered = [...series.filter(s => !isNd(s)), ...series.filter(isNd)];
    nd = series.filter(isNd).length;
    if (nd === series.length) { ordered = series; nd = 0; }   // nothing degraded: no band
  }
  if (metric === 'deg') times = times.slice(1);
  const nT = times.length, bw = Math.min(0.36, 0.8 / nT);
  const off = j => (j - (nT - 1) / 2) * (bw + 0.03);
  const valOf = r => metric === 'pct' ? r.percent : metric === 'deg' ? (r.percent == null ? null : 100 - r.percent) : r.value;
  const meanOf = p => metric === 'pct' ? p.pctMean : metric === 'deg' ? 100 - p.pctMean : p.mean;
  const sdOf = p => metric === 'conc' ? p.sd : p.pctSd;
  const unitTxt = metric === 'conc' ? (series[0]?.records.find(r => r.unit)?.unit || '') : '%';
  const data = [];
  let top = 0;
  times.forEach((t, j) => {
    const xs = [], ys = [], err = [], hov = [];
    ordered.forEach((s, i) => {
      const p = s.points.find(q => q.time === t);
      if (!p || !p.n || !Number.isFinite(meanOf(p))) return;
      xs.push(i + off(j)); ys.push(meanOf(p)); err.push(errOf(sdOf(p), p.n, fs));
      top = Math.max(top, meanOf(p) + err[err.length - 1]);
      hov.push(`<b>${label(s.analyte)}</b> · ${timeLabel(t, unit)}<br>${fmt(meanOf(p))} ± ${fmt(sdOf(p), 2)} ${unitTxt} (SD, n = ${p.n})<extra></extra>`);
    });
    const color = metric === 'deg' ? timeColor(1, fs) : timeColor(j, fs);
    data.push({
      type: 'bar', x: xs, y: ys, width: bw, name: metric === 'deg' ? `Degraded at ${timeLabel(t, unit)}` : timeLabel(t, unit),
      marker: { color, line: { width: 0 } }, legendgroup: `t${j}`, hovertemplate: hov,
      error_y: { type: 'data', array: err, visible: fs.err !== 'none', color: css('--text-primary'), thickness: 1, width: 4 },
    });
    if (!fs.dots) return;
    const dx = [], dy = [], dh = [], dfill = [];
    ordered.forEach((s, i) => {
      const recs = s.records.filter(r => r.time === t && Number.isFinite(valOf(r)));
      recs.forEach((r, k) => {
        dx.push(i + off(j) + (recs.length > 1 ? (k / (recs.length - 1) - 0.5) * bw * 0.45 : 0));
        dy.push(valOf(r));
        top = Math.max(top, valOf(r));
        dfill.push(r.excluded ? 'rgba(0,0,0,0)' : r.flags.length ? css('--surface-1') : css('--text-primary'));
        dh.push(`${r.name}<br>${fmt(valOf(r))} ${unitTxt}${r.flags.length ? `<br>⚑ ${r.flags.join(', ')}` : ''}${r.excluded ? `<br>excluded: ${r.reason}` : ''}<extra></extra>`);
      });
    });
    data.push({ type: 'scatter', mode: 'markers', x: dx, y: dy, showlegend: false, legendgroup: `t${j}`, marker: { size: 6, color: dfill, line: { color: css('--text-primary'), width: 1 } }, hovertemplate: dh });
  });
  const shapes = [], annotations = [];
  if (metric === 'conc' && c0) shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: c0, y1: c0, line: { color: css('--text-muted'), width: 1, dash: 'dash' } });
  if (metric === 'pct') shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 100, y1: 100, line: { color: css('--text-muted'), width: 1, dash: 'dot' } });
  if (nd) {
    const x0 = ordered.length - nd - 0.5;
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0, x1: ordered.length - 0.4, y0: 0, y1: 1, fillcolor: css('--bad'), opacity: 0.06, line: { width: 0 }, layer: 'below' });
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0, x1: x0, y0: 0, y1: 1, line: { color: css('--text-muted'), width: 1, dash: 'dash' } });
    annotations.push({ xref: 'x', yref: 'paper', x: x0 + 0.08, y: 1, xanchor: 'left', yanchor: 'top', text: '<i>Not degraded</i>', showarrow: false, font: { size: 11, color: css('--bad') } });
  }
  if (metric === 'conc' && c0) top = Math.max(top, c0);
  if (metric === 'pct') top = Math.max(top, 100);
  return {
    data,
    layout: baseLayout({
      height: 340, barmode: 'overlay', shapes, annotations: panelLabel(fs, annotations),
      margin: { l: 56, r: 16, t: fs.label ? 58 : 34, b: 56 },
      legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1, yanchor: 'bottom', font: { size: 12, color: css('--text-primary') } },
      xaxis: { tickvals: ordered.map((_, i) => i), ticktext: ordered.map(s => label(s.analyte)), range: [-0.6, ordered.length - 0.4], showgrid: false },
      yaxis: {
        type: log ? 'log' : 'linear', dtick: log ? 1 : undefined, rangemode: 'tozero',
        range: !log && top > 0 ? [0, top * (nd ? 1.16 : 1.05)] : undefined,
        title: { text: metric === 'pct' ? '% of t₀ remaining' : metric === 'deg' ? '% substrate degraded' : unitTxt === 'µM' ? 'Concentration (µM)' : `Response (${unitTxt})` },
      },
      title: title ? { text: title, x: 0, font: { size: 13 } } : undefined,
    }),
  };
}

// ── % remaining heatmap (conditions × substrates) ─────────────────────────
export function heatmapFigure(conditions, groups, valueOf) {
  const z = conditions.map(c => groups.map(g => valueOf(c, g)));
  const ramp = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  return {
    data: [{
      type: 'heatmap', z: z.map(r => r.map(v => v == null ? null : Math.min(v, 100))),
      x: groups.map(label), y: conditions, xgap: 2, ygap: 2,
      colorscale: ramp.map((c, i) => [i / (ramp.length - 1), c]),
      zmin: 0, zmax: 100, colorbar: { title: { text: '% left', side: 'right' }, thickness: 10, outlinewidth: 0, tickfont: { color: css('--text-secondary') } },
      customdata: z, hovertemplate: '%{y} · %{x}<br>%{customdata:.1f} % remaining<extra></extra>',
    }],
    layout: baseLayout({
      height: 70 + 46 * conditions.length, margin: { l: 70, r: 10, t: 8, b: 40 },
      xaxis: { showgrid: false, showline: false, ticks: '' }, yaxis: { showgrid: false, showline: false, ticks: '', autorange: 'reversed' },
      annotations: z.flatMap((row, i) => row.map((v, j) => v == null ? null : ({
        x: label(groups[j]), y: conditions[i], text: v < 10 ? v.toFixed(1) : v.toFixed(0), showarrow: false,
        font: { size: 12, color: Math.min(v, 100) > 45 ? '#ffffff' : '#0b0b0b' },
      })).filter(Boolean)),
    }),
  };
}

// ── Time course ───────────────────────────────────────────────────────────
export function timecourseFigure(s, { unit = 'min', metric = 'pct', log = false, color = seriesColor(0) } = {}) {
  const val = r => metric === 'pct' ? r.percent : r.value;
  const recs = s.records.filter(r => Number.isFinite(val(r)));
  const used = recs.filter(r => !r.excluded), exc = recs.filter(r => r.excluded);
  const data = [];
  const pts = s.points.filter(p => p.n);
  data.push({
    x: pts.map(p => toUnit(p.time, unit)), y: pts.map(p => metric === 'pct' ? p.pctMean : p.mean), mode: 'lines+markers', name: 'Mean ± SD',
    line: { color, width: 2 }, marker: { color, size: 8, line: { color: css('--surface-1'), width: 2 } },
    error_y: { type: 'data', array: pts.map(p => (metric === 'pct' ? p.pctSd : p.sd) || 0), color, thickness: 1, width: 3 },
    hovertemplate: pts.map(p => `${timeLabel(p.time, unit)}<br>${fmt(metric === 'pct' ? p.pctMean : p.mean)} ± ${fmt(metric === 'pct' ? p.pctSd : p.sd, 2)} (n = ${p.n})<extra></extra>`),
  });
  data.push({
    x: used.map(r => toUnit(r.time, unit)), y: used.map(val), mode: 'markers', name: 'Replicates',
    marker: { size: 5, color: used.map(r => r.flags.length ? css('--surface-1') : css('--text-secondary')), line: { color: css('--text-secondary'), width: 1 } },
    hovertemplate: used.map(r => `${r.name}<br>${fmt(val(r))}${r.flags.length ? `<br>⚑ ${r.flags.join(', ')}` : ''}<extra></extra>`),
  });
  if (exc.length) data.push({
    x: exc.map(r => toUnit(r.time, unit)), y: exc.map(val), mode: 'markers', name: 'Excluded',
    marker: { size: 6, symbol: 'x-thin', color: css('--bad'), line: { color: css('--bad'), width: 1.5 } },
    hovertemplate: exc.map(r => `${r.name}<br>excluded: ${r.reason}<extra></extra>`),
  });
  const kin = s.kinetics;
  if (kin && kin.k > 0) {
    const tmax = Math.max(...s.points.map(p => p.time));
    const ts = Array.from({ length: 50 }, (_, i) => tmax * i / 49);
    const scale = metric === 'pct' ? 100 / (s.points[0].mean || 1) : 1;
    data.push({
      x: ts.map(t => toUnit(t, unit)), y: ts.map(t => kin.c0 * Math.exp(-kin.k * t) * scale), mode: 'lines', name: 'First-order fit',
      line: { color: css('--text-muted'), width: 1.25, dash: 'dash' }, hoverinfo: 'skip',
    });
  }
  return {
    data,
    layout: baseLayout({
      height: 250, showlegend: false, margin: { l: 52, r: 10, t: 8, b: 44 },
      xaxis: { title: { text: `Time (${unit})` }, rangemode: 'tozero' },
      yaxis: { type: log ? 'log' : 'linear', dtick: log ? 1 : undefined, title: { text: metric === 'pct' ? '% of t₀' : 'Concentration (µM)' }, rangemode: log ? undefined : 'tozero' },
    }),
  };
}

// Kinetics overlay: one line per substrate, distinct marker shapes, optional
// first-order fit drawn through the points.
export function hmm(minutes) {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
export function overlayFigure(seriesList, { unit = 'min', log = false, fs = FIG_DEFAULTS, title = '' } = {}) {
  const tUnit = fs.timeFmt === 'h' ? 'h' : 'min';
  const xOf = t => toUnit(t, tUnit);
  const xMaxH = fs.xMax ? fs.xMax / 60 : Infinity;
  const yOf = (s, p) => fs.kinY === 'conc' ? p.mean : fs.kinY === 'deg' ? 100 - p.pctMean : p.pctMean;
  const data = [];
  seriesList.forEach((s, i) => {
    const color = kinColor(i, fs), symbol = SYMBOLS[i % SYMBOLS.length];
    const pts = s.points.filter(p => p.n && p.time <= xMaxH + 1e-9 && Number.isFinite(yOf(s, p)));
    const sdv = p => fs.kinY === 'conc' ? p.sd : p.pctSd;
    data.push({
      x: pts.map(p => xOf(p.time)), y: pts.map(p => yOf(s, p)), mode: fs.fit && s.kinetics ? 'markers' : 'lines+markers', name: label(s.group),
      line: { color, width: 1.5 }, legendgroup: s.group,
      marker: { size: 9, color, symbol, line: { color: css('--surface-1'), width: 1 } },
      error_y: { type: 'data', array: pts.map(p => errOf(sdv(p), p.n, fs)), visible: fs.err !== 'none', color, thickness: 1, width: 3 },
      hovertemplate: pts.map(p => `<b>${label(s.group)}</b> · ${fs.timeFmt === 'hmm' ? hmm(p.time * 60) : timeLabel(p.time, tUnit)}<br>${fmt(yOf(s, p))} ${fs.kinY === 'conc' ? 'µM' : '%'} ± ${fmt(sdv(p), 2)} (n = ${p.n})<extra></extra>`),
    });
    if (fs.fit && s.kinetics && s.kinetics.k > 0) {
      const tmax = Math.min(Math.max(...s.points.map(p => p.time)), xMaxH);
      const ts = Array.from({ length: 60 }, (_, q) => tmax * q / 59);
      const t0m = s.points[0].mean || 1;
      const c = t => s.kinetics.c0 * Math.exp(-s.kinetics.k * t);
      const y = t => fs.kinY === 'conc' ? c(t) : fs.kinY === 'deg' ? 100 - 100 * c(t) / t0m : 100 * c(t) / t0m;
      data.push({ x: ts.map(xOf), y: ts.map(y), mode: 'lines', showlegend: false, legendgroup: s.group, hoverinfo: 'skip', line: { color, width: 2 }, opacity: 0.55 });
    }
  });
  const allT = [...new Set(seriesList.flatMap(s => s.points.map(p => p.time)))].filter(t => t <= xMaxH + 1e-9).sort((a, b) => a - b);
  const xaxis = { title: { text: fs.timeFmt === 'hmm' ? 'Time (h:mm)' : `Time (${tUnit})` }, rangemode: 'tozero', showgrid: false };
  if (fs.timeFmt === 'hmm') { xaxis.tickvals = allT.map(xOf); xaxis.ticktext = allT.map(t => hmm(t * 60)); }
  return {
    data,
    layout: baseLayout({
      height: 380, margin: { l: 58, r: 10, t: fs.label ? 40 : title ? 40 : 12, b: 50 },
      title: title ? { text: title, x: 0.5, font: { size: 14, color: css('--text-secondary') } } : undefined,
      legend: { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top', font: { size: 11, color: css('--text-primary') } },
      xaxis,
      yaxis: { type: log ? 'log' : 'linear', dtick: log ? 1 : undefined, rangemode: 'tozero',
        title: { text: fs.kinY === 'conc' ? 'Concentration (µM)' : fs.kinY === 'deg' ? '% substrate degraded' : '% of t₀ remaining' } },
      annotations: panelLabel(fs),
    }),
  };
}

// Rate constant vs alkyl chain length, one series per QAC class.
export function rateFigure(seriesList, { perMin = true } = {}) {
  const f = perMin ? 1 / 60 : 1;
  const classes = [...new Set(seriesList.map(s => chem(s.group).cls))];
  const data = classes.map((cls, i) => {
    const ss = seriesList.filter(s => chem(s.group).cls === cls && s.kinetics).sort((a, b) => chem(a.group).chain - chem(b.group).chain);
    return {
      x: ss.map(s => chem(s.group).chain), y: ss.map(s => s.kinetics.k * f), mode: 'lines+markers', name: cls,
      line: { color: seriesColor(i), width: 2 }, marker: { size: 9, color: seriesColor(i), line: { color: css('--surface-1'), width: 2 } },
      error_y: { type: 'data', symmetric: false, array: ss.map(s => (s.kinetics.kHigh - s.kinetics.k) * f), arrayminus: ss.map(s => (s.kinetics.k - s.kinetics.kLow) * f), color: seriesColor(i), thickness: 1, width: 3 },
      hovertemplate: ss.map(s => `<b>${label(s.group)}</b><br>k = ${fmt(s.kinetics.k * f)} ${perMin ? 'min⁻¹' : 'h⁻¹'}<br>t½ = ${fmt(perMin ? s.kinetics.halfLife * 60 : s.kinetics.halfLife)} ${perMin ? 'min' : 'h'}<br>R² = ${s.kinetics.r2.toFixed(3)}<extra></extra>`),
    };
  });
  return {
    data,
    layout: baseLayout({
      height: 320,
      xaxis: { title: { text: 'Alkyl chain length (C<sub>n</sub>)' }, dtick: 2 },
      yaxis: { title: { text: `First-order k (${perMin ? 'min⁻¹' : 'h⁻¹'})` }, rangemode: 'tozero' },
    }),
  };
}

// ── QC: internal standard across the run ──────────────────────────────────
export function isTraceFigure(injections, isId, median, { low = 0.5, high = 1.5 } = {}) {
  const pts = injections.map(r => ({ ...r, a: r.areas[`${isId}|1`] })).filter(r => r.a > 0);
  const smp = pts.filter(r => !r.blank), blk = pts.filter(r => r.blank);
  const data = [
    { x: smp.map(r => r.row + 1), y: smp.map(r => r.a), mode: 'markers', name: 'Samples', marker: { size: 7, color: smp.map(r => r.a < low * median || r.a > high * median ? css('--bad') : seriesColor(0)) }, hovertemplate: smp.map(r => `#${r.row + 1} ${r.name}<br>${fmt(r.a)} (${(100 * r.a / median).toFixed(0)} % of median)<extra></extra>`) },
    { x: blk.map(r => r.row + 1), y: blk.map(r => r.a), mode: 'markers', name: 'Blanks', marker: { size: 7, symbol: 'diamond-open', color: css('--text-muted') }, hovertemplate: blk.map(r => `#${r.row + 1} ${r.name}<br>${fmt(r.a)}<extra></extra>`) },
  ];
  return {
    data,
    layout: baseLayout({
      height: 260,
      xaxis: { title: { text: 'Injection order' } },
      yaxis: { type: 'log', title: { text: `${label(isId).replace(/<[^>]+>/g, '')} peak area` }, exponentformat: 'power', dtick: 1 },
      shapes: [{ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: low * median, y1: high * median, fillcolor: css('--good'), opacity: 0.08, line: { width: 0 }, layer: 'below' },
        { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: median, y1: median, line: { color: css('--text-muted'), width: 1, dash: 'dot' } }],
    }),
  };
}
