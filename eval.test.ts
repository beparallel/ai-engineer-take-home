import assert from "node:assert/strict";
import test from "node:test";

import { codeOverlap, formatOverlap, meanOverlap } from "./eval.js";

test("scores partial overlap as the shared share of the union", () => {
  assert.equal(codeOverlap(["N20.1", "E43"], ["N20.1", "N17.9"]), 1 / 3);
  assert.equal(codeOverlap(["E44.0", "J18.9"], ["E44.0"]), 0.5);
});

test("ignores code order and duplicates", () => {
  assert.equal(codeOverlap(["E11.98", "J20.9"], ["J20.9", "E11.98"]), 1);
  assert.equal(codeOverlap(["E44.0", "E44.0"], ["E44.0"]), 1);
});

test("scores disjoint code lists as zero", () => {
  assert.equal(codeOverlap(["I50.19", "J96.0"], ["I50.09"]), 0);
  assert.equal(codeOverlap([], ["E44.0"]), 0);
  assert.equal(codeOverlap(["E44.0"], []), 0);
});

test("scores identical code lists as one", () => {
  assert.equal(codeOverlap(["N20.1", "N17.9"], ["N17.9", "N20.1"]), 1);
});

test("treats an empty union as a perfect overlap", () => {
  assert.equal(codeOverlap([], []), 1);
});

test("averages per-stay overlaps with equal weight per stay", () => {
  assert.equal(meanOverlap([1 / 3, 0.2, 0.5, 0]), (1 / 3 + 0.2 + 0.5 + 0) / 4);
  assert.equal(formatOverlap(meanOverlap([1 / 3, 0.2, 0.5, 0])), "0.26");
  assert.equal(meanOverlap([1, 0]), 0.5);
  assert.equal(meanOverlap([0.25]), 0.25);
  assert.equal(meanOverlap([]), 0);
});

test("weights a one-code stay and a many-code stay equally", () => {
  const manyCodes = codeOverlap(["A41.9", "E11.98", "J13", "N20.1"], ["J20.9", "E11.98"]);
  const oneCode = codeOverlap(["E44.0"], ["E44.0"]);

  assert.equal(formatOverlap(meanOverlap([manyCodes, oneCode])), "0.60");
});

test("formats overlaps with two decimals", () => {
  assert.equal(formatOverlap(1 / 3), "0.33");
  assert.equal(formatOverlap(0), "0.00");
  assert.equal(formatOverlap(1), "1.00");
});
