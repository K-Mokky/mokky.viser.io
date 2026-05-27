import test from "node:test";
import assert from "node:assert/strict";
import { liveLaunchReadinessOptions, providerProofLaunchReadinessOptions, readinessOptionsFromFlags } from "../src/cli/readiness-options.ts";

test("readinessOptionsFromFlags keeps ordinary checks opt-in", () => {
  assert.deepEqual(readinessOptionsFromFlags({}), {
    live: false,
    probeProviders: false,
    probeAllProviders: false
  });
});

test("liveLaunchReadinessOptions always validates configured connector tokens", () => {
  assert.deepEqual(liveLaunchReadinessOptions({}), {
    live: true,
    probeProviders: false,
    probeAllProviders: false
  });
});

test("providerProofLaunchReadinessOptions includes both live token and provider proofs", () => {
  assert.deepEqual(providerProofLaunchReadinessOptions({ probe: true }), {
    live: true,
    probeProviders: true,
    probeAllProviders: true
  });
});
