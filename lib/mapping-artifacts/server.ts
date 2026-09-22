import { createHash } from "node:crypto";
import {
  activateRemoteFullArtifact,
  commitRemoteArtifact,
  generateRemoteFull,
  getRemoteActiveArtifacts,
  getRemoteArtifact,
  getRemoteArtifactJob,
  listRemoteArtifacts,
  publishRemoteArtifact,
  startRemoteTopDownEnrichment,
} from "@/lib/mapping-artifacts/client";
import { MappingArtifactWorkbenchError } from "@/lib/mapping-artifacts/errors";
import {
  createIntegrationLog,
  mutateMappingArtifactStore,
  readMappingArtifactStore,
  saveGenerationJob,
  savePublicationReceipt,
  updateGenerationJob,
} from "@/lib/mapping-artifacts/store";
import type { MappingArtifactType } from "@/lib/mapping-artifacts/types";
import { exportBottomUpVersionCsv, listBottomUpVersions } from "@/lib/bottom-up/server";
import { exportTopDownVersionCsv, getTopDownVersionFreshness, listTopDownVersions } from "@/lib/top-down/server";
import type { WorkbenchPrincipal } from "@/lib/mapping-artifacts/auth";

function checksum(csv: string) {
  return createHash("sha256").update(Buffer.from(csv, "utf-8")).digest("hex");
}

function assertChecksum(csv: string, expected: string) {
  const actual = checksum(csv);
  if (actual !== expected) {
    throw new MappingArtifactWorkbenchError("version_integrity_failed", "The saved version CSV does not match its recorded checksum.", 409);
  }
  return actual;
}

function requireNonemptyCsv(csv: string, workflow: string) {
  if (csv.split(/\r?\n/).filter(Boolean).length < 2) {
    throw new MappingArtifactWorkbenchError("validation_failed", `The saved ${workflow} version has no publishable CSV rows.`, 422);
  }
}

export async function getMappingArtifactDashboard() {
  const [local, topDownVersions, bottomUpVersions, topDownVersionFreshness] = await Promise.all([
    readMappingArtifactStore(),
    listTopDownVersions(),
    listBottomUpVersions(),
    getTopDownVersionFreshness(),
  ]);
  return { local, topDownVersions, bottomUpVersions, topDownVersionFreshness };
}

export async function getRemoteArtifactCatalog(filters: { type?: MappingArtifactType; status?: string } = {}) {
  return listRemoteArtifacts(filters);
}

export async function getRemoteArtifactDetail(artifactId: string) {
  return getRemoteArtifact(artifactId);
}

export async function getRemoteActiveArtifactState() {
  return getRemoteActiveArtifacts();
}

export async function publishSavedTopDownVersion(versionId: string, principal: WorkbenchPrincipal) {
  const versions = await listTopDownVersions();
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new MappingArtifactWorkbenchError("version_not_found", "Top Down saved version not found.", 404);
  const exported = await exportTopDownVersionCsv(versionId);
  requireNonemptyCsv(exported.csv, "Top Down");
  const localChecksum = assertChecksum(exported.csv, version.checksumSha256);
  const remote = await publishRemoteArtifact({
    artifactType: "top_down_raw", csvContent: exported.csv, checksumSha256: localChecksum,
    workflow: "top_down", versionId, versionLabel: version.label, actor: principal.displayName,
  });
  await savePublicationReceipt({
    workflow: "top_down", localVersionId: version.id, localVersionLabel: version.label,
    localChecksumSha256: localChecksum, remoteArtifactId: remote.artifact.id,
    remoteArtifactType: "top_down_raw", remoteStatus: "committed", publishedAt: new Date().toISOString(), publishedBy: principal.displayName,
  });
  return remote;
}

export async function publishSavedBottomUpVersion(versionId: string, principal: WorkbenchPrincipal) {
  const versions = await listBottomUpVersions();
  const version = versions.find((item) => item.id === versionId);
  if (!version) throw new MappingArtifactWorkbenchError("version_not_found", "Bottom Up saved version not found.", 404);
  const exported = await exportBottomUpVersionCsv(versionId);
  requireNonemptyCsv(exported.csv, "Bottom Up");
  const localChecksum = assertChecksum(exported.csv, version.checksumSha256);
  const remote = await publishRemoteArtifact({
    artifactType: "bottom_up", csvContent: exported.csv, checksumSha256: localChecksum,
    workflow: "bottom_up", versionId, versionLabel: version.label, actor: principal.displayName,
  });
  await savePublicationReceipt({
    workflow: "bottom_up", localVersionId: version.id, localVersionLabel: version.label,
    localChecksumSha256: localChecksum, remoteArtifactId: remote.artifact.id,
    remoteArtifactType: "bottom_up", remoteStatus: "committed", publishedAt: new Date().toISOString(), publishedBy: principal.displayName,
  });
  return remote;
}

export async function startTopDownEnrichment(sourceArtifactId: string, localTopDownVersionId: string, principal: WorkbenchPrincipal) {
  const local = await readMappingArtifactStore();
  const duplicate = local.generationJobs.find((job) => job.sourceArtifactId === sourceArtifactId && (job.status === "queued" || job.status === "running"));
  if (duplicate) throw new MappingArtifactWorkbenchError("job_in_progress", "An enrichment job is already running for this Top Down artifact.", 409);
  const job = await startRemoteTopDownEnrichment(sourceArtifactId, principal.displayName);
  await saveGenerationJob({ remoteJobId: job.job_id, sourceArtifactId, localTopDownVersionId, status: job.status === "running" ? "running" : "queued", resultArtifactId: null, errorCode: null, errorSummary: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, principal.displayName);
  return job;
}

export async function refreshTopDownEnrichmentJob(jobId: string) {
  const remote = await getRemoteArtifactJob(jobId);
  await updateGenerationJob(jobId, {
    status: remote.job.status,
    resultArtifactId: remote.job.result_artifact_id,
    errorCode: remote.job.error_code,
    errorSummary: remote.job.error_summary,
  });
  return remote;
}

export async function createFullMapping(topDownArtifactId: string, bottomUpArtifactId: string, principal: WorkbenchPrincipal) {
  const result = await generateRemoteFull({ topDownArtifactId, bottomUpArtifactId, actor: principal.displayName });
  await mutateMappingArtifactStore((store) => {
    store.selections = { topDownWithPublisherIdsArtifactId: topDownArtifactId, bottomUpArtifactId };
    store.activity.unshift(createIntegrationLog("full_mapping_generated", principal.displayName, "mapping_artifact", result.artifact.id, `Generated Full Mapping from ${topDownArtifactId} and ${bottomUpArtifactId}.`));
  });
  return result;
}

export async function commitMappingArtifact(artifactId: string, principal: WorkbenchPrincipal) {
  const result = await commitRemoteArtifact(artifactId, principal.displayName);
  await mutateMappingArtifactStore((store) => store.activity.unshift(createIntegrationLog("mapping_artifact_committed", principal.displayName, "mapping_artifact", artifactId, "Committed generated mapping artifact.")));
  return result;
}

export async function activateFullMappingArtifact(artifactId: string, principal: WorkbenchPrincipal) {
  const before = await getRemoteActiveArtifacts();
  const previousArtifactId = before.active.full?.artifact.id ?? null;
  const result = await activateRemoteFullArtifact(artifactId, principal.displayName);
  await mutateMappingArtifactStore((store) => store.activity.unshift(createIntegrationLog(
    "full_mapping_activated",
    principal.displayName,
    "mapping_artifact",
    artifactId,
    `Activated committed Full Mapping artifact ${artifactId}; previous active artifact: ${previousArtifactId ?? "none"}.`,
  )));
  return result;
}
