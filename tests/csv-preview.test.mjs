import assert from "node:assert/strict";
import test from "node:test";

test("CSV artifact preview preserves quoted commas, quotes, line breaks, and a UTF-8 BOM", async () => {
  const { parseCsvPreview } = await import("../lib/csv-preview.ts");
  const parsed = parseCsvPreview("\uFEFFpublisher_name,notes\r\n\"ACME, Inc.\",\"Line one\nLine \"\"two\"\"\"\r\n");
  assert.deepEqual(parsed.columns, ["publisher_name", "notes"]);
  assert.deepEqual(parsed.rows, [["ACME, Inc.", "Line one\nLine \"two\""]]);
});
