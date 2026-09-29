import assert from "node:assert/strict";
import test from "node:test";

const version = {
  id: "local-special-cases-version",
  checksum: "special-cases-checksum",
};

function artifact(overrides = {}) {
  return {
    id: "special-cases-artifact",
    artifact_type: "special_cases",
    status: "draft",
    row_count: 3,
    checksum_sha256: "special-cases-checksum",
    source_workbench_workflow: "special_cases",
    source_workbench_version_id: "local-special-cases-version",
    source_artifact_ids: ["full-artifact"],
    validation: { valid: true, blocking_errors: [] },
    ...overrides,
  };
}

test("a local Special Cases final version reconnects by immutable source version even when SensorTower canonicalizes its checksum", async () => {
  const { findArtifactForSpecialCasesVersion } = await import("../lib/mapping-artifacts/special-cases-artifacts.ts");
  const published = artifact();
  assert.equal(findArtifactForSpecialCasesVersion(version, [published])?.id, published.id);
  assert.equal(findArtifactForSpecialCasesVersion(version, [artifact({ checksum_sha256: "canonical-checksum-different-from-local" })])?.id, "special-cases-artifact");
  assert.equal(findArtifactForSpecialCasesVersion(version, [artifact({ source_workbench_workflow: "top_down" })]), null);
});

test("Special Cases activation remains independent of the Full Mapping pointer", async () => {
  const { activeSpecialCasesArtifact, isActiveSpecialCasesArtifact } = await import("../lib/mapping-artifacts/special-cases-artifacts.ts");
  const special = artifact({ status: "committed" });
  const active = {
    full: { artifact: { id: "full-artifact" } },
    special_cases: { artifact: special, activated_at: "2026-09-28T00:00:00Z", activated_by: "Admin" },
  };
  const selected = activeSpecialCasesArtifact(active);
  assert.equal(selected?.artifact.id, "special-cases-artifact");
  assert.equal(isActiveSpecialCasesArtifact("special-cases-artifact", selected), true);
  assert.equal(isActiveSpecialCasesArtifact("full-artifact", selected), false);
});

test("Special Cases lifecycle guards require publish, valid commit, and admin activation", async () => {
  const {
    specialCasesPublishDisabledReason,
    specialCasesCommitDisabledReason,
    specialCasesActivationDisabledReason,
  } = await import("../lib/mapping-artifacts/special-cases-artifacts.ts");
  const analyst = { canPublish: true, canCommit: true, canActivate: false };
  const admin = { canPublish: true, canCommit: true, canActivate: true };
  assert.match(specialCasesPublishDisabledReason(analyst, artifact()), /already published/i);
  assert.match(specialCasesCommitDisabledReason(null, analyst), /Publish/i);
  assert.match(specialCasesCommitDisabledReason(artifact({ validation: { valid: false, blocking_errors: ["bad row"] } }), analyst), /validation/i);
  assert.match(specialCasesActivationDisabledReason(artifact({ status: "draft" }), null, admin), /Commit/i);
  assert.match(specialCasesActivationDisabledReason(artifact({ status: "committed" }), null, analyst), /admin/i);
  assert.equal(specialCasesActivationDisabledReason(artifact({ status: "committed" }), null, admin), null);
});
