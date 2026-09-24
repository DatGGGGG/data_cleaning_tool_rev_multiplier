import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const sourceArtifactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const newJobId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const resultArtifactId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const actor = { displayName: "Test Analyst" };

let originalWorkingDirectory;
let fixtureRoot;
let originalFetch;
let server;
let store;
let remoteJobs;
let startCalls;
let missingJobs;
let invalidStartResponse;

function remoteJob(status, overrides = {}) {
  return {
    job: {
      id: jobId,
      job_type: "top_down_publisher_ids",
      status,
      result_artifact_id: status === "success" ? resultArtifactId : null,
      error_code: status === "failed" ? "sensor_failure" : null,
      error_summary: status === "failed" ? "SensorTower rejected one or more apps." : null,
      created_at: "2026-09-24T00:00:00.000Z",
      started_at: status === "queued" ? null : "2026-09-24T00:01:00.000Z",
      finished_at: ["success", "failed", "interrupted"].includes(status) ? "2026-09-24T00:02:00.000Z" : null,
      ...overrides,
    },
  };
}

function storedJob(status = "queued") {
  return {
    remoteJobId: jobId,
    sourceArtifactId,
    localTopDownVersionId: "local-version-1",
    status,
    resultArtifactId: null,
    errorCode: null,
    errorSummary: null,
    createdAt: "2026-09-24T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    updatedAt: "2026-09-24T00:00:00.000Z",
    actor: "Test Analyst",
  };
}

async function writeStore(generationJobs = [], publications = []) {
  await mkdir(path.join(fixtureRoot, "storage"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "storage", "mapping-artifact-workbench.json"), JSON.stringify({
    schemaVersion: 1,
    updatedAt: "2026-09-24T00:00:00.000Z",
    publications,
    generationJobs,
    selections: { topDownWithPublisherIdsArtifactId: null, bottomUpArtifactId: null },
    activity: [],
  }), "utf8");
}

async function currentStore() {
  return JSON.parse(await readFile(path.join(fixtureRoot, "storage", "mapping-artifact-workbench.json"), "utf8"));
}

before(async () => {
  originalWorkingDirectory = process.cwd();
  originalFetch = globalThis.fetch;
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "mapping-artifact-enrichment-"));
  process.chdir(fixtureRoot);
  process.env.SENSORTOWER_PIPELINE_API_BASE_URL = "http://pipeline.test:8010";
  process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN = "test-pipeline-service-token";
  remoteJobs = new Map();
  startCalls = 0;
  missingJobs = new Set();
  invalidStartResponse = false;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/mapping-artifacts/generate/top-down-publisher-ids") {
      startCalls += 1;
      if (invalidStartResponse) return Response.json({ status: "queued" }, { status: 202 });
      remoteJobs.set(newJobId, remoteJob("queued", { id: newJobId }));
      return Response.json({ job: { id: newJobId, status: "queued" } }, { status: 202 });
    }
    const match = parsed.pathname.match(/^\/mapping-artifacts\/jobs\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (missingJobs.has(id)) return Response.json({ error: { code: "not_found", message: "Job not found" } }, { status: 404 });
      const response = remoteJobs.get(id);
      if (!response) return Response.json({ error: { code: "not_found", message: "Job not found" } }, { status: 404 });
      return Response.json(response);
    }
    throw new Error(`Unexpected fetch ${init.method || "GET"} ${parsed.pathname}`);
  };
  server = await import("../lib/mapping-artifacts/server.ts");
  store = await import("../lib/mapping-artifacts/store.ts");
});

after(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalWorkingDirectory);
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("reuses a real queued or running remote job without starting a duplicate", { concurrency: false }, async () => {
  await writeStore([storedJob("queued")]);
  remoteJobs = new Map([[jobId, remoteJob("running")]]);
  startCalls = 0;
  globalThis.__topDownEnrichmentStartLock = undefined;

  const result = await server.startTopDownEnrichment(sourceArtifactId, "local-version-1", actor);
  assert.deepEqual(result, { job_id: jobId, status: "running" });
  assert.equal(startCalls, 0);
  const persisted = await currentStore();
  assert.equal(persisted.generationJobs[0].status, "running");
  assert.equal(persisted.activity.filter((item) => item.action === "top_down_enrichment_reused").length, 1);
});

test("two simultaneous starts serialize and create only one remote job", { concurrency: false }, async () => {
  await writeStore([]);
  remoteJobs = new Map();
  missingJobs = new Set();
  startCalls = 0;
  globalThis.__topDownEnrichmentStartLock = undefined;

  const [first, second] = await Promise.all([
    server.startTopDownEnrichment(sourceArtifactId, "local-version-1", actor),
    server.startTopDownEnrichment(sourceArtifactId, "local-version-1", actor),
  ]);
  assert.deepEqual(first, { job_id: newJobId, status: "queued" });
  assert.deepEqual(second, { job_id: newJobId, status: "queued" });
  assert.equal(startCalls, 1);
});

test("reconciles terminal or missing stale jobs before starting a new remote job", { concurrency: false }, async () => {
  for (const [status, remote] of [
    ["success", remoteJob("success")],
    ["failed", remoteJob("failed")],
    ["interrupted", remoteJob("interrupted")],
    ["missing", null],
  ]) {
    await writeStore([storedJob("queued")]);
    remoteJobs = new Map(remote ? [[jobId, remote]] : []);
    missingJobs = new Set(remote ? [] : [jobId]);
    startCalls = 0;
    globalThis.__topDownEnrichmentStartLock = undefined;

    const result = await server.startTopDownEnrichment(sourceArtifactId, "local-version-1", actor);
    assert.deepEqual(result, { job_id: newJobId, status: "queued" }, status);
    assert.equal(startCalls, 1, status);
    const persisted = await currentStore();
    const stale = persisted.generationJobs.find((job) => job.remoteJobId === jobId);
    assert.equal(stale.status, status === "missing" ? "interrupted" : status, status);
    assert.equal(persisted.generationJobs.find((job) => job.remoteJobId === newJobId).status, "queued", status);
  }
});

test("persists each terminal transition and writes terminal audit activity only once", { concurrency: false }, async () => {
  await writeStore([storedJob("running")]);
  remoteJobs = new Map([[jobId, remoteJob("success")]]);
  missingJobs = new Set();

  await server.refreshTopDownEnrichmentJob(jobId);
  await server.refreshTopDownEnrichmentJob(jobId);
  const persisted = await currentStore();
  const job = persisted.generationJobs[0];
  assert.equal(job.status, "success");
  assert.equal(job.resultArtifactId, resultArtifactId);
  assert.equal(job.startedAt, "2026-09-24T00:01:00.000Z");
  assert.equal(job.finishedAt, "2026-09-24T00:02:00.000Z");
  assert.equal(persisted.activity.filter((item) => item.action === "top_down_enrichment_succeeded").length, 1);
});

test("dashboard selects only a related active job or a recent successful job for reload recovery", { concurrency: false }, async () => {
  const current = Date.parse("2026-09-24T12:00:00.000Z");
  const unrelated = { ...storedJob("running"), remoteJobId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", sourceArtifactId: "ffffffff-ffff-4fff-8fff-ffffffffffff", updatedAt: "2026-09-24T11:59:00.000Z" };
  const active = { ...storedJob("running"), updatedAt: "2026-09-24T11:58:00.000Z" };
  const selected = server.relevantTopDownEnrichmentJob([unrelated, active], [sourceArtifactId], current);
  assert.equal(selected?.job.id, jobId);
  assert.equal(selected?.sourceArtifactId, sourceArtifactId);

  const recentSuccess = { ...storedJob("success"), resultArtifactId, updatedAt: "2026-09-24T11:00:00.000Z", finishedAt: "2026-09-24T11:00:00.000Z" };
  assert.equal(server.relevantTopDownEnrichmentJob([recentSuccess], [sourceArtifactId], current)?.job.result_artifact_id, resultArtifactId);
  const oldSuccess = { ...recentSuccess, updatedAt: "2026-09-22T11:00:00.000Z" };
  assert.equal(server.relevantTopDownEnrichmentJob([oldSuccess], [sourceArtifactId], current), null);
});

test("invalid upstream start responses become structured 502 errors", { concurrency: false }, async () => {
  await writeStore([]);
  remoteJobs = new Map();
  missingJobs = new Set();
  invalidStartResponse = true;
  globalThis.__topDownEnrichmentStartLock = undefined;
  await assert.rejects(
    () => server.startTopDownEnrichment(sourceArtifactId, "local-version-1", actor),
    (error) => error?.status === 502 && error?.code === "upstream_invalid_response",
  );
  invalidStartResponse = false;
});

test("enrichment routes keep status read-only and start publish-protected", { concurrency: false }, async () => {
  const original = {
    ui: process.env.MAPPING_ARTIFACT_UI_ENABLED,
    mutations: process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED,
    session: process.env.WORKBENCH_SESSION_SECRET,
  };
  process.env.MAPPING_ARTIFACT_UI_ENABLED = "true";
  process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED = "true";
  process.env.WORKBENCH_SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
  const startRoute = await import("../app/api/mapping-artifacts/generate/top-down-publisher-ids/route.ts");
  const jobRoute = await import("../app/api/mapping-artifacts/jobs/[jobId]/route.ts");
  try {
    const start = await startRoute.POST(new Request("http://localhost/api/mapping-artifacts/generate/top-down-publisher-ids", { method: "POST", body: "{}" }));
    assert.equal(start.status, 401);
    const status = await jobRoute.GET(new Request(`http://localhost/api/mapping-artifacts/jobs/${jobId}`), { params: Promise.resolve({ jobId }) });
    assert.equal(status.status, 401);
  } finally {
    if (original.ui === undefined) delete process.env.MAPPING_ARTIFACT_UI_ENABLED; else process.env.MAPPING_ARTIFACT_UI_ENABLED = original.ui;
    if (original.mutations === undefined) delete process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED; else process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED = original.mutations;
    if (original.session === undefined) delete process.env.WORKBENCH_SESSION_SECRET; else process.env.WORKBENCH_SESSION_SECRET = original.session;
  }
});

test("the start route returns a structured 502 for a malformed upstream job response", { concurrency: false }, async () => {
  const original = {
    ui: process.env.MAPPING_ARTIFACT_UI_ENABLED,
    mutations: process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED,
    session: process.env.WORKBENCH_SESSION_SECRET,
  };
  process.env.MAPPING_ARTIFACT_UI_ENABLED = "true";
  process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED = "true";
  process.env.WORKBENCH_SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
  invalidStartResponse = true;
  globalThis.__topDownEnrichmentStartLock = undefined;
  try {
    const { createSignedSession, WORKBENCH_SESSION_COOKIE } = await import("../lib/auth/session.ts");
    const token = await createSignedSession({ userId: "123", email: "user@garena.com", displayName: "Test Analyst", role: "analyst" });
    const startRoute = await import("../app/api/mapping-artifacts/generate/top-down-publisher-ids/route.ts");
    const response = await startRoute.POST(new Request("http://localhost/api/mapping-artifacts/generate/top-down-publisher-ids", {
      method: "POST",
      headers: { cookie: `${WORKBENCH_SESSION_COOKIE}=${encodeURIComponent(token)}` },
      body: JSON.stringify({ sourceArtifactId, localTopDownVersionId: "local-version-1" }),
    }));
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.error.code, "upstream_invalid_response");
  } finally {
    invalidStartResponse = false;
    if (original.ui === undefined) delete process.env.MAPPING_ARTIFACT_UI_ENABLED; else process.env.MAPPING_ARTIFACT_UI_ENABLED = original.ui;
    if (original.mutations === undefined) delete process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED; else process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED = original.mutations;
    if (original.session === undefined) delete process.env.WORKBENCH_SESSION_SECRET; else process.env.WORKBENCH_SESSION_SECRET = original.session;
  }
});
