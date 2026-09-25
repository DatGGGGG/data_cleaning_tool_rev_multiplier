import assert from "node:assert/strict";
import test from "node:test";
import {
  findBottomUpMultiplierConflicts,
  resolveBottomUpRevenueMultipliers,
} from "../lib/bottom-up/workbench.ts";

function row(id, publisherId, multiplier) {
  return {
    id,
    ordinal: 1,
    cleanedPublisherName: "Garena",
    publisherId,
    publisherName: publisherId,
    revenueMultiplier: multiplier,
    reviewStatus: "seeded",
    notes: "",
    adder: "",
    addingDate: "",
  };
}

test("Publisher Management multiplier is applied before Bottom Up snapshots and exports", () => {
  const resolution = resolveBottomUpRevenueMultipliers(
    [row("one", "publisher-a", "15"), row("two", "publisher-b", "1")],
    new Map([["garena", "15"]]),
  );
  assert.deepEqual(resolution.rows.map((item) => item.revenueMultiplier), ["15", "15"]);
  assert.deepEqual(resolution.corrections, [{
    rowId: "two",
    cleanedPublisherName: "Garena",
    previousMultiplier: "1",
    resolvedMultiplier: "15",
  }]);
  assert.deepEqual(findBottomUpMultiplierConflicts(resolution.rows), []);
});

test("a remaining conflicting cleaned publisher and publisher ID is detected", () => {
  const conflicts = findBottomUpMultiplierConflicts([
    row("one", "publisher-a", "15"),
    row("two", "publisher-a", "1"),
  ]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].multipliers, ["1", "15"]);
});
