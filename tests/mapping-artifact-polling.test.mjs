import assert from "node:assert/strict";
import test from "node:test";

test("enrichment polling uses the active-job cadence and bounded reconnect backoff", async () => {
  const { enrichmentPollDelay, isActiveEnrichmentStatus } = await import("../lib/mapping-artifacts/polling.ts");
  assert.equal(isActiveEnrichmentStatus("queued"), true);
  assert.equal(isActiveEnrichmentStatus("running"), true);
  assert.equal(isActiveEnrichmentStatus("success"), false);
  assert.equal(enrichmentPollDelay("queued"), 2_000);
  assert.equal(enrichmentPollDelay("running"), 5_000);
  assert.equal(enrichmentPollDelay("running", 1), 5_000);
  assert.equal(enrichmentPollDelay("running", 2), 10_000);
  assert.equal(enrichmentPollDelay("running", 3), 15_000);
  assert.equal(enrichmentPollDelay("running", 8), 15_000);
  assert.equal(enrichmentPollDelay("success"), null);
  assert.equal(enrichmentPollDelay("failed"), null);
});

test("enrichment progress labels describe real status without inventing a percentage", async () => {
  const { enrichmentProgressLabel } = await import("../lib/mapping-artifacts/polling.ts");
  assert.match(enrichmentProgressLabel("queued"), /Queued/);
  assert.match(enrichmentProgressLabel("running"), /Running/);
  assert.match(enrichmentProgressLabel("running", 1), /Reconnecting automatically/);
  assert.equal(enrichmentProgressLabel("success"), "Completed.");
});
