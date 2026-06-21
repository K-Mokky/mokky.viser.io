import test from "node:test";
import assert from "node:assert/strict";
import { ProviderThrottle } from "../src/core/provider-throttle.ts";

test("ProviderThrottle is disabled when no interval is configured", () => {
  for (const value of [undefined, 0, -100]) {
    const throttle = new ProviderThrottle(value, { now: () => 1000 });
    assert.equal(throttle.enabled, false);
    assert.equal(throttle.reserve(), 0);
    assert.equal(throttle.reserve(), 0);
  }
});

test("ProviderThrottle spaces back-to-back calls by the configured interval", () => {
  let clock = 10_000;
  const throttle = new ProviderThrottle(2_000, { now: () => clock });

  assert.equal(throttle.enabled, true);
  assert.equal(throttle.reserve(), 0); // first call never waits
  assert.equal(throttle.reserve(), 2_000); // queued one interval out
  assert.equal(throttle.reserve(), 4_000); // queued two intervals out
});

test("ProviderThrottle does not wait once enough time has elapsed", () => {
  let clock = 0;
  const throttle = new ProviderThrottle(1_000, { now: () => clock });

  assert.equal(throttle.reserve(), 0);
  clock = 1_000; // a full interval later
  assert.equal(throttle.reserve(), 0);
  clock = 1_200; // less than an interval later
  assert.equal(throttle.reserve(), 800);
});
