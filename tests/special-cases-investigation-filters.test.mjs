import assert from "node:assert/strict";
import test from "node:test";
import {
  filterInvestigationRows,
  investigationRowMatchesFilters,
  sortInvestigationRows,
  validateInvestigationFilters,
} from "../lib/special-cases/investigation-filters.ts";

const row = (overrides = {}) => ({
  appId: "app-1", name: "Royal Belote", url: "https://example.test/app-1",
  publisherId: "publisher-1", publisherName: "Azur Interactive Games Limited",
  cleanedPublisherName: "VTC", revenueMultiplier: "3", isNewApp: true,
  isNewSpecialCase: true, isHistoricalFinal: false, historicalCleanedPublisherName: "",
  historicalRevenueMultiplier: "", isSuspected: true, isChecked: false,
  needReadjustment: true, adjustmentMode: "set", adjustedCleanedPublisherName: "VTC",
  adjustedRevenueMultiplier: "1", notes: "Needs review", ...overrides,
});

test("investigation filters combine text, numeric, and status rules with AND", () => {
  const filters = validateInvestigationFilters([
    { id: "publisher", field: "publisherName", operator: "contains", value: "azur" },
    { id: "multiplier", field: "revenueMultiplier", operator: "greater_than", value: "2" },
    { id: "new", field: "isNewSpecialCase", operator: "is", value: "true" },
  ]);
  assert.equal(investigationRowMatchesFilters(row(), filters), true);
  assert.equal(investigationRowMatchesFilters(row({ isNewSpecialCase: false }), filters), false);
});

test("blank and incomplete filters use the derived final-review state", () => {
  const incomplete = row({ adjustmentMode: "set", adjustedCleanedPublisherName: "" });
  const complete = row({ adjustmentMode: "clear" });
  const filters = validateInvestigationFilters([{ id: "incomplete", field: "incomplete", operator: "is", value: "true" }]);
  assert.deepEqual(filterInvestigationRows([incomplete, complete], filters).map((item) => item.appId), ["app-1"]);
  const blank = validateInvestigationFilters([{ id: "blank", field: "adjustedCleanedPublisherName", operator: "is_blank" }]);
  assert.equal(investigationRowMatchesFilters(incomplete, blank), true);
});

test("invalid fields, operators, and excessive rules are rejected", () => {
  assert.throws(() => validateInvestigationFilters([{ id: "bad", field: "__proto__", operator: "contains", value: "x" }]));
  assert.throws(() => validateInvestigationFilters([{ id: "bad", field: "publisherName", operator: "greater_than", value: "2" }]));
  assert.throws(() => validateInvestigationFilters(Array.from({ length: 11 }, (_, index) => ({ id: String(index), field: "appId", operator: "contains", value: "x" }))));
});

test("sorting is numeric when possible and ties by app ID", () => {
  const sorted = sortInvestigationRows([
    row({ appId: "b", revenueMultiplier: "15" }),
    row({ appId: "a", revenueMultiplier: "3" }),
    row({ appId: "c", revenueMultiplier: "3" }),
  ], "revenueMultiplier", "asc");
  assert.deepEqual(sorted.map((item) => item.appId), ["a", "c", "b"]);
});
