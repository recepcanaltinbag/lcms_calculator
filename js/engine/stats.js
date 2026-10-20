export const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;

export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

const weightOf = (x, weighting) =>
  weighting === '1/x2' ? 1 / (x * x) : weighting === '1/x' ? 1 / x : 1;

// Weighted least squares y = m·x + b (or y = m·x when origin is true).
export function wls(xs, ys, { weighting = 'none', origin = false } = {}) {
  const w = xs.map(x => weightOf(x, weighting));
  let Sw = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  xs.forEach((x, i) => {
    Sw += w[i]; Sx += w[i] * x; Sy += w[i] * ys[i];
    Sxx += w[i] * x * x; Sxy += w[i] * x * ys[i];
  });
  let slope, intercept;
  if (origin) { slope = Sxy / Sxx; intercept = 0; }
  else {
    const d = Sw * Sxx - Sx * Sx;
    slope = (Sw * Sxy - Sx * Sy) / d;
    intercept = (Sy - slope * Sx) / Sw;
  }
  const my = mean(ys);
  let ssr = 0, sst = 0;
  xs.forEach((x, i) => { ssr += (ys[i] - slope * x - intercept) ** 2; sst += (ys[i] - my) ** 2; });
  const df = xs.length - (origin ? 1 : 2);
  // Standard error of the slope (unweighted residuals; used for the CI on k).
  const mx = mean(xs);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const sres = df > 0 ? Math.sqrt(ssr / df) : NaN;
  return { slope, intercept, r2: sst > 0 ? 1 - ssr / sst : NaN, sres, seSlope: sres / Math.sqrt(sxx), n: xs.length, df };
}

// Spearman rank correlation.
export function spearman(xs, ys) {
  const rank = a => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys), mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  rx.forEach((v, i) => { num += (v - mx) * (ry[i] - my); dx += (v - mx) ** 2; dy += (ry[i] - my) ** 2; });
  return num / Math.sqrt(dx * dy);
}

// ── Student t distribution ────────────────────────────────────────────────
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betacf(a, b, x) {
  const FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

// Two-sided p-value for t with df degrees of freedom.
export const tPValue = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);

// Two-sided 95 % critical value, by bisection on the CDF.
export function t95(df) {
  if (!(df >= 1)) return NaN;
  let lo = 0, hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tPValue(mid, df) > 0.05) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Welch's unequal-variance t-test.
export function welch(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
  if (va + vb === 0) return null;
  const t = (mean(a) - mean(b)) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { t, df, p: tPValue(Math.abs(t), df) };
}
