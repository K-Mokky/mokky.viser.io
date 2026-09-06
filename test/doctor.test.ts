import test from "node:test";
import assert from "node:assert/strict";
import { doctorReport } from "../src/cli/doctor.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

test("doctorReport includes provider-proof verification and launch rehearsal commands", () => {
  const report = doctorReport(DEFAULT_CONFIG);

  assert.match(report, /Viser doctor/);
  assert.match(report, /node: v?\d+\.\d+\.\d+ .*requires >= 22\.6\.0/);
  assert.match(report, /Recommended checks:/);
  assert.match(report, /viser verify --live --probe-all-providers/);
  assert.match(report, /viser launch-status/);
  assert.match(report, /viser env-check/);
  assert.match(report, /viser gateway --dry-run --strict --live --probe-all-providers/);
  assert.match(report, /viser next-steps --live --probe-all-providers/);
  assert.match(report, /model calls still go through local CLIs/);
});
