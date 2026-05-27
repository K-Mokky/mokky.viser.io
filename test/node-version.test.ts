import test from "node:test";
import assert from "node:assert/strict";
import { isNodeVersionSupported, nodeVersionLabel, parseNodeVersion } from "../src/utils/node-version.ts";

test("parseNodeVersion accepts Node-style versions", () => {
  assert.deepEqual(parseNodeVersion("v22.6.0"), { major: 22, minor: 6, patch: 0 });
  assert.deepEqual(parseNodeVersion("25.9.0"), { major: 25, minor: 9, patch: 0 });
  assert.equal(parseNodeVersion("not-node"), undefined);
});

test("isNodeVersionSupported enforces the native TypeScript runtime floor", () => {
  assert.equal(isNodeVersionSupported("v22.5.9"), false);
  assert.equal(isNodeVersionSupported("v22.6.0"), true);
  assert.equal(isNodeVersionSupported("v23.0.0"), true);
});

test("nodeVersionLabel explains the minimum runtime", () => {
  assert.match(nodeVersionLabel("v22.5.9"), /unsupported; requires >= 22\.6\.0/);
  assert.match(nodeVersionLabel("v22.6.0"), /ok; requires >= 22\.6\.0/);
});
