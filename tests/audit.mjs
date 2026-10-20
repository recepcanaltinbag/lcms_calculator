// Prints audit findings for every registered experiment (local data).
import fs from 'fs';
import path from 'path';
import { runExperiment, audit } from '../js/engine/index.js';
const base = path.resolve(fs.existsSync('local/experiments.json') ? 'local' : 'demo');
const reg = JSON.parse(fs.readFileSync(path.join(base, 'experiments.json'), 'utf8'));
const read = p => fs.readFileSync(path.join(base, p), 'utf8');
for (const e of reg.experiments) {
  if (process.argv[2] && e.id !== process.argv[2]) continue;
  const run = await runExperiment(reg, e.id, read);
  const f = audit(run);
  console.log(`\n===== ${e.id} (${f.length})`);
  for (const x of f) console.log(`  [${x.severity}] ${x.kind}: ${x.message}`);
}
