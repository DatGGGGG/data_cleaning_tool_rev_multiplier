import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  MappingArtifactJob,
  MappingArtifactJobStatus,
  MappingArtifactIntegrationLog,
  MappingArtifactPublicationReceipt,
  MappingArtifactWorkbenchStore,
  StoredTopDownEnrichmentJob,
} from "@/lib/mapping-artifacts/types";
import { isTerminalEnrichmentJobStatus } from "@/lib/mapping-artifacts/job-contract";

const STORAGE_PATH = path.join(process.cwd(), "storage", "mapping-artifact-workbench.json");
declare global { var __mappingArtifactStoreWrite: Promise<void> | undefined; }

function nowIso() { return new Date().toISOString(); }

function validStatus(value: unknown): value is MappingArtifactJobStatus {
  return value === "queued" || value === "running" || value === "success" || value === "failed" || value === "interrupted";
}

function nonempty(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullable(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeGenerationJob(value: unknown): StoredTopDownEnrichmentJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const job = value as Partial<StoredTopDownEnrichmentJob>;
  const status = validStatus(job.status) ? job.status : null;
  const remoteJobId = nonempty(job.remoteJobId);
  const sourceArtifactId = nonempty(job.sourceArtifactId);
  const createdAt = nonempty(job.createdAt);
  if (!status || !remoteJobId || !sourceArtifactId || !createdAt) return null;
  return {
    remoteJobId,
    sourceArtifactId,
    localTopDownVersionId: nonempty(job.localTopDownVersionId),
    status,
    resultArtifactId: nullable(job.resultArtifactId),
    errorCode: nullable(job.errorCode),
    errorSummary: nullable(job.errorSummary),
    createdAt,
    startedAt: nullable(job.startedAt),
    finishedAt: nullable(job.finishedAt),
    updatedAt: nonempty(job.updatedAt, createdAt),
    actor: nonempty(job.actor, "Unknown operator"),
  };
}

function emptyStore(): MappingArtifactWorkbenchStore {
  return { schemaVersion: 1, updatedAt: nowIso(), publications: [], generationJobs: [], selections: { topDownWithPublisherIdsArtifactId: null, bottomUpArtifactId: null }, activity: [] };
}

export async function readMappingArtifactStore(): Promise<MappingArtifactWorkbenchStore> {
  try {
    const candidate = JSON.parse(await fs.readFile(STORAGE_PATH, "utf-8")) as Partial<MappingArtifactWorkbenchStore>;
    return {
      ...emptyStore(),
      ...candidate,
      schemaVersion: 1,
      publications: Array.isArray(candidate.publications) ? candidate.publications : [],
      generationJobs: Array.isArray(candidate.generationJobs) ? candidate.generationJobs.map(normalizeGenerationJob).filter((job): job is StoredTopDownEnrichmentJob => Boolean(job)) : [],
      selections: { ...emptyStore().selections, ...candidate.selections },
      activity: Array.isArray(candidate.activity) ? candidate.activity : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function writeStore(store: MappingArtifactWorkbenchStore) {
  await fs.mkdir(path.dirname(STORAGE_PATH), { recursive: true });
  const next = { ...store, updatedAt: nowIso() };
  const temp = `${STORAGE_PATH}.${randomUUID()}.tmp`;
  const prior = globalThis.__mappingArtifactStoreWrite ?? Promise.resolve();
  const write = prior.then(async () => {
    await fs.writeFile(temp, JSON.stringify(next, null, 2), "utf-8");
    await fs.rename(temp, STORAGE_PATH);
  });
  globalThis.__mappingArtifactStoreWrite = write.catch(() => undefined);
  await write;
}

export async function mutateMappingArtifactStore<T>(mutator: (store: MappingArtifactWorkbenchStore) => T | Promise<T>) {
  const store = await readMappingArtifactStore();
  const result = await mutator(store);
  await writeStore(store);
  return result;
}

export function createIntegrationLog(
  action: string,
  actor: string,
  targetType: string,
  targetId: string,
  detail: string,
): MappingArtifactIntegrationLog {
  return { id: randomUUID(), action, actor, targetType, targetId, detail, createdAt: nowIso() };
}

export async function savePublicationReceipt(receipt: MappingArtifactPublicationReceipt) {
  return mutateMappingArtifactStore((store) => {
    store.publications = [receipt, ...store.publications.filter((item) => !(item.workflow === receipt.workflow && item.localVersionId === receipt.localVersionId && item.localChecksumSha256 === receipt.localChecksumSha256))];
    store.activity.unshift(createIntegrationLog("mapping_artifact_published", receipt.publishedBy, "mapping_artifact", receipt.remoteArtifactId, `Published ${receipt.workflow} saved version ${receipt.localVersionId}.`));
    store.activity = store.activity.slice(0, 250);
  });
}

export async function saveGenerationJob(
  input: StoredTopDownEnrichmentJob,
  actor: string,
) {
  return mutateMappingArtifactStore((store) => {
    store.generationJobs = [input, ...store.generationJobs.filter((item) => item.remoteJobId !== input.remoteJobId)];
    store.activity.unshift(createIntegrationLog("top_down_enrichment_started", actor, "mapping_artifact_job", input.remoteJobId, `Started enrichment for artifact ${input.sourceArtifactId}.`));
    store.activity = store.activity.slice(0, 250);
  });
}

export async function updateGenerationJob(
  jobId: string,
  changes: Partial<StoredTopDownEnrichmentJob>,
) {
  return mutateMappingArtifactStore((store) => {
    const job = store.generationJobs.find((item) => item.remoteJobId === jobId);
    if (!job) return null;
    Object.assign(job, changes, { updatedAt: nowIso() });
    return job;
  });
}

export function publicGenerationJob(job: StoredTopDownEnrichmentJob): MappingArtifactJob {
  return {
    id: job.remoteJobId,
    job_type: "top_down_publisher_ids",
    status: job.status,
    result_artifact_id: job.resultArtifactId,
    error_code: job.errorCode,
    error_summary: job.errorSummary,
    created_at: job.createdAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
  };
}

function terminalActivity(status: MappingArtifactJobStatus) {
  if (status === "success") return "top_down_enrichment_succeeded";
  if (status === "failed") return "top_down_enrichment_failed";
  return "top_down_enrichment_interrupted";
}

/** Persist the latest remote status and add a terminal audit entry once only. */
export async function reconcileGenerationJob(
  remote: MappingArtifactJob,
  actor?: string,
) {
  return mutateMappingArtifactStore((store) => {
    const job = store.generationJobs.find((item) => item.remoteJobId === remote.id);
    if (!job) return null;
    const previousStatus = job.status;
    Object.assign(job, {
      status: remote.status,
      resultArtifactId: remote.result_artifact_id,
      errorCode: remote.error_code,
      errorSummary: remote.error_summary,
      createdAt: remote.created_at,
      startedAt: remote.started_at,
      finishedAt: remote.finished_at,
      updatedAt: nowIso(),
    });
    if (isTerminalEnrichmentJobStatus(remote.status) && previousStatus !== remote.status) {
      const resolvedActor = actor || job.actor;
      store.activity.unshift(createIntegrationLog(
        terminalActivity(remote.status),
        resolvedActor,
        "mapping_artifact_job",
        job.remoteJobId,
        remote.status === "success"
          ? `Enrichment produced artifact ${remote.result_artifact_id}.`
          : `Enrichment ${remote.status}${remote.error_summary ? `: ${remote.error_summary}` : "."}`,
      ));
      store.activity = store.activity.slice(0, 250);
    }
    return job;
  });
}

export async function recordGenerationJobReuse(job: StoredTopDownEnrichmentJob, actor: string) {
  return mutateMappingArtifactStore((store) => {
    store.activity.unshift(createIntegrationLog(
      "top_down_enrichment_reused",
      actor,
      "mapping_artifact_job",
      job.remoteJobId,
      `Reconnected to ${job.status} enrichment for artifact ${job.sourceArtifactId}.`,
    ));
    store.activity = store.activity.slice(0, 250);
  });
}

export async function interruptMissingGenerationJob(job: StoredTopDownEnrichmentJob, actor: string) {
  const interrupted: MappingArtifactJob = {
    ...publicGenerationJob(job),
    status: "interrupted",
    error_code: "remote_job_missing",
    error_summary: "The SensorTower job record is no longer available. Start enrichment again.",
    finished_at: nowIso(),
  };
  return reconcileGenerationJob(interrupted, actor);
}

export async function setArtifactSelections(selections: Partial<MappingArtifactWorkbenchStore["selections"]>) {
  return mutateMappingArtifactStore((store) => {
    store.selections = { ...store.selections, ...selections };
  });
}
