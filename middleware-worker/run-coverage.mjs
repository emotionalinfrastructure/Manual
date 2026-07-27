// Cross-platform coverage runner with PER-MODULE threshold enforcement.
//
// Node's own `--test-coverage-*` flags apply a single GLOBAL floor, which
// can't express "policy.js needs 90% branch but llm.js needs 85%". This runner
// spawns `node --test` with coverage, streams the report through, then parses
// the per-file table and enforces a module-specific floor for each source
// file plus an overall floor. It exits non-zero if any test fails OR any
// module is below its floor, so a regression fails CI.
//
// Zero dependencies (only node:child_process), matching the worker's
// zero-install posture. Flags are passed as an argv array (shell:false), so
// the exclude globs are never touched by a shell — avoids the Windows cmd.exe
// quoting issue.
import { spawnSync } from "node:child_process";

// Per-module floors. Line/branch are enforced; function % is reported only
// (llm.js has one intentionally uncovered error-of-an-error handler that would
// make a function floor noise). Floors sit just below measured values so CI
// fails on regression, not on incidental variation.
const MODULE_FLOORS = {
  "index.js": { line: 85, branch: 85 },
  "lexicon.js": { line: 90, branch: 90 },
  "llm.js": { line: 85, branch: 85 },
  "policy.js": { line: 90, branch: 90 },
  "sessions.js": { line: 90, branch: 85 },
};
const OVERALL_FLOOR = { line: 90, branch: 85 };

const coverageArgs = [
  "--test",
  "--experimental-test-coverage",
  "--test-coverage-exclude=**/*.test.mjs",
  "--test-coverage-exclude=dev-server.mjs",
  "--test-coverage-exclude=run-coverage.mjs",
];

const result = spawnSync(process.execPath, coverageArgs, { encoding: "utf8" });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}

const output = `${result.stdout || ""}${result.stderr || ""}`;
process.stdout.write(result.stdout || "");
if (result.stderr) process.stderr.write(result.stderr);

// A run that failed tests already has a non-zero status; surface it verbatim.
if (result.status !== 0) {
  console.error(`\nTest run failed (exit ${result.status}); coverage floors not evaluated.`);
  process.exit(result.status ?? 1);
}

// Parse the coverage table rows: "# index.js | 100.00 | 95.56 | 100.00 |".
function parseRow(line) {
  const cleaned = line.replace(/^[#\s]+/, "");
  const cols = cleaned.split("|").map((c) => c.trim());
  if (cols.length < 4) return null;
  const [name, linePct, branchPct, funcPct] = cols;
  const nums = [linePct, branchPct, funcPct].map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  return { name, line: nums[0], branch: nums[1], func: nums[2] };
}

const rows = {};
let overall = null;
for (const raw of output.split("\n")) {
  const row = parseRow(raw);
  if (!row) continue;
  if (row.name === "all files") overall = row;
  else if (row.name.endsWith(".js")) rows[row.name] = row;
}

const failures = [];
function check(label, actual, floor) {
  if (actual == null) {
    failures.push(`${label}: coverage not found in report`);
    return;
  }
  for (const metric of Object.keys(floor)) {
    if (actual[metric] < floor[metric]) {
      failures.push(
        `${label}: ${metric} ${actual[metric].toFixed(2)}% < floor ${floor[metric]}%`
      );
    }
  }
}

for (const [name, floor] of Object.entries(MODULE_FLOORS)) {
  check(name, rows[name], floor);
}
check("all files", overall, OVERALL_FLOOR);

if (failures.length) {
  console.error("\nCoverage floor NOT met:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.error("\nCoverage floors met for every module and overall.");
process.exit(0);
