import assert from "node:assert/strict";
import test from "node:test";

const trackedVariables = [
  "MAPPING_ARTIFACT_UI_ENABLED",
  "MAPPING_ARTIFACT_MUTATIONS_ENABLED",
  "SENSORTOWER_PIPELINE_API_BASE_URL",
  "SENSORTOWER_PIPELINE_API_SERVICE_TOKEN",
];

function snapshotEnvironment() {
  return Object.fromEntries(trackedVariables.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const key of trackedVariables) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

test("mapping artifact readiness is safe by default", async () => {
  const original = snapshotEnvironment();
  try {
    delete process.env.MAPPING_ARTIFACT_UI_ENABLED;
    delete process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED;
    delete process.env.SENSORTOWER_PIPELINE_API_BASE_URL;
    delete process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN;
    const { getMappingArtifactReadiness } = await import("../lib/mapping-artifacts/auth.ts");
    const readiness = await getMappingArtifactReadiness(new Request("http://localhost/api/mapping-artifacts/readiness"));
    assert.equal(readiness.uiEnabled, false);
    assert.equal(readiness.mutationsEnabled, false);
    assert.equal(readiness.authenticated, false);
    assert.equal(readiness.canPublish, false);
    assert.equal(readiness.canCommit, false);
    assert.equal(readiness.canActivate, false);
    assert.equal(readiness.upstreamConfigured, false);
  } finally {
    restoreEnvironment(original);
  }
});

test("artifact mutation routes fail closed without a trusted principal", async () => {
  const original = snapshotEnvironment();
  try {
    process.env.MAPPING_ARTIFACT_UI_ENABLED = "true";
    process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED = "true";
    process.env.SENSORTOWER_PIPELINE_API_BASE_URL = "http://host.docker.internal:8010";
    process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN = "server-only-test-token";
    const { requireMappingArtifactCapability } = await import("../lib/mapping-artifacts/auth.ts");
    await assert.rejects(
      () => requireMappingArtifactCapability(new Request("http://localhost/api/mapping-artifacts/publish/top-down"), "publish"),
      (error) => error?.code === "authentication_required" && error?.status === 401,
    );
  } finally {
    restoreEnvironment(original);
  }
});
