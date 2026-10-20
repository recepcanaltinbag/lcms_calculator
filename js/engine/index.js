// Entry point shared by the browser pages and the Node tests.
import { parseExport } from './parse.js';
import { buildCalibration } from './calibration.js';
import { quantify } from './quant.js';

export * from './parse.js';
export * from './calibration.js';
export * from './quant.js';
export * from './chemicals.js';
export * from './stats.js';
export * from './audit.js';

// Run one experiment from a registry ({ calibrations, experiments }).
// readText(path) returns the file contents (fetch in the browser, fs in Node).
export async function runExperiment(registry, expId, readText, overrides = {}) {
  const exp = registry.experiments.find(e => e.id === expId);
  if (!exp) throw new Error(`Unknown experiment ${expId}`);
  const cfg = { ...exp, ...overrides };
  const calibrations = [];
  for (const id of cfg.calibrations || []) {
    const c = registry.calibrations.find(x => x.id === id);
    if (!c) throw new Error(`Experiment ${expId} refers to unknown calibration ${id}`);
    calibrations.push(buildCalibration(parseExport(await readText(c.file), c.file), { ...c, ...(overrides.calOverrides?.[id] || {}) }));
  }
  const parsed = parseExport(await readText(cfg.file), cfg.file);
  return { experiment: cfg, calibrations, result: quantify(parsed, calibrations, cfg) };
}

export async function runCalibration(registry, calId, readText, overrides = {}) {
  const c = registry.calibrations.find(x => x.id === calId);
  return buildCalibration(parseExport(await readText(c.file), c.file), { ...c, ...overrides });
}
