// Prints a compact summary of every registered experiment (local data).
import fs from 'fs';
import path from 'path';
import { runExperiment, plainLabel } from '../js/engine/index.js';
const base = path.resolve('local');
const reg = JSON.parse(fs.readFileSync(path.join(base, 'experiments.json'), 'utf8'));
const read = p => fs.readFileSync(path.join(base, p), 'utf8');
const f = (v, d = 3) => Number.isFinite(v) ? v.toPrecision(d) : '—';
for (const e of reg.experiments) {
  if (process.argv[2] && e.id !== process.argv[2]) continue;
  const { result } = await runExperiment(reg, e.id, read);
  console.log(`\n===== ${e.id}  records=${result.records.length}`);
  result.notes.forEach(n => console.log('  note:', n));
  const flags = {};
  result.records.forEach(r => r.flags.forEach(fl => flags[fl] = (flags[fl] || 0) + 1));
  console.log('  flags:', JSON.stringify(flags), ' runIS:', result.runIS.map(x => `${x.id}=${f(x.median)}`).join(' '));
  for (const s of result.series) {
    const pts = s.points.map(p => `t${+p.time.toFixed(2)}:${f(p.mean)}±${f(p.sd, 2)}(n${p.n})${p.pctMean != null ? ` ${f(p.pctMean)}%` : ''}`).join('  ');
    const k = s.kinetics ? `  k=${f(s.kinetics.k)}/h t½=${f(s.kinetics.halfLife * 60)}min R²=${f(s.kinetics.r2)}` : '';
    const t = s.test ? `  p=${f(s.test.p, 2)}` : '';
    console.log(`  ${s.condition.padEnd(8)} ${plainLabel(s.group).padEnd(10)} ${s.analyte.padEnd(9)} ${s.mode.slice(0, 3)} ${pts}${k}${t}`);
  }
}
