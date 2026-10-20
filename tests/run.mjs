// Engine tests. Run with: node tests/run.mjs
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import {
  parseExport, buildCalibration, parseSampleName, quantify, wls, welch, t95,
  resolveChemical, runExperiment, EXP_DEFAULTS,
} from '../js/engine/index.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

console.log('parsing');
await test('column typos resolve to canonical chemicals', () => {
  assert.equal(resolveChemical('Dodecyltrimehylammonium').id, 'C12TMA');
  assert.equal(resolveChemical('Hexyltrimethylammonuim').id, 'C6TMA');
  assert.equal(resolveChemical('Didodecyldimethyammonium').id, 'C12-12DMA');
  assert.equal(resolveChemical('Mysristyltrimethylammonium').id, 'C14TMA');
  assert.equal(resolveChemical('Pyr').id, 'Pyridine');
  assert.equal(resolveChemical('Hexadecylpyridinium').id, 'C16Pyr');
});
await test('two rows glued by a missing line break are split', () => {
  const t = 'Sample Name\td3MTP-1\tBDMA-1\n0.1_uM\t10\t1.5\n0.25_uM\t11\t1924.030980198350.25_uM\t12\t3.5\n';
  const p = parseExport(t);
  assert.deepEqual(p.rows.map(r => r.name), ['0.1_uM', '0.25_uM', '0.25_uM']);
  assert.equal(p.rows[1].areas['BDMA|1'], 1924.03098019835);
  assert.equal(p.rows[2].areas['BDMA|1'], 3.5);
});
await test('N/A and CRLF are handled', () => {
  const p = parseExport('Sample Name\tBDMA-1\tBDMA-2\r\nx\tN/A\t5\r\n');
  assert.equal(p.rows[0].areas['BDMA|1'], null);
  assert.equal(p.rows[0].areas['BDMA|2'], 5);
});

console.log('sample names');
const exp = { ...EXP_DEFAULTS, conditions: { qxya: 'QxyA', sap: 'SapB' } };
const cases = [
  ['sap_c12_t24_r1', { condition: 'SapB', group: 'C12BDMA', time: 24, rep: 1 }],
  ['qxya_ctab_t0_3', { condition: 'QxyA', group: 'C16TMA', time: 0, rep: 3 }],
  ['C8B_d1_1', { group: 'C8BDMA', time: 24, rep: 1 }],
  ['C10T_24h_3', { group: 'C10TMA', time: 24, rep: 3 }],
  ['T14_20m_2', { group: 'C14TMA', time: 20 / 60, rep: 2 }],
];
for (const [name, want] of cases) {
  await test(name, () => {
    const got = parseSampleName(name, exp);
    for (const [k, v] of Object.entries(want)) {
      if (typeof v === 'number') close(got[k], v, 1e-9, k);
      else assert.equal(got[k], v);
    }
  });
}
await test('bare minutes and explicit token order', () => {
  const a = parseSampleName('c12_120_2', { ...exp, naming: { bareTimeUnit: 'min' } });
  close(a.time, 2, 1e-9, 'time'); assert.equal(a.rep, 2);
  const b = parseSampleName('c14_A_3_1', { ...exp, conditions: { a: 'Plasmid A' }, naming: { order: ['group', 'condition', 'rep', 'time'], bareTimeUnit: 'd' } });
  assert.equal(b.condition, 'Plasmid A'); assert.equal(b.rep, 3); close(b.time, 24, 1e-9, 'time');
  assert.ok(parseSampleName('acn2', exp).blank);
});

console.log('statistics');
await test('weighted regression recovers an exact line', () => {
  const xs = [0.005, 0.01, 0.05, 0.1, 0.25], ys = xs.map(x => 4 * x + 0.01);
  for (const w of ['none', '1/x', '1/x2']) {
    const f = wls(xs, ys, { weighting: w });
    close(f.slope, 4, 1e-9, `slope ${w}`); close(f.intercept, 0.01, 1e-9, `intercept ${w}`);
  }
});
await test('t critical values and Welch test', () => {
  close(t95(2), 4.303, 1e-3, 't95(2)'); close(t95(10), 2.228, 1e-3, 't95(10)');
  const r = welch([1, 2, 3], [4, 5, 6]);
  close(r.t, -3.674, 1e-3, 't'); close(r.p, 0.0213, 1e-3, 'p');
});

console.log('calibration & quantification (synthetic)');
const levels = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25];
const calText = ['Sample Name\tBenzyldimethyldodecylammonium-1\tBenzyldimethyldodecylammonium-2\td3MTP-1',
  ...levels.map((c, i) => `${c}_uM\t${(c * 2e8 * (i === 5 ? 1.6 : 1)).toFixed(1)}\t${(c * 0.4e8).toFixed(1)}\t1000000`)].join('\n');
const cal = buildCalibration(parseExport(calText, 'cal'), { id: 'c', is: 'd3MTP', isConc: 0.022 });
await test('outlying top standard is excluded and range truncated', () => {
  const c = cal.curves.C12BDMA;
  assert.equal(c.status, 'ok');
  assert.equal(c.uloq, 0.1);
  close(c.fit.slope, 200, 1e-6, 'slope');
  assert.ok(c.points.find(p => p.x === 0.25).auto);
});
await test('sample back-calculation applies dilution and flags', () => {
  const s = parseExport('Sample Name\tBenzyldimethyldodecylammonium-1\tBenzyldimethyldodecylammonium-2\td3MTP-1\nc12_t0_1\t10000000\t2000000\t1000000\nc12_t24_1\t200\t40\t1000000\nacn\t50\t\t900\n', 's');
  const q = quantify(s, [cal], { dilution: 100 });
  const t0 = q.records.find(r => r.time === 0), t24 = q.records.find(r => r.time === 24);
  close(t0.value, 5, 1e-9, 't0 µM');            // 10/200 = 0.05 µM in vial × 100
  assert.ok(t24.flags.includes('< LLOQ'));
  assert.ok(t24.flags.includes('≤ 3× blank') === false);
  assert.equal(q.series[0].points[1].pctMean.toFixed(4), (100 * t24.value / 5).toFixed(4));
});

// Optional checks against private data in the git-ignored local/ folder:
// local/experiments.json (registry) and local/regression.json (legacy results).
const localDir = path.resolve('local');
if (fs.existsSync(path.join(localDir, 'experiments.json'))) {
  console.log('local data');
  const reg = JSON.parse(fs.readFileSync(path.join(localDir, 'experiments.json'), 'utf8'));
  const read = p => fs.readFileSync(path.join(localDir, p), 'utf8');
  const firstTwoCals = reg.experiments.find(e => (e.calibrations || []).length >= 2);
  if (firstTwoCals) await test('analyte uses the calibration it was spiked in, regardless of order', async () => {
    const open = JSON.parse(JSON.stringify(reg));
    open.calibrations.forEach(c => delete c.analytes);
    const [c1, c2] = firstTwoCals.calibrations;
    const a = await runExperiment(open, firstTwoCals.id, read, { calibrations: [c1, c2] });
    const b = await runExperiment(open, firstTwoCals.id, read, { calibrations: [c2, c1] });
    for (const r of a.result.records.filter(x => x.calId)) {
      const q = b.result.records.find(x => x.row === r.row && x.analyte === r.analyte);
      assert.equal(q.calId, r.calId, `${r.name} ${r.analyte}`);
    }
  });
  const regPath = path.join(localDir, 'regression.json');
  if (fs.existsSync(regPath)) {
    const legacy = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const { result } = await runExperiment(reg, legacy.experiment, read,
      { calOverrides: { [legacy.calibration]: { weighting: 'none', origin: true, autoExclude: false } } });
    for (const [cond, byGroup] of Object.entries(legacy.values)) {
      await test(`${cond} matches legacy results (same calibration model)`, () => {
        for (const [g, [t0, t24]] of Object.entries(byGroup)) {
          const s = result.series.find(x => x.condition === cond && x.group === g && x.role === 'substrate');
          close(s.points[0].mean, t0, 0.0015, `${g} t0`);
          close(s.points[1].mean, t24, 0.0015, `${g} t24`);
        }
      });
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
