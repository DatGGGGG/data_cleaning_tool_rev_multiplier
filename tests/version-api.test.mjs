import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const SERVICE_TOKEN = "test-portal-service-token-with-sufficient-length";
const TOP_DOWN_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const BOTTOM_UP_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_VERSION_ID = "33333333-3333-4333-8333-333333333333";

const topDownRows = [
  {
    id: "top-row-1",
    ordinal: 1,
    gameName: "Example Game",
    sensorTowerLink: "https://app.sensortower.com/overview/example",
    iosApps: [
      { appId: "1001", publisherName: "Example Publisher", appName: "Example Game", source: "resolved" },
      { appId: "1002", publisherName: "Example Publisher", appName: "Example Game HD", source: "resolved" },
    ],
    androidApps: [
      { appId: "com.example.game", publisherName: "Example Publisher", appName: "Example Game", source: "resolved" },
    ],
    sensorTowerResolution: {
      status: "resolved",
      unifiedAppId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      resolvedGameName: "Example Game",
      errorMessage: "",
      resolvedAt: "2026-09-15T00:00:00.000Z",
      iosOptions: [],
      androidOptions: [],
    },
    addingDate: "2026-09-15",
    adder: "Test Operator",
    reviewStatus: "confirmed",
    notes: "",
  },
];

const topDownPublishers = [
  {
    id: "publisher-1",
    key: "example-publisher",
    name: "Example Publisher",
    revenueMultiplier: "1",
    rows: topDownRows,
  },
];

const bottomUpRows = [
  {
    id: "bottom-row-1",
    ordinal: 1,
    cleanedPublisherName: "Example Publisher",
    publisherId: "1001",
    publisherName: "Example Publisher Ltd",
    revenueMultiplier: "15",
    reviewStatus: "confirmed",
    notes: "",
    adder: "Test Operator",
    addingDate: "2026-09-15",
  },
  {
    id: "bottom-row-2",
    ordinal: 2,
    cleanedPublisherName: "Example Publisher",
    publisherId: "1002",
    publisherName: "Example Publisher Mobile",
    revenueMultiplier: "12",
    reviewStatus: "needs_review",
    notes: "Check this mapping",
    adder: "Test Operator",
    addingDate: "2026-09-15",
  },
  {
    id: "bottom-row-3",
    ordinal: 3,
    cleanedPublisherName: "",
    publisherId: "1003",
    publisherName: "Unmapped Publisher",
    revenueMultiplier: "1",
    reviewStatus: "needs_review",
    notes: "",
    adder: "Test Operator",
    addingDate: "2026-09-15",
  },
];

let originalWorkingDirectory;
let fixtureRoot;
let topDownStorePath;
let bottomUpStorePath;
let topDownVersionsRoute;
let topDownDownloadRoute;
let bottomUpVersionsRoute;
let bottomUpDownloadRoute;

function request(pathname, token = SERVICE_TOKEN) {
  const headers = token === null ? {} : { Authorization: `Bearer ${token}` };
  return new Request(`http://localhost${pathname}`, { headers });
}

async function writeFixtureStores() {
  const storagePath = path.join(fixtureRoot, "storage");
  await mkdir(storagePath, { recursive: true });
  topDownStorePath = path.join(storagePath, "top-down-workbench.json");
  bottomUpStorePath = path.join(storagePath, "bottom-up-workbench.json");

  await writeFile(
    topDownStorePath,
    JSON.stringify({
      datasetId: "top_down_dataset",
      datasetName: "Top Down",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
      publishers: topDownPublishers,
      versions: [
        {
          id: TOP_DOWN_VERSION_ID,
          label: "Top-down test snapshot",
          createdAt: "2026-09-15T01:00:00.000Z",
          createdBy: "Test Operator",
          publisherCount: 1,
          publishers: topDownPublishers,
        },
      ],
      logs: [],
      artifacts: [],
    }),
    "utf-8",
  );

  await writeFile(
    bottomUpStorePath,
    JSON.stringify({
      datasetId: "bottom_up_dataset",
      datasetName: "Bottom Up",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
      rows: bottomUpRows,
      checkedPublisherNames: [],
      appCandidates: [],
      appCandidateCount: 0,
      publisherCandidates: [],
      publisherCandidateCount: 0,
      versions: [
        {
          id: BOTTOM_UP_VERSION_ID,
          label: "Bottom-up test snapshot",
          createdAt: "2026-09-15T02:00:00.000Z",
          createdBy: "Test Operator",
          rowCount: 3,
          rows: bottomUpRows,
        },
      ],
      logs: [],
      artifacts: [],
    }),
    "utf-8",
  );
}

before(async () => {
  originalWorkingDirectory = process.cwd();
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "mapping-version-api-"));
  await writeFixtureStores();
  process.chdir(fixtureRoot);
  process.env.ENABLE_SENSORTOWER_AUTO_REFRESH = "false";
  process.env.PORTAL_SERVICE_TOKEN = SERVICE_TOKEN;

  topDownVersionsRoute = await import("../app/api/top-down/versions/route.ts");
  topDownDownloadRoute = await import("../app/api/top-down/versions/[versionId]/download/route.ts");
  bottomUpVersionsRoute = await import("../app/api/bottom-up/versions/route.ts");
  bottomUpDownloadRoute = await import("../app/api/bottom-up/versions/[versionId]/download/route.ts");
});

after(async () => {
  process.chdir(originalWorkingDirectory);
  delete process.env.PORTAL_SERVICE_TOKEN;
  delete process.env.ENABLE_SENSORTOWER_AUTO_REFRESH;
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("all four protected endpoints reject a missing token", async () => {
  const responses = await Promise.all([
    topDownVersionsRoute.GET(request("/api/top-down/versions", null)),
    topDownDownloadRoute.GET(request(`/api/top-down/versions/${TOP_DOWN_VERSION_ID}/download`, null), {
      params: Promise.resolve({ versionId: TOP_DOWN_VERSION_ID }),
    }),
    bottomUpVersionsRoute.GET(request("/api/bottom-up/versions", null)),
    bottomUpDownloadRoute.GET(request(`/api/bottom-up/versions/${BOTTOM_UP_VERSION_ID}/download`, null), {
      params: Promise.resolve({ versionId: BOTTOM_UP_VERSION_ID }),
    }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401]);
});

test("an incorrect token returns 401", async () => {
  const response = await topDownVersionsRoute.GET(request("/api/top-down/versions", "wrong-token"));
  assert.equal(response.status, 401);
});

test("missing server token configuration returns 503", async () => {
  delete process.env.PORTAL_SERVICE_TOKEN;
  const response = await topDownVersionsRoute.GET(request("/api/top-down/versions"));
  process.env.PORTAL_SERVICE_TOKEN = SERVICE_TOKEN;
  assert.equal(response.status, 503);
});

test("a correct token lists enriched top-down versions", async () => {
  const response = await topDownVersionsRoute.GET(request("/api/top-down/versions"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.versions[0].workflow, "top_down");
  assert.equal(payload.versions[0].schemaVersion, 1);
  assert.equal(payload.versions[0].publisherCount, 1);
  assert.equal(payload.versions[0].flattenedAppCount, 3);
  assert.equal("publishers" in payload.versions[0], false);
});

test("top-down metadata matches the downloaded CSV", async () => {
  const listResponse = await topDownVersionsRoute.GET(request("/api/top-down/versions"));
  const metadata = (await listResponse.json()).versions[0];
  const downloadResponse = await topDownDownloadRoute.GET(
    request(`/api/top-down/versions/${TOP_DOWN_VERSION_ID}/download`),
    { params: Promise.resolve({ versionId: TOP_DOWN_VERSION_ID }) },
  );
  const csv = await downloadResponse.text();
  const checksum = createHash("sha256").update(Buffer.from(csv, "utf-8")).digest("hex");

  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(downloadResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(csv.split("\n").length - 1, metadata.flattenedAppCount);
  assert.equal(Buffer.byteLength(csv, "utf-8"), metadata.csvByteSize);
  assert.equal(checksum, metadata.checksumSha256);
  assert.equal(downloadResponse.headers.get("x-content-sha256"), checksum);
});

test("bottom-up metadata uses existing mapped and review rules", async () => {
  const response = await bottomUpVersionsRoute.GET(request("/api/bottom-up/versions"));
  const payload = await response.json();
  const metadata = payload.versions[0];

  assert.equal(response.status, 200);
  assert.equal(metadata.workflow, "bottom_up");
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.rowCount, 3);
  assert.equal(metadata.mappedRowCount, 2);
  assert.equal(metadata.needsReviewCount, 2);
  assert.equal("rows" in metadata, false);
});

test("bottom-up download preserves the historical multiplier and integrity metadata", async () => {
  const listResponse = await bottomUpVersionsRoute.GET(request("/api/bottom-up/versions"));
  const metadata = (await listResponse.json()).versions[0];
  const downloadResponse = await bottomUpDownloadRoute.GET(
    request(`/api/bottom-up/versions/${BOTTOM_UP_VERSION_ID}/download`),
    { params: Promise.resolve({ versionId: BOTTOM_UP_VERSION_ID }) },
  );
  const csv = await downloadResponse.text();
  const checksum = createHash("sha256").update(Buffer.from(csv, "utf-8")).digest("hex");

  assert.equal(downloadResponse.status, 200);
  assert.match(csv, /Example Publisher,1001,Example Publisher Ltd,15/);
  assert.match(csv, /Example Publisher,1002,Example Publisher Mobile,12/);
  assert.equal(Buffer.byteLength(csv, "utf-8"), metadata.csvByteSize);
  assert.equal(checksum, metadata.checksumSha256);
});

test("an unknown version returns 404 and a malformed ID is rejected before export", async () => {
  const unknownResponse = await topDownDownloadRoute.GET(
    request(`/api/top-down/versions/${UNKNOWN_VERSION_ID}/download`),
    { params: Promise.resolve({ versionId: UNKNOWN_VERSION_ID }) },
  );
  const malformedResponse = await topDownDownloadRoute.GET(
    request("/api/top-down/versions/not-a-version/download"),
    { params: Promise.resolve({ versionId: "not-a-version" }) },
  );

  assert.equal(unknownResponse.status, 404);
  assert.equal(malformedResponse.status, 400);
});

test("listing and downloading do not modify stored snapshots", async () => {
  const beforeTopDown = await readFile(topDownStorePath, "utf-8");
  const beforeBottomUp = await readFile(bottomUpStorePath, "utf-8");

  await topDownVersionsRoute.GET(request("/api/top-down/versions"));
  await topDownDownloadRoute.GET(request(`/api/top-down/versions/${TOP_DOWN_VERSION_ID}/download`), {
    params: Promise.resolve({ versionId: TOP_DOWN_VERSION_ID }),
  });
  await bottomUpVersionsRoute.GET(request("/api/bottom-up/versions"));
  await bottomUpDownloadRoute.GET(request(`/api/bottom-up/versions/${BOTTOM_UP_VERSION_ID}/download`), {
    params: Promise.resolve({ versionId: BOTTOM_UP_VERSION_ID }),
  });

  assert.equal(await readFile(topDownStorePath, "utf-8"), beforeTopDown);
  assert.equal(await readFile(bottomUpStorePath, "utf-8"), beforeBottomUp);
});

test("existing version creation endpoints continue working", async () => {
  const topDownResponse = await topDownVersionsRoute.POST(
    new Request("http://localhost/api/top-down/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorName: "Creation Test" }),
    }),
  );
  const bottomUpResponse = await bottomUpVersionsRoute.POST(
    new Request("http://localhost/api/bottom-up/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorName: "Creation Test" }),
    }),
  );

  assert.equal(topDownResponse.status, 200);
  assert.equal(bottomUpResponse.status, 200);
  assert.equal(JSON.parse(await readFile(topDownStorePath, "utf-8")).versions.length, 2);
  assert.equal(JSON.parse(await readFile(bottomUpStorePath, "utf-8")).versions.length, 2);
});
