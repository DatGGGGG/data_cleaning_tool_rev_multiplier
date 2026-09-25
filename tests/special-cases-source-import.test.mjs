import assert from "node:assert/strict";
import test from "node:test";
import { HistoricalBaselineImportError, parseHistoricalBaselineCsv } from "../lib/special-cases/source-import.ts";

const header = "app_id,name,url,publisher_id,publisher_name,cleaned_publisher_name,revenue_multiplier";

test("historical baseline import normalizes headers, quotes, and duplicate app IDs", () => {
  const result = parseHistoricalBaselineCsv(`\uFEFF${header}\napp-2,"Game, Two",https://example.test/2,pub-2,Publisher Two,VNG,15\napp-1,Game One,https://example.test/1,pub-1,Publisher One,VNG,3\napp-2,Later duplicate,https://example.test/other,pub-2,Publisher Two,VNG,15\n`);
  assert.equal(result.inputRowCount, 3);
  assert.equal(result.uniqueAppCount, 2);
  assert.equal(result.duplicateAppIdCount, 1);
  assert.deepEqual(result.rows.map((row) => row.appId), ["app-1", "app-2"]);
  assert.equal(result.rows[1].name, "Game, Two");
});

test("historical baseline import rejects incomplete schemas and blank app IDs", () => {
  assert.throws(() => parseHistoricalBaselineCsv("app_id,name\na,Game\n"), HistoricalBaselineImportError);
  assert.throws(() => parseHistoricalBaselineCsv(`${header}\n,Game,,,,,\n`), /missing app_id/);
});
