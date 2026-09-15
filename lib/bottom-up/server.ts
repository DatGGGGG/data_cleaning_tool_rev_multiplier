import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { getEffectiveAppSettings } from "@/lib/app-settings/server";
import { getTopDownWorkbenchState } from "@/lib/top-down/server";
import type {
  BottomUpActivityLogEntry,
  BottomUpAppCandidate,
  BottomUpPublisherCandidate,
  BottomUpProductionLoadSummary,
  BottomUpProductionSyncState,
  BottomUpRowDraft,
  BottomUpStep1FilterRule,
  BottomUpStep1PublisherRow,
  BottomUpStep1SortField,
  BottomUpVersionMetadata,
  BottomUpVersionSnapshot,
  BottomUpWorkbenchState,
} from "@/lib/bottom-up/types";
import {
  buildBottomUpCsv,
  importBottomUpRowsFromCsv,
  normalizeBottomUpRow,
  normalizeBottomUpRows,
  normalizeText,
  upsertRowsByPublisherId,
} from "@/lib/bottom-up/workbench";
import { getCsvIntegrity, VersionNotFoundError } from "@/lib/version-api";

const STORAGE_ROOT = path.join(process.cwd(), "storage");
const IMPORTS_DIR = path.join(STORAGE_ROOT, "imports");
const EXPORTS_DIR = path.join(STORAGE_ROOT, "exports");
const STORE_PATH = path.join(STORAGE_ROOT, "bottom-up-workbench.json");
const STORE_TEMP_PATH = path.join(STORAGE_ROOT, "bottom-up-workbench.json.tmp");
const JOBS_DIR = path.join(STORAGE_ROOT, "jobs");
const PRODUCTION_SYNC_STATE_PATH = path.join(JOBS_DIR, "bottom-up-production-sync.json");
const PRODUCTION_SYNC_STATE_TEMP_PATH = path.join(JOBS_DIR, "bottom-up-production-sync.json.tmp");
const PRODUCTION_SYNC_JOBS_DIR = path.join(JOBS_DIR, "bottom-up-production");
const MAX_PUBLISHER_HOVER_APPS = 30;
const LOCAL_MANUAL_SEED_PATH =
  process.env.BOTTOM_UP_SEED_CSV ||
  "D:\\Coding\\vn_strategy_data_system\\manual\\mapping_publisher_to_publisherids_revenue_multiplier_bottom_up_current.csv";
const PRODUCTION_APP_FULL_INFO_PATH =
  process.env.APP_FULL_INFO_CURRENT_NDJSON ||
  "D:\\Coding\\vn_strategy_data_system\\data\\base\\st_api_app_full_info_current.ndjson";
const DATASET_ID = "bottom_up_dataset";
const MAX_LOG_COUNT = 160;
const MAX_APP_CANDIDATE_PREVIEW_COUNT = 500;

declare global {
  // eslint-disable-next-line no-var
  var __bottomUpStoreWritePromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __bottomUpProductionSyncPromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __bottomUpProductionSyncStateWritePromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __bottomUpStoreMutationPromise: Promise<void> | undefined;
}

type PersistedVersion = BottomUpVersionSnapshot & {
  rows: BottomUpRowDraft[];
};

type PersistedArtifact = {
  id: string;
  kind: "import_csv" | "export_csv";
  originalName: string;
  storagePath: string;
  mimeType: string;
  createdAt: string;
  createdBy: string;
};

type PersistedStore = {
  datasetId: string;
  datasetName: string;
  createdAt: string;
  updatedAt: string;
  rows: BottomUpRowDraft[];
  checkedPublisherNames: string[];
  appCandidates: BottomUpAppCandidate[];
  appCandidateCount: number;
  publisherCandidates: BottomUpPublisherCandidate[];
  publisherCandidateCount: number;
  versions: PersistedVersion[];
  logs: BottomUpActivityLogEntry[];
  artifacts: PersistedArtifact[];
  productionSync: BottomUpProductionSyncState;
};

type ProductionAppFullInfoRecord = {
  publisher_id?: unknown;
  publisher_name?: unknown;
  valid_countries?: unknown;
  top_countries?: unknown;
  publisher_country?: unknown;
};

type ProductionPublisherCandidate = {
  publisherId: string;
  publisherName: string;
};

type ProductionSyncSummary = {
  sourcePath: string;
  sourceType: "api" | "file";
  scannedRecords: number;
  invalidJsonRecords: number;
  relatedAppRecords: number;
  candidateRows: number;
  replacedCount: number;
  insertedCount: number;
  needsReviewCount: number;
};

type ProductionReadSettings = {
  bottomUpProductionSource: string;
  strategyDataApiBaseUrl: string;
  strategyDataApiKey: string;
  strategyDataApiPageSize: number;
  appFullInfoCurrentNdjson: string;
};

type ProductionCheckpointPage = {
  offset: number;
  rows: ProductionAppFullInfoRecord[];
};

type ProductionCheckpointContext = {
  jobId: string;
  nextOffset: number;
  checkpointDirectory: string;
  update: (progress: ProductionProgress, nextOffset: number) => Promise<void>;
};

type ProductionProgress = Pick<
  BottomUpProductionSyncState,
  "stage" | "pagesRead" | "scannedRecords" | "expectedRecordCount" | "sourceType"
>;

type ProductionProgressReporter = (progress: ProductionProgress) => Promise<void>;

function nowIso() {
  return new Date().toISOString();
}

function createProductionSyncState(): BottomUpProductionSyncState {
  const timestamp = nowIso();
  return {
    status: "idle",
    stage: "Not started",
    message: "App Full Info has not been loaded from production yet.",
    startedAt: "",
    updatedAt: timestamp,
    completedAt: "",
    pagesRead: 0,
    scannedRecords: 0,
    expectedRecordCount: 0,
    sourceType: "",
  };
}

function createEntityId(prefix = "id") {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createLog(
  action: string,
  actor: string,
  targetType: string,
  targetId: string,
  detail: string,
): BottomUpActivityLogEntry {
  return {
    id: createEntityId("log"),
    action,
    actor,
    targetType,
    targetId,
    detail,
    createdAt: nowIso(),
  };
}

async function ensureStorageDirectories() {
  await fs.mkdir(IMPORTS_DIR, { recursive: true });
  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.mkdir(PRODUCTION_SYNC_JOBS_DIR, { recursive: true });
}

async function readSeedRows() {
  try {
    const settings = await getEffectiveAppSettings();
    const raw = await fs.readFile(settings.bottomUpSeedCsv || LOCAL_MANUAL_SEED_PATH, "utf-8");
    return importBottomUpRowsFromCsv(raw).map((row, index) =>
      normalizeBottomUpRow({ ...row, reviewStatus: "seeded" }, index + 1),
    );
  } catch {
    return [];
  }
}

async function createInitialStore(): Promise<PersistedStore> {
  const seedRows = await readSeedRows();
  return {
    datasetId: DATASET_ID,
    datasetName: "Mapping Publisher to Publisher ID and Revenue Multiplier (Bottom Up)",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    rows: seedRows,
    checkedPublisherNames: [],
    appCandidates: [],
    appCandidateCount: 0,
    publisherCandidates: [],
    publisherCandidateCount: 0,
    versions: [],
    logs: [
      createLog(
        "initialize_dataset",
        "system",
        "dataset",
        DATASET_ID,
        seedRows.length > 0
          ? `Created the bottom-up workflow and loaded ${seedRows.length} rows from the local manual seed CSV.`
          : "Created the bottom-up publisher ID and revenue multiplier workflow.",
      ),
    ],
    artifacts: [],
    productionSync: createProductionSyncState(),
  };
}

function normalizeProductionSyncState(value: unknown): BottomUpProductionSyncState {
  const fallback = createProductionSyncState();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<BottomUpProductionSyncState>;
  const status =
    candidate.status === "queued" || candidate.status === "running" || candidate.status === "succeeded" || candidate.status === "failed"
      ? candidate.status
      : "idle";
  const normalizedNumber = (input: unknown) => {
    const numeric = Number(input);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  };

  const summary =
    candidate.summary && typeof candidate.summary === "object"
      ? {
          candidateRows: normalizedNumber(candidate.summary.candidateRows),
          replacedCount: normalizedNumber(candidate.summary.replacedCount),
          insertedCount: normalizedNumber(candidate.summary.insertedCount),
          needsReviewCount: normalizedNumber(candidate.summary.needsReviewCount),
        }
      : undefined;
  const lastSuccessfulLoad: BottomUpProductionLoadSummary | undefined =
    candidate.lastSuccessfulLoad && typeof candidate.lastSuccessfulLoad === "object"
      ? {
          completedAt: normalizeText(candidate.lastSuccessfulLoad.completedAt),
          sourceType:
            candidate.lastSuccessfulLoad.sourceType === "api" || candidate.lastSuccessfulLoad.sourceType === "file"
              ? candidate.lastSuccessfulLoad.sourceType
              : ("" as const),
          scannedRecords: normalizedNumber(candidate.lastSuccessfulLoad.scannedRecords),
          relatedAppRecords: normalizedNumber(candidate.lastSuccessfulLoad.relatedAppRecords),
          candidateRows: normalizedNumber(candidate.lastSuccessfulLoad.candidateRows),
          publisherCandidateCount: normalizedNumber(candidate.lastSuccessfulLoad.publisherCandidateCount),
          replacedCount: normalizedNumber(candidate.lastSuccessfulLoad.replacedCount),
          insertedCount: normalizedNumber(candidate.lastSuccessfulLoad.insertedCount),
          needsReviewCount: normalizedNumber(candidate.lastSuccessfulLoad.needsReviewCount),
        }
      : status === "succeeded" && normalizeText(candidate.completedAt)
        ? {
            completedAt: normalizeText(candidate.completedAt),
            sourceType: candidate.sourceType === "api" || candidate.sourceType === "file" ? candidate.sourceType : ("" as const),
            scannedRecords: normalizedNumber(candidate.scannedRecords),
            relatedAppRecords: 0,
            candidateRows: normalizedNumber(candidate.summary?.candidateRows),
            publisherCandidateCount: 0,
            replacedCount: normalizedNumber(candidate.summary?.replacedCount),
            insertedCount: normalizedNumber(candidate.summary?.insertedCount),
            needsReviewCount: normalizedNumber(candidate.summary?.needsReviewCount),
          }
        : undefined;

  return {
    status,
    stage: normalizeText(candidate.stage) || fallback.stage,
    message: normalizeText(candidate.message) || fallback.message,
    startedAt: normalizeText(candidate.startedAt),
    updatedAt: normalizeText(candidate.updatedAt) || fallback.updatedAt,
    completedAt: normalizeText(candidate.completedAt),
    pagesRead: normalizedNumber(candidate.pagesRead),
    scannedRecords: normalizedNumber(candidate.scannedRecords),
    expectedRecordCount: normalizedNumber(candidate.expectedRecordCount),
    sourceType: candidate.sourceType === "api" || candidate.sourceType === "file" ? candidate.sourceType : "",
    jobId: normalizeText(candidate.jobId),
    nextOffset: normalizedNumber(candidate.nextOffset),
    heartbeatAt: normalizeText(candidate.heartbeatAt),
    lastSuccessfulLoad,
    summary,
  };
}

function normalizeLog(value: unknown): BottomUpActivityLogEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BottomUpActivityLogEntry>;
  const action = normalizeText(candidate.action);
  if (!action) {
    return null;
  }

  return {
    id: normalizeText(candidate.id) || createEntityId("log"),
    action,
    actor: normalizeText(candidate.actor) || "system",
    targetType: normalizeText(candidate.targetType) || "dataset",
    targetId: normalizeText(candidate.targetId) || DATASET_ID,
    detail: normalizeText(candidate.detail),
    createdAt: normalizeText(candidate.createdAt) || nowIso(),
  };
}

function normalizeArtifact(value: unknown): PersistedArtifact | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PersistedArtifact>;
  const kind = candidate.kind === "import_csv" || candidate.kind === "export_csv" ? candidate.kind : null;
  if (!kind) {
    return null;
  }

  return {
    id: normalizeText(candidate.id) || createEntityId("artifact"),
    kind,
    originalName: normalizeText(candidate.originalName),
    storagePath: normalizeText(candidate.storagePath),
    mimeType: normalizeText(candidate.mimeType),
    createdAt: normalizeText(candidate.createdAt) || nowIso(),
    createdBy: normalizeText(candidate.createdBy) || "system",
  };
}

function normalizeVersion(value: unknown, index: number): PersistedVersion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PersistedVersion> & { rows?: unknown };
  const rows = normalizeBottomUpRows(candidate.rows);

  return {
    id: normalizeText(candidate.id) || createEntityId("version"),
    label: normalizeText(candidate.label) || `Snapshot ${index + 1}`,
    createdAt: normalizeText(candidate.createdAt) || nowIso(),
    createdBy: normalizeText(candidate.createdBy) || "system",
    rowCount:
      typeof candidate.rowCount === "number" && Number.isFinite(candidate.rowCount)
        ? candidate.rowCount
        : rows.length,
    rows,
  };
}

function normalizeStore(value: unknown): PersistedStore {
  if (!value || typeof value !== "object") {
    return {
      datasetId: DATASET_ID,
      datasetName: "Mapping Publisher to Publisher ID and Revenue Multiplier (Bottom Up)",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      rows: [],
      checkedPublisherNames: [],
      appCandidates: [],
      appCandidateCount: 0,
      publisherCandidates: [],
      publisherCandidateCount: 0,
      versions: [],
      logs: [],
      artifacts: [],
      productionSync: createProductionSyncState(),
    };
  }

  const candidate = value as Partial<PersistedStore> & {
    rows?: unknown;
    checkedPublisherNames?: unknown;
    appCandidates?: unknown;
    appCandidateCount?: unknown;
    publisherCandidates?: unknown;
    publisherCandidateCount?: unknown;
    versions?: unknown;
    logs?: unknown;
    artifacts?: unknown;
    productionSync?: unknown;
  };
  const normalizedRows = normalizeBottomUpRows(candidate.rows);
  const safeRows = normalizedRows.length > 5000 ? normalizedRows.filter(shouldKeepBottomUpRow) : normalizedRows;
  const normalizedLogs = Array.isArray(candidate.logs)
    ? candidate.logs.map((entry) => normalizeLog(entry)).filter((entry): entry is BottomUpActivityLogEntry => Boolean(entry))
    : [];
  const previousSuccessfulSync = normalizedLogs.find((entry) => entry.action === "sync_bottom_up_from_production");
  const productionSync = candidate.productionSync
    ? normalizeProductionSyncState(candidate.productionSync)
    : previousSuccessfulSync
      ? {
          status: "succeeded" as const,
          stage: "Completed",
          message: previousSuccessfulSync.detail || "App Full Info was loaded from production.",
          startedAt: previousSuccessfulSync.createdAt,
          updatedAt: previousSuccessfulSync.createdAt,
          completedAt: previousSuccessfulSync.createdAt,
          pagesRead: 0,
          scannedRecords: 0,
          expectedRecordCount: 0,
          sourceType: "" as const,
        }
      : createProductionSyncState();

  return {
    datasetId: normalizeText(candidate.datasetId) || DATASET_ID,
    datasetName:
      normalizeText(candidate.datasetName) ||
      "Mapping Publisher to Publisher ID and Revenue Multiplier (Bottom Up)",
    createdAt: normalizeText(candidate.createdAt) || nowIso(),
    updatedAt: normalizeText(candidate.updatedAt) || nowIso(),
    rows: safeRows.map((row, index) => normalizeBottomUpRow(row, index + 1)),
    checkedPublisherNames: Array.isArray(candidate.checkedPublisherNames)
      ? [...new Set(candidate.checkedPublisherNames.map(normalizeText).filter(Boolean))].sort((left, right) =>
          left.localeCompare(right, undefined, { sensitivity: "base" }),
        )
      : [],
    appCandidates: normalizeBottomUpAppCandidates(candidate.appCandidates).slice(0, MAX_APP_CANDIDATE_PREVIEW_COUNT),
    appCandidateCount:
      typeof candidate.appCandidateCount === "number" && Number.isFinite(candidate.appCandidateCount)
        ? candidate.appCandidateCount
        : Array.isArray(candidate.appCandidates)
          ? candidate.appCandidates.length
          : 0,
    publisherCandidates: normalizeBottomUpPublisherCandidates(candidate.publisherCandidates),
    publisherCandidateCount:
      typeof candidate.publisherCandidateCount === "number" && Number.isFinite(candidate.publisherCandidateCount)
        ? candidate.publisherCandidateCount
        : Array.isArray(candidate.publisherCandidates)
          ? candidate.publisherCandidates.length
          : 0,
    versions: Array.isArray(candidate.versions)
      ? candidate.versions
          .map((version, index) => normalizeVersion(version, index))
          .filter((version): version is PersistedVersion => Boolean(version))
      : [],
    logs: normalizedLogs,
    artifacts: Array.isArray(candidate.artifacts)
      ? candidate.artifacts
          .map((artifact) => normalizeArtifact(artifact))
          .filter((artifact): artifact is PersistedArtifact => Boolean(artifact))
      : [],
    productionSync,
  };
}

function findFirstCompleteJsonObject(raw: string) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (!started) {
      if (/\s/.test(character)) {
        continue;
      }
      if (character !== "{") {
        return null;
      }
      started = true;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(0, index + 1);
      }
    }
  }

  return null;
}

async function readStore(): Promise<PersistedStore> {
  await ensureStorageDirectories();

  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    try {
      const parsed = JSON.parse(raw) as unknown;
      const store = normalizeStore(parsed);
      const parsedStore = parsed as Partial<PersistedStore>;
      const parsedRowCount = Array.isArray(parsedStore.rows) ? parsedStore.rows.length : store.rows.length;
      const parsedCandidateCount = Array.isArray(parsedStore.appCandidates)
        ? parsedStore.appCandidates.length
        : store.appCandidates.length;
      if (parsedRowCount !== store.rows.length || parsedCandidateCount !== store.appCandidates.length) {
        await writeStore(store);
      }
      return store;
    } catch (error) {
      const recoveredJson = findFirstCompleteJsonObject(raw);
      if (!recoveredJson) {
        throw error;
      }
      const recoveredStore = normalizeStore(JSON.parse(recoveredJson));
      appendLogs(recoveredStore, [
        createLog(
          "repair_store_json",
          "system",
          "dataset",
          DATASET_ID,
          "Recovered the bottom-up store after malformed trailing JSON was detected.",
        ),
      ]);
      await writeStore(recoveredStore);
      return recoveredStore;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const initialStore = await createInitialStore();
    await writeStore(initialStore);
    return initialStore;
  }
}

async function writeStore(store: PersistedStore) {
  await ensureStorageDirectories();
  store.updatedAt = nowIso();
  const payload = JSON.stringify(store, null, 2);
  const previousWrite = globalThis.__bottomUpStoreWritePromise ?? Promise.resolve();
  const nextWrite = previousWrite.then(async () => {
    await fs.writeFile(STORE_TEMP_PATH, payload, "utf-8");
    await fs.rename(STORE_TEMP_PATH, STORE_PATH);
  });

  globalThis.__bottomUpStoreWritePromise = nextWrite.catch(() => undefined);
  await nextWrite;
}

async function writeProductionSyncState(state: BottomUpProductionSyncState) {
  await ensureStorageDirectories();
  const payload = JSON.stringify(state, null, 2);
  const previousWrite = globalThis.__bottomUpProductionSyncStateWritePromise ?? Promise.resolve();
  const nextWrite = previousWrite.then(async () => {
    await fs.writeFile(PRODUCTION_SYNC_STATE_TEMP_PATH, payload, "utf-8");
    await fs.rename(PRODUCTION_SYNC_STATE_TEMP_PATH, PRODUCTION_SYNC_STATE_PATH);
  });
  globalThis.__bottomUpProductionSyncStateWritePromise = nextWrite.catch(() => undefined);
  await nextWrite;
}

function getLegacyLastSuccessfulLoad(store: PersistedStore): BottomUpProductionLoadSummary | undefined {
  if (store.productionSync.lastSuccessfulLoad) {
    return store.productionSync.lastSuccessfulLoad;
  }
  if (store.productionSync.status === "succeeded" && store.productionSync.completedAt) {
    return {
      completedAt: store.productionSync.completedAt,
      sourceType: store.productionSync.sourceType,
      scannedRecords: store.productionSync.scannedRecords,
      relatedAppRecords: 0,
      candidateRows: store.productionSync.summary?.candidateRows ?? 0,
      publisherCandidateCount: store.publisherCandidateCount,
      replacedCount: store.productionSync.summary?.replacedCount ?? 0,
      insertedCount: store.productionSync.summary?.insertedCount ?? 0,
      needsReviewCount: store.productionSync.summary?.needsReviewCount ?? 0,
    };
  }
  const completed = store.logs.find((entry) => entry.action === "sync_bottom_up_from_production");
  return completed
    ? {
        completedAt: completed.createdAt,
        sourceType: "",
        scannedRecords: 0,
        relatedAppRecords: 0,
        candidateRows: 0,
        publisherCandidateCount: store.publisherCandidateCount,
        replacedCount: 0,
        insertedCount: 0,
        needsReviewCount: store.rows.filter((row) => row.reviewStatus === "needs_review").length,
      }
    : undefined;
}

async function readProductionSyncState(store?: PersistedStore): Promise<BottomUpProductionSyncState> {
  await ensureStorageDirectories();
  try {
    const state = normalizeProductionSyncState(JSON.parse(await fs.readFile(PRODUCTION_SYNC_STATE_PATH, "utf-8")) as unknown);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const legacyStore = store ?? (await readStore());
  const legacyState = normalizeProductionSyncState(legacyStore.productionSync);
  const migrated: BottomUpProductionSyncState = {
    ...legacyState,
    // An in-memory promise cannot prove that the job failed. Queue it for a safe resume instead.
    status: legacyState.status === "running" ? "queued" : legacyState.status,
    stage: legacyState.status === "running" ? "Waiting to resume production load" : legacyState.stage,
    message:
      legacyState.status === "running"
        ? "A production load was in progress when the workbench restarted. It will resume from its saved checkpoint."
        : legacyState.message,
    lastSuccessfulLoad: getLegacyLastSuccessfulLoad(legacyStore),
  };
  await writeProductionSyncState(migrated);
  return migrated;
}

async function mutateStore<T>(mutator: (store: PersistedStore) => Promise<T> | T): Promise<T> {
  const previous = globalThis.__bottomUpStoreMutationPromise ?? Promise.resolve();
  const next = previous.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  globalThis.__bottomUpStoreMutationPromise = next.then(() => undefined, () => undefined);
  return next;
}

function appendLogs(store: PersistedStore, logs: BottomUpActivityLogEntry[]) {
  if (logs.length === 0) {
    return;
  }

  store.logs = [...logs, ...store.logs].slice(0, MAX_LOG_COUNT);
}

function normalizeBottomUpAppCandidate(value: unknown, index: number): BottomUpAppCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BottomUpAppCandidate>;
  const appId = normalizeText(candidate.appId);
  const publisherName = normalizeText(candidate.publisherName);
  const publisherId = normalizeText(candidate.publisherId);
  if (!appId && !publisherName && !publisherId) {
    return null;
  }

  const hasVnValidCountry = Boolean(candidate.hasVnValidCountry);
  const hasVnTopCountry = Boolean(candidate.hasVnTopCountry);
  const isVietnamPublisherCountry = Boolean(candidate.isVietnamPublisherCountry);

  return {
    id: normalizeText(candidate.id) || `production_app_${index + 1}`,
    appId,
    name: normalizeText(candidate.name),
    publisherName,
    publisherId,
    humanizedName: normalizeText(candidate.humanizedName),
    validCountries: normalizeText(candidate.validCountries),
    topCountries: normalizeText(candidate.topCountries),
    publisherCountry: normalizeText(candidate.publisherCountry),
    hasVnValidCountry,
    hasVnTopCountry,
    isVietnamPublisherCountry,
    relatedToVn: Boolean(candidate.relatedToVn) || hasVnValidCountry || hasVnTopCountry || isVietnamPublisherCountry,
  };
}

function normalizeBottomUpAppCandidates(value: unknown): BottomUpAppCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((candidate, index) => normalizeBottomUpAppCandidate(candidate, index))
    .filter((candidate): candidate is BottomUpAppCandidate => Boolean(candidate));
}

function normalizeBottomUpPublisherCandidate(value: unknown): BottomUpPublisherCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<BottomUpPublisherCandidate>;
  const publisherName = normalizeText(candidate.publisherName);
  if (!publisherName) {
    return null;
  }

  return {
    publisherName,
    publisherIds: Array.isArray(candidate.publisherIds)
      ? candidate.publisherIds.map(normalizeText).filter(Boolean)
      : [],
    appCount: typeof candidate.appCount === "number" && Number.isFinite(candidate.appCount) ? candidate.appCount : 0,
    apps: Array.isArray(candidate.apps)
      ? candidate.apps
          .map((app) => {
            if (!app || typeof app !== "object") {
              return null;
            }
            const normalizedApp = app as { appId?: unknown; name?: unknown };
            const appId = normalizeText(normalizedApp.appId);
            const name = normalizeText(normalizedApp.name);
            return appId || name ? { appId, name } : null;
          })
          .filter((app): app is { appId: string; name: string } => Boolean(app))
      : [],
  };
}

function normalizeBottomUpPublisherCandidates(value: unknown): BottomUpPublisherCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((candidate) => normalizeBottomUpPublisherCandidate(candidate))
    .filter((candidate): candidate is BottomUpPublisherCandidate => Boolean(candidate));
}

function buildPublisherCandidates(appCandidates: BottomUpAppCandidate[]): BottomUpPublisherCandidate[] {
  const byPublisherName = new Map<
    string,
    {
      publisherName: string;
      publisherIds: Set<string>;
      appCount: number;
      apps: Map<string, { appId: string; name: string }>;
    }
  >();

  for (const candidate of appCandidates) {
    const publisherName = candidate.publisherName.trim();
    if (!publisherName) {
      continue;
    }

    const existing = byPublisherName.get(publisherName) ?? {
      publisherName,
      publisherIds: new Set<string>(),
      appCount: 0,
      apps: new Map<string, { appId: string; name: string }>(),
    };
    if (candidate.publisherId) {
      existing.publisherIds.add(candidate.publisherId);
    }
    if (candidate.appId || candidate.name) {
      existing.apps.set(candidate.appId || candidate.name, {
        appId: candidate.appId,
        name: candidate.name,
      });
    }
    existing.appCount += 1;
    byPublisherName.set(publisherName, existing);
  }

  return [...byPublisherName.values()]
    .map((candidate) => ({
      publisherName: candidate.publisherName,
      publisherIds: [...candidate.publisherIds].sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
      ),
      appCount: candidate.appCount,
      apps: [...candidate.apps.values()]
        .sort((left, right) =>
          (left.name || left.appId).localeCompare(right.name || right.appId, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        )
        .slice(0, MAX_PUBLISHER_HOVER_APPS),
    }))
    .sort((left, right) => left.publisherName.localeCompare(right.publisherName, undefined, { sensitivity: "base" }));
}

function normalizeCountryCode(value: unknown) {
  return normalizeText(value).replaceAll("\"", "").toUpperCase();
}

function toCountryList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(normalizeCountryCode).filter(Boolean);
  }

  const text = normalizeText(value);
  if (!text) {
    return [];
  }

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeCountryCode).filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return text.split(",").map(normalizeCountryCode).filter(Boolean);
}

function isVietnamRelatedApp(record: ProductionAppFullInfoRecord) {
  const validCountries = toCountryList(record.valid_countries);
  const topCountries = toCountryList(record.top_countries);
  const publisherCountry = normalizeText(record.publisher_country).toLowerCase();

  return validCountries.includes("VN") || topCountries.includes("VN") || publisherCountry.includes("vietnam");
}

function createAppCandidate(record: ProductionAppFullInfoRecord, index: number): BottomUpAppCandidate {
  const validCountries = toCountryList(record.valid_countries);
  const topCountries = toCountryList(record.top_countries);
  const publisherCountry = normalizeText(record.publisher_country);
  const hasVnValidCountry = validCountries.includes("VN");
  const hasVnTopCountry = topCountries.includes("VN");
  const isVietnamPublisherCountry = publisherCountry.toLowerCase().includes("vietnam");

  return {
    id: `production_app_${index + 1}`,
    appId: normalizeText((record as { app_id?: unknown }).app_id),
    name: normalizeText((record as { name?: unknown }).name),
    publisherName: normalizeText(record.publisher_name),
    publisherId: normalizeText(record.publisher_id),
    humanizedName: normalizeText((record as { humanized_name?: unknown }).humanized_name),
    validCountries: JSON.stringify(validCountries),
    topCountries: JSON.stringify(topCountries),
    publisherCountry,
    hasVnValidCountry,
    hasVnTopCountry,
    isVietnamPublisherCountry,
    relatedToVn: hasVnValidCountry || hasVnTopCountry || isVietnamPublisherCountry,
  };
}

function buildReferenceLookups(rows: BottomUpRowDraft[]) {
  const byPublisherId = new Map<string, BottomUpRowDraft>();
  const byPublisherName = new Map<string, BottomUpRowDraft>();

  for (const row of rows) {
    const publisherId = normalizeText(row.publisherId);
    const publisherName = normalizeText(row.publisherName).toLowerCase();
    if (publisherId) {
      byPublisherId.set(publisherId, row);
    }
    if (publisherName && !byPublisherName.has(publisherName)) {
      byPublisherName.set(publisherName, row);
    }
  }

  return { byPublisherId, byPublisherName };
}

async function readManualReferenceRows() {
  try {
    const raw = await fs.readFile(LOCAL_MANUAL_SEED_PATH, "utf-8");
    return importBottomUpRowsFromCsv(raw);
  } catch {
    return [];
  }
}

async function readProductionPublisherCandidates(
  reportProgress?: ProductionProgressReporter,
  checkpoint?: ProductionCheckpointContext,
) {
  const settings = await getEffectiveAppSettings();
  const source = settings.bottomUpProductionSource;
  const hasApiSettings = Boolean(settings.strategyDataApiBaseUrl && settings.strategyDataApiKey);

  if (source === "api") {
    if (!hasApiSettings) {
      throw new Error("Production source is set to API only, but the Strategy Data API URL or API key is missing in Settings.");
    }
    return readProductionPublisherCandidatesFromApi(settings, reportProgress, checkpoint);
  }

  if (source === "auto" && hasApiSettings) {
    return readProductionPublisherCandidatesFromApi(settings, reportProgress, checkpoint);
  }

  return readProductionPublisherCandidatesFromFile(settings, reportProgress);
}

type StrategyDataQueryResponse<T> = {
  rows?: T[];
  row_count?: number;
  detail?: string;
};

async function queryStrategyDataApi<T = ProductionAppFullInfoRecord>(sql: string, settings: ProductionReadSettings) {
  const baseUrl = settings.strategyDataApiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": settings.strategyDataApiKey,
    },
    body: JSON.stringify({ sql, max_rows: settings.strategyDataApiPageSize }),
  });
  const raw = await response.text();
  let payload: StrategyDataQueryResponse<T> = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as StrategyDataQueryResponse<T>;
    } catch {
      throw new Error(`Strategy Data API returned a non-JSON response with HTTP ${response.status}.`);
    }
  }

  if (!response.ok) {
    throw new Error(payload.detail || `Strategy Data API query failed with HTTP ${response.status}.`);
  }

  return payload.rows ?? [];
}

const PRODUCTION_APP_FULL_INFO_WHERE = `
  publisher_name IS NOT NULL
  AND publisher_name <> ''
  AND publisher_name <> '#NAME?'
  AND (
    valid_countries @> '["VN"]'::jsonb
    OR top_countries @> '["VN"]'::jsonb
    OR publisher_country ILIKE '%Vietnam%'
  )
`;

async function readProductionPublisherCandidatesFromApi(
  settings: ProductionReadSettings,
  reportProgress?: ProductionProgressReporter,
  checkpoint?: ProductionCheckpointContext,
) {
  const candidates = new Map<string, ProductionPublisherCandidate>();
  const appCandidates: BottomUpAppCandidate[] = [];
  let scannedRecords = 0;
  let offset = checkpoint?.nextOffset ?? 0;
  let pagesRead = 0;

  if (checkpoint) {
    const cachedPages = await readProductionCheckpointPages(checkpoint.checkpointDirectory);
    const contiguousPages: ProductionCheckpointPage[] = [];
    let contiguousOffset = 0;
    for (const page of cachedPages) {
      if (page.offset !== contiguousOffset) {
        break;
      }
      contiguousPages.push(page);
      contiguousOffset += page.rows.length;
      if (page.rows.length < settings.strategyDataApiPageSize) {
        break;
      }
    }
    // The saved offset is trusted only when every preceding page exists. Otherwise resume from the safe prefix.
    offset = Math.min(offset, contiguousOffset);
    for (const page of contiguousPages.filter((page) => page.offset < offset)) {
      for (const record of page.rows) {
        const publisherId = normalizeText(record.publisher_id);
        const publisherName = normalizeText(record.publisher_name);
        if (!publisherId || !publisherName) {
          continue;
        }
        appCandidates.push(createAppCandidate(record, appCandidates.length));
        if (!candidates.has(publisherId)) {
          candidates.set(publisherId, { publisherId, publisherName });
        }
      }
      scannedRecords += page.rows.length;
      pagesRead += 1;
    }
  }

  await reportProgress?.({
    stage: "Counting VN-related App Full Info rows",
    pagesRead,
    scannedRecords,
    expectedRecordCount: 0,
    sourceType: "api",
  });
  const countRows = await queryStrategyDataApi<{ total_records?: unknown }>(
    `SELECT COUNT(*)::text AS total_records FROM core.dim_app_info WHERE ${PRODUCTION_APP_FULL_INFO_WHERE}`,
    settings,
  );
  const expectedRecordCount = Math.max(0, Number(countRows[0]?.total_records) || 0);

  while (true) {
    const sql = `
      SELECT
        app_id,
        name,
        publisher_name,
        publisher_id,
        humanized_name,
        valid_countries::text AS valid_countries,
        top_countries::text AS top_countries,
        publisher_country
      FROM core.dim_app_info
      WHERE ${PRODUCTION_APP_FULL_INFO_WHERE}
      ORDER BY app_id
      LIMIT ${settings.strategyDataApiPageSize}
      OFFSET ${offset}
    `;
    const rows = await queryStrategyDataApi(sql, settings);
    if (checkpoint) {
      await writeProductionCheckpointPage(checkpoint.checkpointDirectory, offset, rows);
    }
    scannedRecords += rows.length;
    pagesRead += 1;

    for (const record of rows) {
      const publisherId = normalizeText(record.publisher_id);
      const publisherName = normalizeText(record.publisher_name);
      if (!publisherId || !publisherName) {
        continue;
      }

      appCandidates.push(createAppCandidate(record, appCandidates.length));
      if (!candidates.has(publisherId)) {
        candidates.set(publisherId, { publisherId, publisherName });
      }
    }

    const progress = {
      stage: "Reading App Full Info pages",
      pagesRead,
      scannedRecords,
      expectedRecordCount,
      sourceType: "api" as const,
    };
    const nextOffset = offset + rows.length;
    await reportProgress?.(progress);
    await checkpoint?.update(progress, nextOffset);

    if (rows.length < settings.strategyDataApiPageSize) {
      break;
    }

    offset += settings.strategyDataApiPageSize;
  }

  await reportProgress?.({
    stage: "Processing production App Full Info rows",
    pagesRead,
    scannedRecords,
    expectedRecordCount,
    sourceType: "api",
  });

  return {
    candidates: [...candidates.values()],
    appCandidates,
    sourceType: "api" as const,
    sourcePath: settings.strategyDataApiBaseUrl,
    scannedRecords,
    invalidJsonRecords: 0,
    relatedAppRecords: appCandidates.length,
  };
}

function checkpointPagePath(directory: string, offset: number) {
  return path.join(directory, `page-${String(offset).padStart(12, "0")}.json`);
}

async function writeProductionCheckpointPage(directory: string, offset: number, rows: ProductionAppFullInfoRecord[]) {
  await fs.mkdir(directory, { recursive: true });
  const targetPath = checkpointPagePath(directory, offset);
  const temporaryPath = `${targetPath}.tmp`;
  const payload: ProductionCheckpointPage = { offset, rows };
  await fs.writeFile(temporaryPath, JSON.stringify(payload), "utf-8");
  await fs.rename(temporaryPath, targetPath);
}

async function readProductionCheckpointPages(directory: string): Promise<ProductionCheckpointPage[]> {
  try {
    const names = (await fs.readdir(directory)).filter((name) => /^page-\d+\.json$/.test(name)).sort();
    const pages: ProductionCheckpointPage[] = [];
    for (const name of names) {
      const page = JSON.parse(await fs.readFile(path.join(directory, name), "utf-8")) as Partial<ProductionCheckpointPage>;
      if (typeof page.offset !== "number" || !Array.isArray(page.rows)) {
        continue;
      }
      pages.push({ offset: page.offset, rows: page.rows as ProductionAppFullInfoRecord[] });
    }
    return pages.sort((left, right) => left.offset - right.offset);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readProductionPublisherCandidatesFromFile(
  settings: ProductionReadSettings,
  reportProgress?: ProductionProgressReporter,
) {
  const candidates = new Map<string, ProductionPublisherCandidate>();
  const appCandidates: BottomUpAppCandidate[] = [];
  let scannedRecords = 0;
  let invalidJsonRecords = 0;
  let relatedAppRecords = 0;

  await reportProgress?.({
    stage: "Reading local App Full Info file",
    pagesRead: 0,
    scannedRecords,
    expectedRecordCount: 0,
    sourceType: "file",
  });

  const lineReader = createInterface({
    input: createReadStream(settings.appFullInfoCurrentNdjson || PRODUCTION_APP_FULL_INFO_PATH, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    scannedRecords += 1;

    if (scannedRecords % 5000 === 0) {
      await reportProgress?.({
        stage: "Reading local App Full Info file",
        pagesRead: 0,
        scannedRecords,
        expectedRecordCount: 0,
        sourceType: "file",
      });
    }

    let record: ProductionAppFullInfoRecord;
    try {
      record = JSON.parse(trimmedLine) as ProductionAppFullInfoRecord;
    } catch {
      invalidJsonRecords += 1;
      continue;
    }

    const publisherId = normalizeText(record.publisher_id);
    const publisherName = normalizeText(record.publisher_name);
    if (!publisherId || !publisherName || publisherName === "#NAME?" || !isVietnamRelatedApp(record)) {
      continue;
    }

    relatedAppRecords += 1;
    appCandidates.push(createAppCandidate(record, appCandidates.length));

    if (!candidates.has(publisherId)) {
      candidates.set(publisherId, { publisherId, publisherName });
    }
  }

  return {
    candidates: [...candidates.values()],
    appCandidates,
    sourceType: "file" as const,
    sourcePath: settings.appFullInfoCurrentNdjson || PRODUCTION_APP_FULL_INFO_PATH,
    scannedRecords,
    invalidJsonRecords,
    relatedAppRecords,
  };
}

function createRowFromProductionCandidate(
  candidate: ProductionPublisherCandidate,
  ordinal: number,
  references: ReturnType<typeof buildReferenceLookups>,
): BottomUpRowDraft {
  const publisherReference =
    references.byPublisherId.get(candidate.publisherId) ||
    references.byPublisherName.get(candidate.publisherName.toLowerCase());
  const hasReference = Boolean(publisherReference);

  return normalizeBottomUpRow(
    {
      cleanedPublisherName: publisherReference?.cleanedPublisherName ?? "",
      publisherId: candidate.publisherId,
      publisherName: candidate.publisherName,
      revenueMultiplier: publisherReference?.revenueMultiplier || "1",
      reviewStatus: publisherReference?.reviewStatus ?? (hasReference ? "seeded" : "needs_review"),
      notes: publisherReference?.notes || (hasReference ? "" : "New production candidate from App Full Info. Please review cleaned publisher mapping."),
      adder: publisherReference?.adder || "production_sync",
      addingDate: publisherReference?.addingDate || nowIso().slice(0, 10),
    },
    ordinal,
  );
}

function shouldKeepBottomUpRow(row: BottomUpRowDraft) {
  const hasUsefulMapping = Boolean(row.cleanedPublisherName || row.revenueMultiplier !== "1" || row.notes);
  const isUnreviewedProductionDump =
    !row.cleanedPublisherName &&
    row.reviewStatus === "needs_review" &&
    row.adder === "production_sync" &&
    row.notes.includes("New production candidate from App Full Info");

  return hasUsefulMapping && !isUnreviewedProductionDump;
}

function makeWorkbenchState(
  store: PersistedStore,
  operatorName: string,
  options: { logLimit?: number } = {},
): BottomUpWorkbenchState {
  const logLimit =
    typeof options.logLimit === "number" && Number.isFinite(options.logLimit)
      ? Math.max(0, Math.floor(options.logLimit))
      : 24;

  return {
    datasetId: store.datasetId,
    operatorName,
    rows: store.rows,
    checkedPublisherNames: [],
    checkedPublisherCount: store.checkedPublisherNames.length,
    appCandidates: store.appCandidates.slice(0, MAX_APP_CANDIDATE_PREVIEW_COUNT),
    appCandidateCount: store.appCandidateCount || store.appCandidates.length,
    publisherCandidates: [],
    publisherCandidateCount: store.publisherCandidateCount || store.publisherCandidates.length,
    versions: store.versions.map((version) => ({
      id: version.id,
      label: version.label,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      rowCount: version.rowCount,
    })),
    logs: store.logs.slice(0, logLimit),
    productionSync: store.productionSync,
  };
}

function getStep1FieldValue(row: BottomUpStep1PublisherRow, field: BottomUpStep1FilterRule["field"]) {
  const publisherIds = row.publisherIds.join(" ");
  if (field === "all") {
    return [
      row.publisherName,
      row.cleanedPublisherName,
      row.isInVnPublisherList ? "TRUE" : "FALSE",
      row.isInLatestMapping ? "TRUE" : "FALSE",
      row.isChecked ? "TRUE" : "FALSE",
      publisherIds,
      String(row.appCount),
    ].join(" ");
  }

  if (field === "publisherIds") {
    return publisherIds;
  }

  if (field === "appCount") {
    return String(row.appCount);
  }

  if (field === "isInVnPublisherList" || field === "isInLatestMapping" || field === "isChecked") {
    return row[field] ? "TRUE" : "FALSE";
  }

  return row[field];
}

function step1RowMatchesFilters(row: BottomUpStep1PublisherRow, filters: BottomUpStep1FilterRule[]) {
  return filters.every((filter) => {
    const needle = normalizeText(filter.value).toLowerCase();
    if (!needle) {
      return true;
    }

    return getStep1FieldValue(row, filter.field).toLowerCase().includes(needle);
  });
}

function sortStep1Rows(
  rows: BottomUpStep1PublisherRow[],
  sortField: BottomUpStep1SortField | "",
  sortDirection: "asc" | "desc",
) {
  if (!sortField) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftValue = getStep1FieldValue(left, sortField);
    const rightValue = getStep1FieldValue(right, sortField);
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const comparison =
      Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
        ? leftNumber - rightNumber
        : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });

    return sortDirection === "asc" ? comparison : -comparison;
  });
}

function buildStep1Rows(store: PersistedStore): BottomUpStep1PublisherRow[] {
  const knownCleanedPublishers = new Set(
    store.rows.map((row) => row.cleanedPublisherName.trim().toLowerCase()).filter(Boolean),
  );
  const checkedPublisherNames = new Set(store.checkedPublisherNames);
  const byPublisherName = new Map<string, BottomUpStep1PublisherRow>();

  for (const candidate of store.publisherCandidates) {
    const publisherName = candidate.publisherName.trim();
    if (!publisherName) {
      continue;
    }

    byPublisherName.set(publisherName, {
      publisherName,
      cleanedPublisherName: "",
      publisherIds: candidate.publisherIds,
      appCount: candidate.appCount,
      isInVnPublisherList: false,
      isInLatestMapping: false,
      isChecked: checkedPublisherNames.has(publisherName),
      apps: candidate.apps ?? [],
    });
  }

  for (const candidate of store.appCandidates) {
    const publisherName = candidate.publisherName.trim();
    if (!publisherName) {
      continue;
    }

    const existing =
      byPublisherName.get(publisherName) ??
      {
        publisherName,
        cleanedPublisherName: "",
        publisherIds: [],
        appCount: 0,
        isInVnPublisherList: false,
        isInLatestMapping: false,
        isChecked: checkedPublisherNames.has(publisherName),
        apps: [],
      };

    if (candidate.publisherId && !existing.publisherIds.includes(candidate.publisherId)) {
      existing.publisherIds.push(candidate.publisherId);
    }
    if ((candidate.appId || candidate.name) && !existing.apps.some((app) => app.appId === candidate.appId && app.name === candidate.name)) {
      existing.apps.push({ appId: candidate.appId, name: candidate.name });
    }
    byPublisherName.set(publisherName, existing);
  }

  for (const row of store.rows) {
    const publisherName = row.publisherName.trim();
    if (!publisherName) {
      continue;
    }

    const existing =
      byPublisherName.get(publisherName) ??
      {
        publisherName,
        cleanedPublisherName: "",
        publisherIds: [],
        appCount: 0,
        isInVnPublisherList: false,
        isInLatestMapping: false,
        isChecked: checkedPublisherNames.has(publisherName),
        apps: [],
      };

    if (row.publisherId && !existing.publisherIds.includes(row.publisherId)) {
      existing.publisherIds.push(row.publisherId);
    }
    existing.cleanedPublisherName = existing.cleanedPublisherName || row.cleanedPublisherName;
    existing.isInLatestMapping = existing.isInLatestMapping || Boolean(row.cleanedPublisherName);
    existing.isInVnPublisherList =
      existing.isInVnPublisherList ||
      (Boolean(row.cleanedPublisherName) && knownCleanedPublishers.has(row.cleanedPublisherName.trim().toLowerCase()));
    byPublisherName.set(publisherName, existing);
  }

  return [...byPublisherName.values()];
}

function getFilteredStep1Rows(
  store: PersistedStore,
  filters: BottomUpStep1FilterRule[],
  sortField: BottomUpStep1SortField | "",
  sortDirection: "asc" | "desc",
) {
  return sortStep1Rows(
    buildStep1Rows(store).filter((row) => step1RowMatchesFilters(row, filters)),
    sortField,
    sortDirection,
  );
}

export async function getBottomUpStep1PublisherPage(params: {
  page: number;
  pageSize: number;
  filters: BottomUpStep1FilterRule[];
  sortField: BottomUpStep1SortField | "";
  sortDirection: "asc" | "desc";
}) {
  const store = await readStore();
  const page = Math.max(1, Math.floor(params.page));
  const pageSize = Math.min(500, Math.max(10, Math.floor(params.pageSize)));
  const sortedRows = getFilteredStep1Rows(store, params.filters, params.sortField, params.sortDirection);
  const totalCount = sortedRows.length;
  const rows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  return {
    rows,
    totalCount,
    totalPublisherCount: store.publisherCandidateCount || store.publisherCandidates.length,
    checkedPublisherCount: store.checkedPublisherNames.length,
  };
}

export async function updateBottomUpStep1Checked(params: {
  operatorName: string;
  checked: boolean;
  mode: "selected" | "filtered";
  publisherNames?: string[];
  filters?: BottomUpStep1FilterRule[];
  sortField?: BottomUpStep1SortField | "";
  sortDirection?: "asc" | "desc";
}) {
  const store = await readStore();
  const targetNames =
    params.mode === "filtered"
      ? getFilteredStep1Rows(store, params.filters ?? [], params.sortField ?? "", params.sortDirection ?? "asc").map(
          (row) => row.publisherName,
        )
      : (params.publisherNames ?? []).map(normalizeText).filter(Boolean);
  const checkedPublisherNames = new Set(store.checkedPublisherNames);

  for (const publisherName of targetNames) {
    if (params.checked) {
      checkedPublisherNames.add(publisherName);
    } else {
      checkedPublisherNames.delete(publisherName);
    }
  }

  store.checkedPublisherNames = [...checkedPublisherNames].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
  appendLogs(store, [
    createLog(
      "update_step1_checked_publishers",
      params.operatorName,
      "publisher_name",
      params.mode,
      `${params.checked ? "Checked" : "Unchecked"} ${targetNames.length} Step 1 publisher names.`,
    ),
  ]);
  await writeStore(store);

  return {
    changedCount: targetNames.length,
    checkedPublisherCount: store.checkedPublisherNames.length,
  };
}

export async function getBottomUpWorkbenchState(operatorName = "Local operator") {
  const store = await readStore();
  const productionSync = await getBottomUpProductionSyncState();
  return { ...makeWorkbenchState(store, operatorName), productionSync };
}

export async function saveBottomUpRows(
  rows: BottomUpRowDraft[],
  operatorName: string,
  checkedPublisherNames?: string[],
) {
  return mutateStore((store) => {
    store.rows = rows.map((row, index) => normalizeBottomUpRow(row, index + 1));
    if (checkedPublisherNames) {
      store.checkedPublisherNames = [...new Set(checkedPublisherNames.map(normalizeText).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }),
      );
    }
    appendLogs(store, [
      createLog("save_bottom_up_rows", operatorName, "dataset", DATASET_ID, `Saved ${store.rows.length} bottom-up rows.`),
    ]);
    return makeWorkbenchState(store, operatorName);
  });
}

export async function importBottomUpCsvFile(fileName: string, mimeType: string, bytes: Uint8Array, operatorName: string) {
  const store = await readStore();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedFileName = `${Date.now()}_${safeName}`;
  const storedPath = path.join(IMPORTS_DIR, storedFileName);
  await fs.writeFile(storedPath, bytes);

  const importedRows = importBottomUpRowsFromCsv(Buffer.from(bytes).toString("utf-8"));
  const mergeResult = upsertRowsByPublisherId(store.rows, importedRows);
  store.rows = mergeResult.rows;
  store.artifacts.unshift({
    id: createEntityId("artifact"),
    kind: "import_csv",
    originalName: fileName,
    storagePath: storedPath,
    mimeType,
    createdAt: nowIso(),
    createdBy: operatorName,
  });
  appendLogs(store, [
    createLog(
      "import_bottom_up_csv",
      operatorName,
      "dataset",
      DATASET_ID,
      `Imported ${importedRows.length} rows (${mergeResult.replacedCount} replaced, ${mergeResult.insertedCount} inserted).`,
    ),
  ]);
  await writeStore(store);
  return makeWorkbenchState(store, operatorName);
}

async function updateProductionSyncProgress(
  sync: BottomUpProductionSyncState,
  progress: ProductionProgress,
  nextOffset = sync.nextOffset ?? 0,
) {
  const updated: BottomUpProductionSyncState = {
    ...sync,
    ...progress,
    status: "running",
    nextOffset,
    heartbeatAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeProductionSyncState(updated);
  return updated;
}

async function markProductionSyncStarted(operatorName: string) {
  const startedAt = nowIso();
  const state: BottomUpProductionSyncState = {
    status: "queued",
    stage: "Queued",
    message: "Production load is queued and will continue even if you leave this page.",
    startedAt,
    updatedAt: startedAt,
    completedAt: "",
    pagesRead: 0,
    scannedRecords: 0,
    expectedRecordCount: 0,
    sourceType: "",
    jobId: createEntityId("production_sync"),
    nextOffset: 0,
    heartbeatAt: startedAt,
    lastSuccessfulLoad: (await readProductionSyncState(await readStore())).lastSuccessfulLoad,
  };
  await fs.mkdir(path.join(PRODUCTION_SYNC_JOBS_DIR, state.jobId!), { recursive: true });
  await writeProductionSyncState(state);
  await mutateStore((store) => {
    appendLogs(store, [
      createLog("sync_bottom_up_from_production_started", operatorName, "dataset", DATASET_ID, "Started production App Full Info load."),
    ]);
  });
  return state;
}

async function markProductionSyncFailed(sync: BottomUpProductionSyncState, error: unknown) {
  const completedAt = nowIso();
  const detail = error instanceof Error ? error.message : "Failed to load App Full Info from production.";
  const failed: BottomUpProductionSyncState = {
    ...sync,
    status: "failed",
    stage: "Failed",
    message: detail,
    updatedAt: completedAt,
    completedAt,
    heartbeatAt: completedAt,
  };
  await writeProductionSyncState(failed);
  await mutateStore((store) => {
    appendLogs(store, [createLog("sync_bottom_up_from_production_failed", "system", "dataset", DATASET_ID, detail)]);
  });
}

async function runBottomUpProductionSync(operatorName: string, requestedJobId?: string) {
  let sync = await readProductionSyncState(await readStore());
  if (!sync.jobId || (requestedJobId && sync.jobId !== requestedJobId)) {
    return undefined;
  }
  sync = await updateProductionSyncProgress(sync, {
    stage: sync.nextOffset ? "Resuming production App Full Info load" : "Preparing production App Full Info load",
    pagesRead: sync.pagesRead,
    scannedRecords: sync.scannedRecords,
    expectedRecordCount: sync.expectedRecordCount,
    sourceType: sync.sourceType,
  });

  const jobId = sync.jobId!;
  const checkpointDirectory = path.join(PRODUCTION_SYNC_JOBS_DIR, jobId);
  const checkpoint: ProductionCheckpointContext = {
    jobId,
    nextOffset: sync.nextOffset ?? 0,
    checkpointDirectory,
    update: async (progress, nextOffset) => {
      const current = await readProductionSyncState();
      if (current.jobId !== jobId) {
        throw new Error("Production load was superseded by a newer request.");
      }
      sync = await updateProductionSyncProgress(current, progress, nextOffset);
    },
  };

  const manualReferenceRows = await readManualReferenceRows();
  const production = await readProductionPublisherCandidates(
    async (progress) => {
      sync = await updateProductionSyncProgress(sync, progress);
    },
    checkpoint,
  );

  const result = await mutateStore((store) => {
    const references = buildReferenceLookups([...manualReferenceRows, ...store.rows]);
    const productionRows = production.candidates
      .map((candidate, index) => createRowFromProductionCandidate(candidate, index + 1, references))
      .filter((row) => row.cleanedPublisherName);
    const cleanedExistingRows = store.rows.filter(shouldKeepBottomUpRow);
    const mergeResult = upsertRowsByPublisherId(cleanedExistingRows, productionRows);

    store.rows = mergeResult.rows;
    store.appCandidates = production.appCandidates.slice(0, MAX_APP_CANDIDATE_PREVIEW_COUNT);
    store.appCandidateCount = production.appCandidates.length;
    store.publisherCandidates = buildPublisherCandidates(production.appCandidates);
    store.publisherCandidateCount = store.publisherCandidates.length;
    const needsReviewCount = store.rows.filter((row) => row.reviewStatus === "needs_review").length;
    const summary: ProductionSyncSummary = {
      sourcePath: production.sourcePath,
      sourceType: production.sourceType,
      scannedRecords: production.scannedRecords,
      invalidJsonRecords: production.invalidJsonRecords,
      relatedAppRecords: production.relatedAppRecords,
      candidateRows: productionRows.length,
      replacedCount: mergeResult.replacedCount,
      insertedCount: mergeResult.insertedCount,
      needsReviewCount,
    };
    appendLogs(store, [
      createLog(
        "sync_bottom_up_from_production",
        operatorName,
        "dataset",
        DATASET_ID,
        `Synced ${summary.candidateRows} publisher candidates from production App Full Info (${summary.replacedCount} replaced, ${summary.insertedCount} inserted).`,
      ),
    ]);
    return { state: makeWorkbenchState(store, operatorName), summary, publisherCandidateCount: store.publisherCandidateCount };
  });

  const completedAt = nowIso();
  const succeeded: BottomUpProductionSyncState = {
    ...sync,
    status: "succeeded",
    stage: "Completed",
    message: `Loaded ${result.summary.candidateRows} publisher candidates from production App Full Info.`,
    updatedAt: completedAt,
    completedAt,
    heartbeatAt: completedAt,
    scannedRecords: result.summary.scannedRecords,
    expectedRecordCount: sync.expectedRecordCount || result.summary.scannedRecords,
    sourceType: result.summary.sourceType,
    summary: {
      candidateRows: result.summary.candidateRows,
      replacedCount: result.summary.replacedCount,
      insertedCount: result.summary.insertedCount,
      needsReviewCount: result.summary.needsReviewCount,
    },
    lastSuccessfulLoad: {
      completedAt,
      sourceType: result.summary.sourceType,
      scannedRecords: result.summary.scannedRecords,
      relatedAppRecords: result.summary.relatedAppRecords,
      candidateRows: result.summary.candidateRows,
      publisherCandidateCount: result.publisherCandidateCount,
      replacedCount: result.summary.replacedCount,
      insertedCount: result.summary.insertedCount,
      needsReviewCount: result.summary.needsReviewCount,
    },
  };
  await writeProductionSyncState(succeeded);
  return { state: { ...result.state, productionSync: succeeded }, summary: result.summary };
}

async function ensureBottomUpProductionSyncRunner(operatorName = "system") {
  const sync = await readProductionSyncState(await readStore());
  if ((sync.status !== "queued" && sync.status !== "running") || !sync.jobId) {
    return sync;
  }
  if (globalThis.__bottomUpProductionSyncPromise) {
    return sync;
  }

  const resumed = sync.status === "running"
    ? {
        ...sync,
        status: "queued" as const,
        stage: "Waiting to resume production load",
        message: "Resuming production App Full Info from its saved checkpoint.",
        updatedAt: nowIso(),
      }
    : sync;
  if (resumed !== sync) {
    await writeProductionSyncState(resumed);
  }
  const jobId = resumed.jobId;
  const job = runBottomUpProductionSync(operatorName, jobId)
    .catch(async (error) => markProductionSyncFailed(await readProductionSyncState(), error))
    .then(() => undefined)
    .finally(() => {
      globalThis.__bottomUpProductionSyncPromise = undefined;
    });
  globalThis.__bottomUpProductionSyncPromise = job;
  return resumed;
}

export async function getBottomUpProductionSyncState() {
  const state = await readProductionSyncState(await readStore());
  if ((state.status === "queued" || state.status === "running") && !globalThis.__bottomUpProductionSyncPromise) {
    return ensureBottomUpProductionSyncRunner();
  }
  return state;
}

export async function startBottomUpProductionSync(operatorName: string) {
  const existing = await readProductionSyncState(await readStore());
  if (existing.status === "queued" || existing.status === "running") {
    await ensureBottomUpProductionSyncRunner(operatorName);
    return { started: false, syncStatus: await readProductionSyncState() };
  }

  const syncStatus = await markProductionSyncStarted(operatorName);
  await ensureBottomUpProductionSyncRunner(operatorName);
  return { started: true, syncStatus };
}

export async function syncBottomUpFromProduction(operatorName: string) {
  const sync = await markProductionSyncStarted(operatorName);
  try {
    return await runBottomUpProductionSync(operatorName, sync.jobId);
  } catch (error) {
    await markProductionSyncFailed(sync, error);
    throw error;
  }
}

export async function exportBottomUpCsv(operatorName: string) {
  const store = await readStore();
  const topDownState = await getTopDownWorkbenchState(operatorName);
  const revenueMultiplierByPublisher = new Map(
    topDownState.publishers.map((publisher) => [
      publisher.name.trim().toLowerCase(),
      publisher.revenueMultiplier.trim() || "1",
    ]),
  );
  const exportRows = store.rows.map((row) => ({
    ...row,
    revenueMultiplier:
      revenueMultiplierByPublisher.get(row.cleanedPublisherName.trim().toLowerCase()) ?? row.revenueMultiplier,
  }));
  const csv = buildBottomUpCsv(exportRows);
  const fileName = `mapping_publisher_to_publisherids_revenue_multiplier_bottom_up_${Date.now()}.csv`;
  const storedPath = path.join(EXPORTS_DIR, fileName);
  await fs.writeFile(storedPath, csv, "utf-8");

  store.artifacts.unshift({
    id: createEntityId("artifact"),
    kind: "export_csv",
    originalName: fileName,
    storagePath: storedPath,
    mimeType: "text/csv",
    createdAt: nowIso(),
    createdBy: operatorName,
  });
  appendLogs(store, [
    createLog("export_bottom_up_csv", operatorName, "dataset_export", fileName, `Exported ${store.rows.length} rows.`),
  ]);
  await writeStore(store);
  return { fileName, csv };
}

export async function createBottomUpVersion(operatorName: string) {
  const store = await readStore();
  const version: PersistedVersion = {
    id: createEntityId("version"),
    label: `Snapshot ${new Date().toLocaleString()}`,
    createdAt: nowIso(),
    createdBy: operatorName,
    rowCount: store.rows.length,
    rows: structuredClone(store.rows),
  };
  store.versions.unshift(version);
  appendLogs(store, [
    createLog("save_bottom_up_version", operatorName, "dataset_version", version.id, `Captured ${version.rowCount} rows.`),
  ]);
  await writeStore(store);
  return makeWorkbenchState(store, operatorName);
}

export async function listBottomUpVersions(): Promise<BottomUpVersionMetadata[]> {
  const store = await readStore();
  return store.versions.map(({ id, label, createdAt, createdBy, rowCount, rows }) => {
    const csv = buildBottomUpCsv(rows);
    return {
      id,
      workflow: "bottom_up",
      label,
      createdAt,
      createdBy,
      schemaVersion: 1,
      rowCount,
      mappedRowCount: rows.filter(
        (row) => row.cleanedPublisherName && row.publisherId && row.publisherName,
      ).length,
      needsReviewCount: rows.filter((row) => row.reviewStatus === "needs_review").length,
      ...getCsvIntegrity(csv),
    };
  });
}

export async function exportBottomUpVersionCsv(versionId: string) {
  const store = await readStore();
  const version = store.versions.find((item) => item.id === versionId);
  if (!version) {
    throw new VersionNotFoundError();
  }

  return {
    fileName: `mapping_publisher_to_publisherids_revenue_multiplier_bottom_up_${version.id}.csv`,
    csv: buildBottomUpCsv(version.rows),
  };
}
