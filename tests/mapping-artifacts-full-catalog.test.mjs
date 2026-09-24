import assert from "node:assert/strict";
import test from "node:test";

const fullId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const olderFullId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const topDownId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const bottomUpId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function artifact(overrides = {}) {
  return {
    id: fullId,
    artifact_type: "full",
    status: "committed",
    canonical_filename: "full.csv",
    relative_path: "data/staging/full.csv",
    schema_version: 1,
    row_count: 42,
    checksum_sha256: "full-checksum",
    created_at: "2026-09-22T01:00:00.000Z",
    created_by: "Creator",
    committed_at: "2026-09-22T02:00:00.000Z",
    committed_by: "Committer",
    source_workbench_workflow: null,
    source_workbench_version_id: null,
    source_workbench_version_label: null,
    source_artifact_ids: [topDownId, bottomUpId],
    source_artifact_checksums: { [topDownId]: "top-checksum", [bottomUpId]: "bottom-checksum" },
    validation: { required_columns: [], missing_value_counts: {}, duplicate_row_count: 0, conflicting_key_count: 0, unresolved_publisher_id_count: 0, valid: true, blocking_errors: [] },
    generator_version: "pipeline-v1",
    repository_git_sha: "1234567890abcdef",
    bootstrap_import: false,
    ...overrides,
  };
}

test("committed Full Mapping catalog filters, orders, and marks the true active artifact", async () => {
  const { activeFullEntry, committedFullArtifacts, isActiveFullArtifact } = await import("../lib/mapping-artifacts/full-catalog.ts");
  const newest = artifact();
  const older = artifact({ id: olderFullId, committed_at: "2026-09-20T02:00:00.000Z" });
  const draft = artifact({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", status: "draft", committed_at: null });
  const other = artifact({ id: topDownId, artifact_type: "top_down_with_publisher_ids" });
  const catalog = committedFullArtifacts([older, draft, other, newest]);
  assert.deepEqual(catalog.map((item) => item.id), [fullId, olderFullId]);

  const active = activeFullEntry({ full: { artifact: older, activated_at: "2026-09-22T03:00:00.000Z", activated_by: "Admin" } });
  assert.equal(isActiveFullArtifact(olderFullId, active), true);
  assert.equal(isActiveFullArtifact(fullId, active), false);
});

test("Full Mapping lineage resolves catalog artifacts by type and falls back to recorded IDs", async () => {
  const { resolveFullMappingLineage } = await import("../lib/mapping-artifacts/full-catalog.ts");
  const full = artifact();
  const topDown = artifact({ id: topDownId, artifact_type: "top_down_with_publisher_ids", row_count: 7, checksum_sha256: "top-checksum" });
  const bottomUp = artifact({ id: bottomUpId, artifact_type: "bottom_up", row_count: 9, checksum_sha256: "bottom-checksum" });
  const resolved = resolveFullMappingLineage(full, [full, bottomUp, topDown]);
  assert.equal(resolved.enrichedTopDown.artifact?.id, topDownId);
  assert.equal(resolved.bottomUp.artifact?.id, bottomUpId);

  const fallback = resolveFullMappingLineage(full, [full]);
  assert.equal(fallback.enrichedTopDown.artifact, null);
  assert.equal(fallback.enrichedTopDown.id, topDownId);
  assert.equal(fallback.enrichedTopDown.checksum, "top-checksum");
  assert.equal(fallback.bottomUp.artifact, null);
  assert.equal(fallback.bottomUp.id, bottomUpId);
  assert.equal(fallback.bottomUp.checksum, "bottom-checksum");
});

test("pipeline activation response preserves its active pointer shape and an activation failure retains displayed state", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.SENSORTOWER_PIPELINE_API_BASE_URL;
  const originalToken = process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN;
  try {
    process.env.SENSORTOWER_PIPELINE_API_BASE_URL = "http://host.docker.internal:8010";
    process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN = "server-only-pipeline-token";
    const active = { full: { artifact: artifact(), activated_at: "2026-09-22T03:00:00.000Z", activated_by: "Admin" } };
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), `http://host.docker.internal:8010/mapping-artifacts/${fullId}/activate`);
      assert.equal(init?.headers?.Authorization, "Bearer server-only-pipeline-token");
      assert.deepEqual(JSON.parse(init?.body), { activated_by: "Admin" });
      return Response.json({ status: "activated", active });
    };
    const { activateRemoteFullArtifact } = await import("../lib/mapping-artifacts/client.ts");
    const response = await activateRemoteFullArtifact(fullId, "Admin");
    assert.equal(response.status, "activated");
    assert.equal(response.active.full?.artifact.id, fullId);

    const { activeStateAfterFailedActivation } = await import("../lib/mapping-artifacts/full-catalog.ts");
    assert.strictEqual(activeStateAfterFailedActivation(active), active);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.SENSORTOWER_PIPELINE_API_BASE_URL;
    else process.env.SENSORTOWER_PIPELINE_API_BASE_URL = originalBaseUrl;
    if (originalToken === undefined) delete process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN;
    else process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN = originalToken;
  }
});

test("saved versions are marked published only when workflow, version, type, and checksum match", async () => {
  const { publishedSavedVersion } = await import("../lib/mapping-artifacts/catalog.ts");
  const topDown = artifact({
    id: topDownId,
    artifact_type: "top_down_raw",
    checksum_sha256: "top-checksum",
    source_workbench_workflow: "top_down",
    source_workbench_version_id: "top-version-1",
  });
  assert.equal(
    publishedSavedVersion("top_down", "top-version-1", "top-checksum", [topDown])?.artifactId,
    topDownId,
  );
  assert.equal(publishedSavedVersion("top_down", "top-version-1", "changed", [topDown]), null);
  assert.equal(publishedSavedVersion("bottom_up", "top-version-1", "top-checksum", [topDown]), null);

  const receipt = {
    workflow: "bottom_up",
    localVersionId: "bottom-version-1",
    localVersionLabel: "Bottom snapshot",
    localChecksumSha256: "bottom-checksum",
    remoteArtifactId: bottomUpId,
    remoteArtifactType: "bottom_up",
    remoteStatus: "committed",
    publishedAt: "2026-09-24T10:00:00.000Z",
    publishedBy: "Operator",
  };
  assert.equal(
    publishedSavedVersion("bottom_up", "bottom-version-1", "bottom-checksum", [], [receipt])?.artifactId,
    bottomUpId,
  );
  assert.equal(publishedSavedVersion("bottom_up", "bottom-version-1", "wrong-checksum", [], [receipt]), null);
});
