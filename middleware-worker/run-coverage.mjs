// Cross-platform coverage runner. Spawns `node --test` with coverage
// thresholds passed as an argv array (shell:false), so the exclude globs are
// never touched by a shell — this avoids the cmd.exe single-quote issue on
// Windows where `'**/*.test.mjs'` would otherwise reach node with its quotes
// intact and fail to match. Exits with the child's exit code so the coverage
// floor still gates CI.
import { spawnSync } from "node:child_process";

const args = [
  "--test",
  "--experimental-test-coverage",
  "--test-coverage-exclude=**/*.test.mjs",
  "--test-coverage-exclude=dev-server.mjs",
  "--test-coverage-exclude=run-coverage.mjs",
  "--test-coverage-lines=95",
  "--test-coverage-branches=90",
  "--test-coverage-functions=90",
];

const result = spawnSync(process.execPath, args, { stdio: "inherit" });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
