import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSpecialCasePublisherGroups,
  sortSpecialCasePublisherGroups,
} from "../lib/special-cases/publisher-groups.ts";

const groups = [
  { publisherName: "VNG ZingPlay Studio", cleanedPublisherName: "VNG", revenueMultiplier: "15", appCount: 71, newAppCount: 8, isSuspected: true, isChecked: false, notes: "Check licensing" },
  { publisherName: "VTC Mobile", cleanedPublisherName: "VTC", revenueMultiplier: "3", appCount: 44, newAppCount: 0, isSuspected: false, isChecked: true, notes: "Known account" },
  { publisherName: "Unknown Games", cleanedPublisherName: "", revenueMultiplier: "1", appCount: 2, newAppCount: 2, isSuspected: false, isChecked: false, notes: "Investigate source" },
];

const allFilters = {
  search: "",
  cleanedPublisherName: "",
  revenueMultiplier: "",
  suspected: "all",
  checked: "all",
  newApps: "all",
};

test("publisher review search applies every search term across names and notes", () => {
  const results = filterSpecialCasePublisherGroups(groups, { ...allFilters, search: "vng licensing" });
  assert.deepEqual(results.map((item) => item.publisherName), ["VNG ZingPlay Studio"]);
});

test("publisher review filters combine review state and new-app conditions", () => {
  const results = filterSpecialCasePublisherGroups(groups, { ...allFilters, suspected: "no", checked: "no", newApps: "has_new" });
  assert.deepEqual(results.map((item) => item.publisherName), ["Unknown Games"]);
});

test("publisher review sorts numeric multiplier values without mutating source rows", () => {
  const original = groups.map((item) => item.publisherName);
  const ascending = sortSpecialCasePublisherGroups(groups, "revenueMultiplier", "asc");
  const descending = sortSpecialCasePublisherGroups(groups, "appCount", "desc");
  assert.deepEqual(ascending.map((item) => item.revenueMultiplier), ["1", "3", "15"]);
  assert.deepEqual(descending.map((item) => item.publisherName), ["VNG ZingPlay Studio", "VTC Mobile", "Unknown Games"]);
  assert.deepEqual(groups.map((item) => item.publisherName), original);
});
