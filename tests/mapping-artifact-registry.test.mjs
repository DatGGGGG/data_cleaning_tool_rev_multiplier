import assert from "node:assert/strict";
import test from "node:test";

const rawId = "10000000-0000-4000-8000-000000000001";
const enrichedId = "20000000-0000-4000-8000-000000000002";
const bottomUpId = "30000000-0000-4000-8000-000000000003";
const fullId = "40000000-0000-4000-8000-000000000004";
const specialCasesId = "60000000-0000-4000-8000-000000000006";

function artifact(overrides = {}) {
  return {
    id: fullId,
    artifact_type: "full",
    status: "committed",
    canonical_filename: "st_mapping_publisher_to_publisherids_revenue_multiplier_full_20260922.csv",
    relative_path: "data/staging/private/full.csv",
    schema_version: 1,
    row_count: 42,
    checksum_sha256: "full-checksum-1234567890",
    created_at: "2026-09-22T01:00:00.000Z",
    created_by: "Creator Person",
    committed_at: "2026-09-22T04:00:00.000Z",
    committed_by: "Committer Person",
    source_workbench_workflow: "full_mapping",
    source_workbench_version_id: "workbench-version-full",
    source_workbench_version_label: "Full review version",
    source_artifact_ids: [enrichedId, bottomUpId],
    source_artifact_checksums: { [enrichedId]: "enriched-checksum", [bottomUpId]: "bottom-up-checksum" },
    validation: { required_columns: ["cleaned_publisher_name"], missing_value_counts: {}, duplicate_row_count: 0, conflicting_key_count: 0, unresolved_publisher_id_count: 0, valid: true, blocking_errors: [] },
    generator_version: "pipeline-v1",
    repository_git_sha: "1234567890abcdef",
    bootstrap_import: false,
    ...overrides,
  };
}

test("registry includes all committed artifact types, excludes drafts, and sorts newest first", async () => {
  const { artifactCounts, committedArtifacts, filterCommittedArtifacts } = await import("../lib/mapping-artifacts/catalog.ts");
  const raw = artifact({ id: rawId, artifact_type: "top_down_raw", committed_at: "2026-09-22T01:00:00.000Z" });
  const enriched = artifact({ id: enrichedId, artifact_type: "top_down_with_publisher_ids", committed_at: "2026-09-22T02:00:00.000Z" });
  const bottomUp = artifact({ id: bottomUpId, artifact_type: "bottom_up", committed_at: "2026-09-22T03:00:00.000Z" });
  const full = artifact();
  const specialCases = artifact({
    id: specialCasesId,
    artifact_type: "special_cases",
    source_workbench_workflow: "special_cases",
    committed_at: "2026-09-22T05:00:00.000Z",
  });
  const draft = artifact({ id: "50000000-0000-4000-8000-000000000005", status: "draft", committed_at: null, created_at: "2026-09-22T05:00:00.000Z" });
  const catalog = [draft, raw, full, enriched, bottomUp, specialCases];

  assert.deepEqual(committedArtifacts(catalog).map((item) => item.id), [specialCasesId, fullId, bottomUpId, enrichedId, rawId]);
  assert.deepEqual(artifactCounts(catalog), {
    top_down_raw: 1,
    top_down_with_publisher_ids: 1,
    bottom_up: 1,
    full: 1,
    special_cases: 1,
  });
  assert.deepEqual(filterCommittedArtifacts(catalog, { type: "bottom_up" }).map((item) => item.id), [bottomUpId]);
});

test("registry search covers immutable metadata and recorded lineage without returning drafts", async () => {
  const { filterCommittedArtifacts } = await import("../lib/mapping-artifacts/catalog.ts");
  const committed = artifact({ source_artifact_ids: ["lineage-artifact-id"], source_artifact_checksums: { "lineage-artifact-id": "lineage-checksum" } });
  const draft = artifact({ id: "draft-item", status: "draft", canonical_filename: "draft-search-only.csv", committed_at: null });
  const catalog = [committed, draft];

  for (const term of ["full review", "creator person", "lineage-artifact-id", "lineage-checksum", "full-checksum"]) {
    assert.deepEqual(filterCommittedArtifacts(catalog, { search: term }).map((item) => item.id), [fullId]);
  }
  assert.equal(filterCommittedArtifacts(catalog, { search: "draft-search-only" }).length, 0);
});

test("registry resolves catalog lineage and safely retains recorded lineage unavailable in the catalog", async () => {
  const { resolveArtifactLineage } = await import("../lib/mapping-artifacts/catalog.ts");
  const full = artifact();
  const enriched = artifact({ id: enrichedId, artifact_type: "top_down_with_publisher_ids", checksum_sha256: "enriched-checksum" });
  const bottomUp = artifact({ id: bottomUpId, artifact_type: "bottom_up", checksum_sha256: "bottom-up-checksum" });

  const linked = resolveArtifactLineage(full, [full, enriched, bottomUp]);
  assert.equal(linked[0].artifact?.id, enrichedId);
  assert.equal(linked[1].artifact?.id, bottomUpId);

  const unavailable = resolveArtifactLineage(full, [full]);
  assert.equal(unavailable[0].artifact, null);
  assert.equal(unavailable[0].checksum, "enriched-checksum");
});

test("only an admin can activate a non-active committed Full Mapping", async () => {
  const { canActivateCommittedFull, isActiveFullArtifact } = await import("../lib/mapping-artifacts/catalog.ts");
  const active = artifact({ id: "active-full" });
  const candidate = artifact();
  const activeEntry = { artifact: active, activated_at: "2026-09-22T05:00:00.000Z", activated_by: "Admin" };

  assert.equal(isActiveFullArtifact(active.id, activeEntry), true);
  assert.equal(isActiveFullArtifact(candidate.id, activeEntry), false);
  assert.equal(canActivateCommittedFull(candidate, activeEntry, false), false);
  assert.equal(canActivateCommittedFull(artifact({ artifact_type: "bottom_up" }), activeEntry, true), false);
  assert.equal(canActivateCommittedFull(artifact({ status: "draft", committed_at: null }), activeEntry, true), false);
  assert.equal(canActivateCommittedFull(active, activeEntry, true), false);
  assert.equal(canActivateCommittedFull(candidate, activeEntry, true), true);
});

test("registry metadata deliberately omits internal storage paths", async () => {
  const { publicArtifactDetails } = await import("../lib/mapping-artifacts/catalog.ts");
  const details = publicArtifactDetails(artifact());
  assert.equal("relative_path" in details, false);
  assert.equal("relativePath" in details, false);
  assert.equal(JSON.stringify(details).includes("data/staging/private/full.csv"), false);
  assert.equal(details.canonicalFilename.includes("st_mapping"), true);
  assert.equal(details.checksum, "full-checksum-1234567890");
});
