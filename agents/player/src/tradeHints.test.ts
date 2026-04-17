import assert from "node:assert/strict";
import { test } from "node:test";

import { computeRebalanceTradeDraft } from "./tradeHints.js";

test("no draft without peers", () => {
  const r = { food: 100, wood: 5, stone: 5, ore: 5, energy: 50 };
  assert.equal(computeRebalanceTradeDraft(r, false, true), null);
});

test("draft when skewed and peers exist", () => {
  const r = { food: 80, wood: 8, stone: 10, ore: 12, energy: 50 };
  const d = computeRebalanceTradeDraft(r, true, true);
  assert.ok(d);
  assert.equal(d!.surplus, "food");
  assert.ok(d!.offer.food > 0);
  assert.ok(d!.request.wood > 0 || d!.request.stone > 0 || d!.request.ore > 0 || d!.request.food > 0);
});

test("no draft when spread too small", () => {
  const r = { food: 28, wood: 22, stone: 24, ore: 20, energy: 50 };
  assert.equal(computeRebalanceTradeDraft(r, true, true), null);
});
