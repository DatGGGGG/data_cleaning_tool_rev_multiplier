import assert from "node:assert/strict";
import test from "node:test";
import { adjustmentRows, buildFinalCsv, finalWorkingRows, investigationRows } from "../lib/special-cases/workbench.ts";

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

test("a blank final multiplier is retained as an explicit no-override value", () => {
  const result = adjustmentRows([{ ...base, isNewApp: false, isSuspected: true, isChecked: true, needReadjustment: true, adjustmentMode: "set", adjustedCleanedPublisherName: "VNG", adjustedRevenueMultiplier: "", notes: "" }]);
  assert.deepEqual(result.errors, []);
  assert.equal(buildFinalCsv(result.rows), "app_id,cleaned_publisher_name,revenue_multiplier\napp-1,VNG,\n");
});

test("historical final rows remain editable while new Special Cases start excluded", () => {
  const rows = finalWorkingRows(
    [{ ...base, appId: "old" }, { ...base, appId: "new" }],
    new Set(),
    { Suspicious: { publisherName: "Suspicious", isSuspected: true, isChecked: true, notes: "", updatedAt: "", updatedBy: "" } },
    {},
    [{ appId: "old", cleanedPublisherName: "", revenueMultiplier: "1" }, { appId: "not-in-current", cleanedPublisherName: "VNG", revenueMultiplier: "15" }],
  );
  assert.equal(rows.find((row) => row.appId === "old")?.needReadjustment, true);
  assert.equal(rows.find((row) => row.appId === "old")?.adjustmentMode, "clear");
  assert.equal(rows.find((row) => row.appId === "not-in-current")?.needReadjustment, true);
  assert.equal(rows.find((row) => row.appId === "new")?.isNewSpecialCase, true);
  assert.equal(rows.find((row) => row.appId === "new")?.needReadjustment, false);
});
