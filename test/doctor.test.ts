import test from "node:test";
import assert from "node:assert/strict";
import { doctorReport } from "../src/cli/doctor.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

test("doctorReport includes provider-proof verification and launch rehearsal commands", () => {
  const report = doctorReport(DEFAULT_CONFIG);

  assert.match(report, /Viser doctor/);
  assert.match(report, /node: v?\d+\.\d+\.\d+ .*requires >= 22\.6\.0/);
  assert.match(report, /Recommended checks:/);
  assert.match(report, /node src\/index.ts verify --live --probe-all-providers/);
  assert.match(report, /node src\/index.ts launch-status/);
  assert.match(report, /node src\/index.ts env-check/);
  assert.match(report, /node src\/index.ts gateway --dry-run --strict --live --probe-all-providers/);
  assert.match(report, /node src\/index.ts next-steps --live --probe-all-providers/);
  assert.match(report, /model calls still go through local CLIs/);
});
