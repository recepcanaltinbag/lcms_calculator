// Page chrome (header, theme toggle) and registry loading shared by all pages.

const PAGES = [
  ['index.html', 'Home'],
  ['experiments.html', 'Experiments'],
  ['calibrations.html', 'Calibrations'],
  ['analyzer.html', 'Analyze files'],
  ['method.html', 'Method'],
];

export function shell(active) {
  const saved = (() => { try { return localStorage.getItem('lcms:theme'); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  const header = document.createElement('header');
  header.className = 'top';
  header.innerHTML = `<a class="brand" href="index.html"><span class="logo">Q</span>QAC Quant</a>
    <nav>${PAGES.map(([href, t]) => `<a href="${href}" class="${href === active ? 'active' : ''}">${t}</a>`).join('')}</nav>
    <span class="spacer"></span><button class="theme-toggle" type="button">Theme</button>`;
  document.body.prepend(header);
  header.querySelector('.theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('lcms:theme', next); } catch { /* ignore */ }
    location.reload();
  });
  const footer = document.createElement('footer');
  footer.innerHTML = 'Calculations run entirely in your browser; uploaded files never leave this computer. Engine and tests: <a href="https://github.com/recepcanaltinbag/lcms_calculator">github.com/recepcanaltinbag/lcms_calculator</a>';
  document.body.appendChild(footer);
}

// Prefer the git-ignored local registry; fall back to the bundled demo.
export async function loadRegistry() {
  for (const [base, kind] of [['local/', 'local'], ['demo/', 'demo']]) {
    try {
      const res = await fetch(`${base}experiments.json`, { cache: 'no-store' });
      if (!res.ok) continue;
      const registry = await res.json();
      const readText = async p => {
        const r = await fetch(base + p, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Cannot load ${base}${p} (${r.status})`);
        return r.text();
      };
      return { registry, readText, kind };
    } catch { /* try next */ }
  }
  return null;
}

export function demoBanner(kind) {
  if (kind !== 'demo') return '';
  return `<div class="callout info">Showing <b>demo data</b> (synthetic). To see your own experiments, run the site locally with a <span class="mono">local/experiments.json</span> registry — see the README — or use <a href="analyzer.html">Analyze files</a>.</div>`;
}

export function showError(root, err) {
  root.innerHTML = `<div class="callout bad"><b>Something went wrong.</b><br>${String(err?.message || err).replace(/</g, '&lt;')}</div>`;
  console.error(err);
}
