import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  MappingArtifactIntegrationLog,
  MappingArtifactPublicationReceipt,
  MappingArtifactWorkbenchStore,
} from "@/lib/mapping-artifacts/types";

const STORAGE_PATH = path.join(process.cwd(), "storage", "mapping-artifact-workbench.json");
declare global { var __mappingArtifactStoreWrite: Promise<void> | undefined; }

function nowIso() { return new Date().toISOString(); }
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
      generationJobs: Array.isArray(candidate.generationJobs) ? candidate.generationJobs : [],
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
  input: MappingArtifactWorkbenchStore["generationJobs"][number],
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
  changes: Partial<MappingArtifactWorkbenchStore["generationJobs"][number]>,
) {
  return mutateMappingArtifactStore((store) => {
    const job = store.generationJobs.find((item) => item.remoteJobId === jobId);
    if (job) Object.assign(job, changes, { updatedAt: nowIso() });
  });
}

export async function setArtifactSelections(selections: Partial<MappingArtifactWorkbenchStore["selections"]>) {
  return mutateMappingArtifactStore((store) => {
    store.selections = { ...store.selections, ...selections };
  });
}
