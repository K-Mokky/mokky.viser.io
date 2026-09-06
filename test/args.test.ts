import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, flagString } from "../src/cli/args.ts";

test("parseArgs extracts command, flags, and positionals", () => {
  const parsed = parseArgs(["ask", "--provider", "gemini", "hello", "world"]);
  assert.equal(parsed.command, "ask");
  assert.equal(flagString(parsed.flags, "provider"), "gemini");
  assert.deepEqual(parsed.positionals, ["hello", "world"]);
});

test("parseArgs defaults to the foreground gateway runtime", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, "gateway");
});
