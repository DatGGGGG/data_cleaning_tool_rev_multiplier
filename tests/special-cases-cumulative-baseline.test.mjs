import assert from "node:assert/strict";
import test from "node:test";
import { cumulativeBaselineRows } from "../lib/special-cases/workbench.ts";

const row = (appId, name, publisherName = "Publisher") => ({ appId, name, url: "", publisherId: "publisher", publisherName, cleanedPublisherName: "VNG", revenueMultiplier: "15" });

test("cumulative baseline retains baseline-only apps and lets current metadata win", () => {
  const result = cumulativeBaselineRows(
    [row("app-a", "Old A"), row("app-d", "Baseline-only D")],
    [row("app-a", "Current A"), row("app-b", "Current-only B")],
  );
  assert.equal(result.addedAppCount, 1);
  assert.equal(result.overlappingAppCount, 1);
  assert.deepEqual(result.rows.map((item) => item.appId), ["app-a", "app-b", "app-d"]);
  assert.equal(result.rows.find((item) => item.appId === "app-a")?.name, "Current A");
});
