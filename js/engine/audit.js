// Automatic checks for common bench and run-sequence mistakes. Each finding
// names the injections involved and says what to verify; nothing is changed.
import { plainLabel } from './chemicals.js';
import { median, mean, sd } from './stats.js';

const fmtT = h => h < 1 ? `${+(h * 60).toFixed(0)} min` : `${+h.toFixed(1)} h`;

export function audit(run) {
  const { result, calibrations, experiment: exp } = run;
  const findings = [];
  const add = (severity, kind, message, samples = []) => findings.push({ severity, kind, message, samples });
  const subs = result.records.filter(r => r.role === 'substrate');
  const byRow = new Map(subs.map(r => [r.row, r]));

  // 1. Time label disagrees with the run block it sits in. Runs are usually
  //    queued time point by time point; a sample whose neighbours (same run,
  //    non-blank) all carry another time is probably mislabelled.
  const seq = result.injections.filter(i => !i.blank && byRow.has(i.row)).map(i => byRow.get(i.row));
  if (new Set(seq.map(r => r.time)).size > 1) {
    for (let i = 0; i < seq.length; i++) {
      const r = seq[i];
      const nb = [-3, -2, -1, 1, 2, 3].map(d => seq[i + d]).filter(Boolean);
      if (nb.length < 4) continue;
      const others = nb.filter(q => q.time !== r.time);
      const blockTime = others[0]?.time;
      if (others.length < nb.length - 1 || others.some(q => q.time !== blockTime)) continue;
      // Does the signal agree with the label or with the block? Compare the
      // substrate area with same-substrate injections at each time.
      const same = subs.filter(q => q !== r && q.condition === r.condition && q.group === r.group && q.area > 0);
      const mOwn = median(same.filter(q => q.time === r.time).map(q => q.area));
      const mBlk = median(same.filter(q => q.time === blockTime).map(q => q.area));
      let hint = ' Its signal fits its own label, so the injection order may simply differ.';
      let sev = 'warn';
      if (r.area > 0 && mOwn > 0 && mBlk > 0) {
        const dOwn = Math.abs(Math.log(r.area / mOwn)), dBlk = Math.abs(Math.log(r.area / mBlk));
        if (dBlk < dOwn) { hint = ` Its peak area (${r.area.toPrecision(3)}) matches the ${fmtT(blockTime)} replicates (median ${mBlk.toPrecision(3)}) rather than the ${fmtT(r.time)} ones (${mOwn.toPrecision(3)}) — likely a label swap.`; sev = 'error'; }
      }
      add(sev, 'label', `“${r.name}” is labelled ${fmtT(r.time)} but sits among ${fmtT(blockTime)} injections (#${r.row + 1}).${hint}`, [r.name]);
    }
  }

  // 2. Same sample name injected more than once.
  const counts = {};
  result.injections.filter(i => !i.blank).forEach(i => counts[i.name] = (counts[i.name] || 0) + 1);
  for (const [n, c] of Object.entries(counts)) if (c > 1) add('info', 'duplicate', `“${n}” was injected ${c}×; only the last injection is used.`, [n]);

  // 3. Failed injections: IS absent, or the substrate at blank level at t0.
  for (const r of subs.filter(x => x.flags.includes('IS missing')))
    add('error', 'injection', `${r.name}: internal standard (${plainLabel(r.is)}) at ${(100 * (r.isRel || 0)).toFixed(1)} % of the run median — failed injection or IS not added. No value reported.`, [r.name]);
  const t0 = Math.min(...result.times);
  for (const r of subs.filter(x => x.time === t0 && x.flags.some(f => f === 'not detected' || f === '≤ 3× blank')))
    add('error', 'injection', `${r.name}: substrate not above blank at t₀ — empty vial, missed spike or wrong substrate code.`, [r.name]);

  // 4. Replicate outliers (≥ 3 replicates; > 2.5× from the median of the others).
  for (const s of result.series.filter(x => x.role === 'substrate')) {
    for (const p of s.points) {
      const recs = s.records.filter(r => r.time === p.time && !r.excluded && Number.isFinite(r.value) && r.value > 0);
      if (recs.length < 3) continue;
      for (const r of recs) {
        const m = median(recs.filter(q => q !== r).map(q => q.value));
        const f = r.value / m;
        if (m > 0 && (f > 2.5 || f < 0.4) && !(p.time !== t0 && r.flags.includes('< LLOQ')))
          add('warn', 'outlier', `${r.name}: ${f > 1 ? f.toFixed(1) + '× higher' : (1 / f).toFixed(1) + '× lower'} than the other replicates at ${fmtT(p.time)} (${r.value.toPrecision(3)} vs median ${m.toPrecision(3)} ${r.unit}).`, [r.name]);
      }
    }
    const p0 = s.points.find(p => p.time === t0);
    if (p0?.n >= 3 && p0.sd / p0.mean > 0.3)
      add('warn', 'spread', `${s.condition ? s.condition + ' · ' : ''}${plainLabel(s.group)}: t₀ replicates vary by ${(100 * p0.sd / p0.mean).toFixed(0)} % CV — % remaining for this substrate is uncertain.`, s.records.filter(r => r.time === t0).map(r => r.name));
  }

  // 5. Concentration plausibility against the nominal starting concentration.
  const abs = result.series.filter(s => s.role === 'substrate' && s.mode === 'absolute');
  if (abs.length) {
    const t0means = abs.map(s => s.points.find(p => p.time === t0)?.mean).filter(Number.isFinite);
    const med = median(t0means);
    if (exp.c0) {
      const ratio = med / exp.c0;
      if (ratio > 2 || ratio < 0.5)
        add('error', 'units', `Median t₀ concentration is ${med.toPrecision(3)} µM, ${ratio.toFixed(1)}× the nominal ${exp.c0} µM. Check the dilution factor (${exp.dilution}×) and the IS concentration; a ${ratio > 1 ? 'smaller' : 'larger'} dilution factor of ~${(exp.dilution / ratio).toPrecision(2)}× would match.`);
    }
    const hi = subs.filter(r => r.flags.includes('> ULOQ'));
    if (hi.length) add('warn', 'range', `${hi.length} result(s) above the highest accepted standard (e.g. ${hi.slice(0, 3).map(r => r.name).join(', ')}). Values are extrapolated; re-inject at a higher dilution if they matter.`, hi.map(r => r.name));
  }

  // 6. Substrate increasing over time (beyond replicate noise).
  for (const s of result.series.filter(x => x.role === 'substrate')) {
    const last = s.points[s.points.length - 1], first = s.points[0];
    if (s.points.length > 1 && last.n && first.n && last.mean > first.mean * 1.2)
      add('warn', 'increase', `${s.condition ? s.condition + ' · ' : ''}${plainLabel(s.group)} is ${(100 * last.mean / first.mean).toFixed(0)} % of t₀ at ${fmtT(last.time)} — higher than the start. Usually low t₀ recovery (adsorption, incomplete mixing) or a t₀/t-end swap.`);
  }

  // 7. Carry-over: blank signal relative to the highest same-analyte sample
  //    among the preceding ten injections.
  const inj = result.injections;
  const analytes = [...new Set(subs.map(r => r.analyte))];
  for (let i = 1; i < inj.length; i++) {
    if (!inj[i].blank) continue;
    let worst = null;
    for (const an of analytes) {
      const prev = inj.slice(Math.max(0, i - 10), i).filter(x => !x.blank).map(x => byRow.get(x.row)).filter(r => r && r.analyte === an && r.area > 0);
      if (!prev.length) continue;
      const top = prev.reduce((m, r) => r.area > m.area ? r : m);
      const a = inj[i].areas[`${an}|1`];
      const frac = a / top.area;
      if (a > 1e4 && frac > 0.005 && (!worst || frac > worst.frac)) worst = { an, frac, top, a };
    }
    if (worst) add(worst.frac > 0.02 ? 'warn' : 'info', 'carryover', `Blank “${inj[i].name}” (#${i + 1}) shows ${plainLabel(worst.an)} at ${(100 * worst.frac).toFixed(1)} % of the highest of the 10 preceding samples (“${worst.top.name}”). ${worst.frac > 1 ? 'The blank is higher than the samples themselves: background contamination of solvent, vial or system rather than simple carry-over.' : worst.frac > 0.02 ? 'Carry-over or contaminated solvent: low-level samples right after high ones may read high.' : 'Minor carry-over.'}`, [inj[i].name]);
  }

  // 8. IS response very different from the calibration run.
  for (const x of result.runIS) {
    const cal = calibrations.find(c => c.config.is === x.id);
    if (!cal) continue;
    const ratio = x.median / cal.isAreaMedian;
    if (ratio > 3 || ratio < 1 / 3)
      add('info', 'is-level', `${plainLabel(x.id)} response in samples is ${ratio.toFixed(1)}× that of the standards. Fine if the same IS amount was spiked (sensitivity change); otherwise enter the sample IS concentration.`);
  }

  // 9. Calibration problems that affect reported analytes.
  const used = new Set(subs.map(r => `${r.calId}|${r.analyte}`));
  for (const cal of calibrations) for (const c of Object.values(cal.curves)) {
    if (!used.has(`${cal.id}|${c.chem}`)) continue;
    if (c.warnings.length) add('warn', 'calibration', `${plainLabel(c.chem)} (${cal.label}): ${c.warnings.join(' ')}`);
    if (c.ionRatio?.cv > 25) add('info', 'calibration', `${plainLabel(c.chem)} (${cal.label}): qualifier/quantifier ratio varies ${c.ionRatio.cv.toFixed(0)} % between standards — the qualifier transition is weak or interfered.`);
  }

  // 10. Product channel interference: the qualifier/quantifier ratio of a
  //     product in samples where it cannot have formed yet (t0) differs from
  //     the standards — a co-eluting matrix compound inflates the baseline.
  for (const s of result.series.filter(x => x.role === 'product')) {
    const cal = calibrations.find(c => c.curves[s.analyte]?.ionRatio);
    const ref = cal?.curves[s.analyte].ionRatio.mean;
    const r0 = s.records.filter(r => r.time === t0 && r.area > 0 && r.qual > 0).map(r => r.qual / r.area);
    if (!ref || r0.length < 2) continue;
    const m = median(r0), dev = 100 * (m / ref - 1);
    if (Math.abs(dev) > 15 && s.points[0]?.mean > 0)
      add('warn', 'interference', `${plainLabel(s.analyte)} measured at t₀ in ${s.condition ? s.condition + ' · ' : ''}${plainLabel(s.group)} (${s.points[0].mean.toPrecision(2)} ${s.records[0].unit}) has a qualifier/quantifier ratio of ${m.toFixed(3)} vs ${ref.toFixed(3)} in the standards (${dev > 0 ? '+' : ''}${dev.toFixed(0)} %): mostly a co-eluting matrix compound, not ${plainLabel(s.analyte)}. Report net formation (t − t₀) or subtract a matrix blank.`);
  }

  const order = { error: 0, warn: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
