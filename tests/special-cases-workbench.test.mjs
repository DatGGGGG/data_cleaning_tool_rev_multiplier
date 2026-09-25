import assert from "node:assert/strict";
import test from "node:test";
import { adjustmentRows, buildFinalCsv, investigationRows } from "../lib/special-cases/workbench.ts";

const base = { appId: "app-1", name: "Example", url: "", publisherId: "pub-1", publisherName: "Suspicious", cleanedPublisherName: "VNG", revenueMultiplier: "15" };

test("Special Cases investigation only includes publishers explicitly marked suspected", () => {
  const rows = investigationRows([base, { ...base, appId: "app-2", publisherName: "Normal" }], new Set(), { Suspicious: { publisherName: "Suspicious", isSuspected: true, isChecked: false, notes: "", updatedAt: "", updatedBy: "" } }, {});
  assert.deepEqual(rows.map((row) => row.appId), ["app-1"]);
});

test("clear publisher is explicit and serializes as a blank cleaned publisher", () => {
  const result = adjustmentRows([{ ...base, isNewApp: false, isSuspected: true, isChecked: true, needReadjustment: true, adjustmentMode: "clear", adjustedCleanedPublisherName: "", adjustedRevenueMultiplier: "1", notes: "" }]);
  assert.deepEqual(result.errors, []);
  assert.equal(buildFinalCsv(result.rows), "app_id,cleaned_publisher_name,revenue_multiplier\napp-1,,1\n");
});

test("set publisher requires a nonblank publisher and positive multiplier", () => {
  const result = adjustmentRows([{ ...base, isNewApp: false, isSuspected: true, isChecked: true, needReadjustment: true, adjustmentMode: "set", adjustedCleanedPublisherName: "", adjustedRevenueMultiplier: "0", notes: "" }]);
  assert.equal(result.errors.length, 2);
});
