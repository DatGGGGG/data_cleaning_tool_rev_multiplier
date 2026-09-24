import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const versionOneId = "step1-history-version-one";
const versionTwoId = "step1-history-version-two";
const currentVersionId = "step1-history-version-current";

function canonical(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function checksum(names) {
  return createHash("sha256").update(names.map(canonical).sort().join("\n"), "utf8").digest("hex");
}

function detail(id, createdAt, publisherNames, newPublisherNames = []) {
  return {
    id,
    label: id,
    createdAt,
    createdBy: "Test Operator",
    sourceSyncJobId: id,
    sourceCompletedAt: createdAt,
    sourceType: "api",
    publisherCount: publisherNames.length,
    newPublisherCount: newPublisherNames.length,
    checksumSha256: checksum(publisherNames),
    bootstrap: false,
    publisherNames,
    newPublisherNames,
  };
}

test("historically-new Step 1 filtering excludes names seen in any prior version", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "bottom-up-step1-history-"));
  const previousCwd = process.cwd();
  t.after(async () => {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  });

  const versionsDir = path.join(root, "storage", "bottom-up", "step1-versions");
  await mkdir(versionsDir, { recursive: true });
  const versionOne = detail(versionOneId, "2026-09-01T00:00:00.000Z", ["A", "B", "C"]);
  const versionTwo = detail(versionTwoId, "2026-09-02T00:00:00.000Z", ["A", "B", "D"]);
  const current = detail(currentVersionId, "2026-09-03T00:00:00.000Z", ["A", "C", "D", "E"], ["E"]);
  await Promise.all([versionOne, versionTwo, current].map((version) =>
    writeFile(path.join(versionsDir, `${version.id}.json`), JSON.stringify(version), "utf8"),
  ));
  await writeFile(path.join(root, "storage", "bottom-up-workbench.json"), JSON.stringify({
    datasetId: "bottom_up_dataset",
    datasetName: "Bottom Up",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    rows: [],
    checkedPublisherNames: [],
    appCandidates: [],
    appCandidateCount: 0,
    publisherCandidates: ["A", "C", "D", "E"].map((publisherName) => ({ publisherName, publisherIds: [], appCount: 1, apps: [] })),
    publisherCandidateCount: 4,
    step1Versions: [current, versionTwo, versionOne],
    currentStep1VersionId: currentVersionId,
    versions: [],
    logs: [],
    artifacts: [],
    productionSync: { status: "succeeded", stage: "Completed", message: "Done", startedAt: "", updatedAt: "2026-09-03T00:00:00.000Z", completedAt: "2026-09-03T00:00:00.000Z", pagesRead: 0, scannedRecords: 0, expectedRecordCount: 0, sourceType: "api" },
  }), "utf8");

  process.chdir(root);
  const server = await import("../lib/bottom-up/server.ts");
  const result = await server.getBottomUpStep1PublisherPage({ page: 1, pageSize: 50, filters: [], sortField: "publisherName", sortDirection: "asc", newOnly: true });
  assert.deepEqual(result.rows.map((row) => row.publisherName), ["E"]);
  assert.equal(result.comparison?.previousVersionCount, 2);
  assert.equal(result.comparison?.historicallyNewPublisherCount, 1);
  const versions = await server.listBottomUpStep1Versions();
  assert.equal(versions[0].publisherNames, undefined);
  assert.equal(versions.length, 3);
});
