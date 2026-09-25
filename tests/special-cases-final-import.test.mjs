import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalFinalImportError, parseHistoricalFinalCsv } from "../lib/special-cases/final-import.ts";

test("historical final import preserves blank cleaned publishers", () => {
  const parsed = parseHistoricalFinalCsv("app_id,cleaned_publisher_name,revenue_multiplier\nold,,1\nnew,VNG,15\n");
  assert.equal(parsed.inputRowCount, 2);
  assert.deepEqual(parsed.rows, [
    { appId: "new", cleanedPublisherName: "VNG", revenueMultiplier: "15" },
    { appId: "old", cleanedPublisherName: "", revenueMultiplier: "1" },
  ]);
});

test("historical final import rejects duplicate IDs and invalid multipliers", () => {
  assert.throws(() => parseHistoricalFinalCsv("app_id,cleaned_publisher_name,revenue_multiplier\na,,1\na,VNG,2\n"), HistoricalFinalImportError);
  assert.throws(() => parseHistoricalFinalCsv("app_id,cleaned_publisher_name,revenue_multiplier\na,,0\n"), HistoricalFinalImportError);
});
