# LC-MS/MS QAC Quant

Static web app that turns LC-MS/MS peak-area exports into calibrated
concentrations, % remaining, first-order rate constants and print-ready figures
for quaternary ammonium compound (QAC) degradation assays. Everything runs in
the browser; there is no build step and no server-side code.

- **Analyze files** – drop a calibration export and a sample export, check how
  the sample names are read, get the full report.
- **Experiments** – reports for every experiment in a registry
  (`local/experiments.json`, falling back to the bundled synthetic `demo/`).
- **Calibrations** – weighted fits, back-calculated accuracy, rejected
  standards, LOD/LOQ, ion ratios.
- **Method** – equations and acceptance criteria.

## Run locally

```bash
npm run serve        # python3 -m http.server 8000, then open http://localhost:8000
npm test             # engine tests (adds regression tests when local/ exists)
npm run summary      # text summary of every registered experiment
```

## Your own experiments (kept out of git)

`local/` is git-ignored. Put raw exports in `local/data/` and describe them in
`local/experiments.json`:

```jsonc
{
  "calibrations": [
    { "id": "cal_old6", "label": "6 QACs · d3-MTP", "file": "data/Calibration_old.txt",
      "is": "d3MTP", "isConc": 0.022,
      "analytes": ["C12BDMA", "C14BDMA", "C16BDMA", "C16TMA", "C10-10DMA", "C16Pyr", "BDMA", "DDMA"] }
  ],
  "experiments": [
    { "id": "enzymes", "title": "Enzymes · 0 vs 24 h", "file": "data/run.txt",
      "design": "endpoint",                 // or "timecourse"
      "calibrations": ["cal_old6"],         // several allowed; each analyte uses the curve it was spiked in
      "dilution": 100, "c0": 2.5,
      "conditions": { "sap": "SapB", "sph": "SphB" },   // name token → label
      "groups": { "dd": "C12-12DMA" },                   // extra substrate codes
      "rules": [ { "where": { "condition": "QxyA" }, "set": { "mode": "relative", "is": "C12BDMA" } } ],
      "exclude": [ { "name": "sap_c12_t0_r1", "reason": "spilled" } ],
      "renames": [ { "row": 19, "name": "c12_A_1_1", "reason": "mislabelled" } ],
      "assumed": ["dilution"] }             // highlighted in the report until confirmed
  ]
}
```

The **Analyze files** page can download a ready-made registry entry for a file
set, and every report has **Export config** to save exclusions made in the data
table.

### Sample names

Names are split on `_`. Tokens are matched to a condition (`conditions`), a
substrate code (built-in list in `js/engine/chemicals.js` plus `groups`), a time
and a replicate: `sap_c12_t24_r1`, `C8B_d1_1` (days), `T14_20m_2` (minutes),
`c12_120_1` (bare numbers use `naming.bareTimeUnit`). For other layouts set
`naming.order`, e.g. `["group", "condition", "rep", "time"]`. Names starting
with `acn`, `blank`, `water` are treated as solvent blanks.

## Layout

```
js/engine/   parse.js · chemicals.js · calibration.js · quant.js · stats.js   (no DOM; also used by tests)
js/ui/       charts.js (Plotly figures + print export) · report.js · shell.js
tests/       run.mjs (unit + regression) · summary.mjs
tools/       make_demo.mjs (regenerates demo/)
```
