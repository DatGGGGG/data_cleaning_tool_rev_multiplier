import { createHash } from "node:crypto";
import {
  activateRemoteArtifact,
  commitRemoteArtifact,
  generateRemoteFull,
  getRemoteActiveArtifacts,
  getRemoteArtifact,
  getRemoteArtifactJob,
  listRemoteArtifacts,
  publishRemoteArtifact,
  startRemoteTopDownEnrichment,
  downloadRemoteArtifact,
} from "@/lib/mapping-artifacts/client";
import { MappingArtifactWorkbenchError } from "@/lib/mapping-artifacts/errors";
import {
  createIntegrationLog,
  interruptMissingGenerationJob,
  mutateMappingArtifactStore,
  publicGenerationJob,
  readMappingArtifactStore,
  reconcileGenerationJob,
  recordGenerationJobReuse,
  saveGenerationJob,
  savePublicationReceipt,
} from "@/lib/mapping-artifacts/store";
import { isActiveEnrichmentJobStatus } from "@/lib/mapping-artifacts/job-contract";
import type { MappingArtifactCsvPreview, MappingArtifactJobResume, MappingArtifactType, StoredTopDownEnrichmentJob } from "@/lib/mapping-artifacts/types";
import { exportBottomUpVersionCsv, listBottomUpVersions } from "@/lib/bottom-up/server";
import { exportTopDownVersionCsv, getTopDownVersionFreshness, listTopDownVersions } from "@/lib/top-down/server";
import { downloadSpecialCaseFinal, getSpecialCaseFinalVersion } from "@/lib/special-cases/server";
import type { WorkbenchPrincipal } from "@/lib/mapping-artifacts/auth";
import { parseCsvPreview } from "@/lib/csv-preview";

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

const COMPLETED_RESUME_WINDOW_MS = 24 * 60 * 60 * 1_000;

declare global { var __topDownEnrichmentStartLock: Promise<void> | undefined; }

async function withTopDownEnrichmentStartLock<T>(work: () => Promise<T>) {
  const prior = globalThis.__topDownEnrichmentStartLock ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  globalThis.__topDownEnrichmentStartLock = prior.then(() => current);
  await prior;
  try {
    return await work();
  } finally {
    release();
  }
}

function newestJob(jobs: StoredTopDownEnrichmentJob[]) {
  return [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function relevantTopDownEnrichmentJob(
  jobs: StoredTopDownEnrichmentJob[],
  publishedRawTopDownArtifactIds: string[],
  now = Date.now(),
): MappingArtifactJobResume | null {
  const relevant = jobs.filter((job) => publishedRawTopDownArtifactIds.includes(job.sourceArtifactId));
  const active = newestJob(relevant.filter((job) => isActiveEnrichmentJobStatus(job.status)));
  if (active) return { job: publicGenerationJob(active), sourceArtifactId: active.sourceArtifactId };

  const recentSuccess = newestJob(relevant.filter((job) => {
    if (job.status !== "success" || !job.resultArtifactId) return false;
    const updatedAt = Date.parse(job.updatedAt);
    return !Number.isNaN(updatedAt) && now - updatedAt <= COMPLETED_RESUME_WINDOW_MS;
  }));
  return recentSuccess ? { job: publicGenerationJob(recentSuccess), sourceArtifactId: recentSuccess.sourceArtifactId } : null;
}

export async function getMappingArtifactDashboard() {
  const [local, topDownVersions, bottomUpVersions, topDownVersionFreshness] = await Promise.all([
    readMappingArtifactStore(),
    listTopDownVersions(),
    listBottomUpVersions(),
    getTopDownVersionFreshness(),
  ]);
  const publishedRawTopDownArtifactIds = local.publications
    .filter((publication) => publication.workflow === "top_down" && publication.remoteArtifactType === "top_down_raw")
    .map((publication) => publication.remoteArtifactId);
  return {
    local,
    topDownVersions,
    bottomUpVersions,
    topDownVersionFreshness,
    enrichmentResumeJob: relevantTopDownEnrichmentJob(local.generationJobs, publishedRawTopDownArtifactIds),
  };
}

export async function getRemoteArtifactCatalog(filters: { type?: MappingArtifactType; status?: string } = {}) {
  return listRemoteArtifacts(filters);
}

export async function getRemoteArtifactDetail(artifactId: string) {
  return getRemoteArtifact(artifactId);
}

const MAX_ARTIFACT_PREVIEW_BYTES = 25 * 1024 * 1024;

export async function previewRemoteArtifact(
  artifactId: string,
  input: { page?: number; pageSize?: number; search?: string } = {},
): Promise<MappingArtifactCsvPreview> {
  const detail = await getRemoteArtifact(artifactId);
  const downloaded = await downloadRemoteArtifact(artifactId);
  const bytes = Buffer.from(downloaded.body);
  if (bytes.byteLength > MAX_ARTIFACT_PREVIEW_BYTES) {
    throw new MappingArtifactWorkbenchError("preview_too_large", "This CSV is too large for an in-browser preview. Download it instead.", 413);
  }
  if (checksum(bytes.toString("utf-8")) !== detail.artifact.checksum_sha256) {
    throw new MappingArtifactWorkbenchError("artifact_integrity_failed", "The downloaded artifact does not match its recorded checksum.", 409);
  }
  const parsed = parseCsvPreview(bytes.toString("utf-8"));
  const search = input.search?.trim() || "";
  const needle = search.toLocaleLowerCase();
  const matchedRows = needle ? parsed.rows.filter((row) => row.some((value) => value.toLocaleLowerCase().includes(needle))) : parsed.rows;
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize || 50)));
  const pageCount = Math.max(1, Math.ceil(matchedRows.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(input.page || 1)));
  return {
    artifact: detail.artifact,
    columns: parsed.columns,
    rows: matchedRows.slice((page - 1) * pageSize, page * pageSize),
    totalRows: matchedRows.length,
    page,
    pageSize,
    pageCount,
    search,
  };
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

export async function publishSavedSpecialCasesVersion(
  versionId: string,
  principal: WorkbenchPrincipal,
) {
  const version = await getSpecialCaseFinalVersion(versionId);
  const exported = await downloadSpecialCaseFinal(versionId);
  requireNonemptyCsv(exported.content, "Special Cases");
  const localChecksum = assertChecksum(exported.content, version.checksum);
  let sourceArtifactIds: string[] = [];
  let sourceArtifactChecksums: Record<string, string> = {};
  if (version.fullArtifactId) {
    const source = await getRemoteArtifact(version.fullArtifactId);
    if (source.artifact.artifact_type !== "full" || source.artifact.status !== "committed") {
      throw new MappingArtifactWorkbenchError(
        "invalid_source_artifact",
        "The Special Cases version is not linked to a committed Full Mapping artifact.",
        409,
      );
    }
    sourceArtifactIds = [source.artifact.id];
    sourceArtifactChecksums = { [source.artifact.id]: source.artifact.checksum_sha256 };
  }
  const remote = await publishRemoteArtifact({
    artifactType: "special_cases",
    csvContent: exported.content,
    checksumSha256: localChecksum,
    workflow: "special_cases",
    versionId,
    versionLabel: version.label,
    actor: principal.displayName,
    sourceArtifactIds,
    sourceArtifactChecksums,
    provenance: {
      historical_final_version_id: version.historicalVersionId,
      local_version_type: version.versionType,
      original_filename: version.originalFilename,
    },
  });
  await savePublicationReceipt({
    workflow: "special_cases",
    localVersionId: version.id,
    localVersionLabel: version.label,
    localChecksumSha256: localChecksum,
    remoteArtifactId: remote.artifact.id,
    remoteArtifactType: "special_cases",
    remoteStatus: remote.artifact.status,
    publishedAt: new Date().toISOString(),
    publishedBy: principal.displayName,
  });
  return remote;
}

export async function startTopDownEnrichment(sourceArtifactId: string, localTopDownVersionId: string, principal: WorkbenchPrincipal) {
  return withTopDownEnrichmentStartLock(async () => {
    const local = await readMappingArtifactStore();
    const candidates = local.generationJobs
      .filter((job) => job.sourceArtifactId === sourceArtifactId && isActiveEnrichmentJobStatus(job.status))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    for (const candidate of candidates) {
      try {
        const remote = await getRemoteArtifactJob(candidate.remoteJobId);
        const reconciled = await reconcileGenerationJob(remote.job, principal.displayName);
        if (isActiveEnrichmentJobStatus(remote.job.status)) {
          await recordGenerationJobReuse(reconciled ?? candidate, principal.displayName);
          return { job_id: remote.job.id, status: remote.job.status };
        }
      } catch (error) {
        if (error instanceof MappingArtifactWorkbenchError && error.status === 404) {
          await interruptMissingGenerationJob(candidate, principal.displayName);
          continue;
        }
        throw error;
      }
    }

    const job = await startRemoteTopDownEnrichment(sourceArtifactId, principal.displayName);
    const startedAt = new Date().toISOString();
    await saveGenerationJob({
      remoteJobId: job.job_id,
      sourceArtifactId,
      localTopDownVersionId,
      status: job.status,
      resultArtifactId: null,
      errorCode: null,
      errorSummary: null,
      createdAt: startedAt,
      startedAt: job.status === "running" ? startedAt : null,
      finishedAt: null,
      updatedAt: startedAt,
      actor: principal.displayName,
    }, principal.displayName);
    return job;
  });
}

export async function refreshTopDownEnrichmentJob(jobId: string) {
  const local = await readMappingArtifactStore();
  const stored = local.generationJobs.find((job) => job.remoteJobId === jobId) ?? null;
  try {
    const remote = await getRemoteArtifactJob(jobId);
    await reconcileGenerationJob(remote.job, stored?.actor);
    return remote;
  } catch (error) {
    if (stored && error instanceof MappingArtifactWorkbenchError && error.status === 404) {
      const interrupted = await interruptMissingGenerationJob(stored, stored.actor);
      if (interrupted) return { job: publicGenerationJob(interrupted) };
    }
    throw error;
  }
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
  const before = await getRemoteArtifact(artifactId);
  const result = await commitRemoteArtifact(artifactId, principal.displayName);
  await mutateMappingArtifactStore((store) => {
    const action = before.artifact.artifact_type === "special_cases"
      ? "special_cases_artifact_committed"
      : "mapping_artifact_committed";
    store.activity.unshift(createIntegrationLog(
      action,
      principal.displayName,
      "mapping_artifact",
      artifactId,
      `Committed ${before.artifact.artifact_type} mapping artifact.`,
    ));
    store.activity = store.activity.slice(0, 250);
  });
  return result;
}

export async function activateMappingArtifact(artifactId: string, principal: WorkbenchPrincipal) {
  const candidate = await getRemoteArtifact(artifactId);
  if (candidate.artifact.artifact_type !== "full" && candidate.artifact.artifact_type !== "special_cases") {
    throw new MappingArtifactWorkbenchError("invalid_artifact_type", "Only Full Mapping or Special Cases artifacts can be activated.", 422);
  }
  if (candidate.artifact.status !== "committed") {
    throw new MappingArtifactWorkbenchError("invalid_artifact_status", "Only committed mapping artifacts can be activated.", 409);
  }
  const before = await getRemoteActiveArtifacts();
  const previousArtifactId = before.active[candidate.artifact.artifact_type]?.artifact.id ?? null;
  const result = await activateRemoteArtifact(artifactId, principal.displayName);
  await mutateMappingArtifactStore((store) => {
    const action = candidate.artifact.artifact_type === "special_cases"
      ? "special_cases_artifact_activated"
      : "full_mapping_activated";
    store.activity.unshift(createIntegrationLog(
      action,
      principal.displayName,
      "mapping_artifact",
      artifactId,
      `Activated committed ${candidate.artifact.artifact_type} artifact ${artifactId}; previous active artifact: ${previousArtifactId ?? "none"}.`,
    ));
    store.activity = store.activity.slice(0, 250);
  });
  return result;
}

export async function activateFullMappingArtifact(artifactId: string, principal: WorkbenchPrincipal) {
  return activateMappingArtifact(artifactId, principal);
}
