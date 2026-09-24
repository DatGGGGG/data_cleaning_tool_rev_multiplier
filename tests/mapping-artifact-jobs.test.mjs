import assert from "node:assert/strict";
import test from "node:test";

const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const createdAt = "2026-09-22T00:00:00.000Z";

test("enrichment start response accepts both compact and nested pipeline contracts", async () => {
  const { normalizeStartedEnrichmentResponse } = await import("../lib/mapping-artifacts/job-contract.ts");
  assert.deepEqual(normalizeStartedEnrichmentResponse({ job_id: jobId, status: "queued" }), {
    job_id: jobId,
    status: "queued",
  });
  assert.deepEqual(normalizeStartedEnrichmentResponse({ job: { id: jobId, status: "running" } }), {
    job_id: jobId,
    status: "running",
  });
  assert.deepEqual(normalizeStartedEnrichmentResponse({ id: jobId, status: "queued" }), {
    job_id: jobId,
    status: "queued",
  });
  assert.equal(normalizeStartedEnrichmentResponse({ status: "queued" }), null);
  assert.equal(normalizeStartedEnrichmentResponse({ job_id: jobId, status: "unknown" }), null);
});

test("enrichment status response accepts nested or direct jobs and rejects malformed jobs", async () => {
  const { normalizeArtifactJobResponse } = await import("../lib/mapping-artifacts/job-contract.ts");
  const nested = normalizeArtifactJobResponse({
    job: {
      id: jobId,
      job_type: "top_down_publisher_ids",
      status: "success",
      result_artifact_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      created_at: createdAt,
    },
  });
  assert.equal(nested?.job.id, jobId);
  assert.equal(nested?.job.status, "success");
  assert.equal(nested?.job.result_artifact_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

  const direct = normalizeArtifactJobResponse({ id: jobId, status: "running", created_at: createdAt });
  assert.equal(direct?.job.id, jobId);
  assert.equal(direct?.job.job_type, "top_down_publisher_ids");
  assert.equal(direct?.job.result_artifact_id, null);
  assert.equal(normalizeArtifactJobResponse({ job: { status: "running", created_at: createdAt } }), null);
});

test("enrichment contract rejects unknown statuses, invalid timestamps, and incomplete success jobs", async () => {
  const { normalizeArtifactJobResponse } = await import("../lib/mapping-artifacts/job-contract.ts");
  assert.equal(normalizeArtifactJobResponse({ id: jobId, status: "unknown", created_at: createdAt }), null);
  assert.equal(normalizeArtifactJobResponse({ id: jobId, status: "running", created_at: "not-a-timestamp" }), null);
  assert.equal(normalizeArtifactJobResponse({ id: jobId, status: "running", created_at: createdAt, started_at: "not-a-timestamp" }), null);
  assert.equal(normalizeArtifactJobResponse({ id: jobId, status: "success", created_at: createdAt }), null);
});
