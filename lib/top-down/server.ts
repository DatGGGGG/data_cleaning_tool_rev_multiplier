import { promises as fs } from "node:fs";
import path from "node:path";
import { createPublisherSeeds } from "@/lib/top-down/mock-data";
import { extractUnifiedAppIdFromOverviewLink, resolveSensorTowerOverviewLink } from "@/lib/top-down/sensortower";
import type {
  ActivityLogEntry,
  PublisherPlatformEntry,
  PublisherRowDraft,
  PublisherSheet,
  SensorTowerOption,
  SensorTowerResolveResponse,
  TopDownOverviewState,
  TopDownPublisherRegistryEntry,
  TopDownVersionMetadata,
  TopDownVersionFreshness,
  TopDownVersionSnapshot,
  TopDownWorkbenchState,
} from "@/lib/top-down/types";
import {
  buildFlattenedCsv,
  flattenPublisherRows,
  importPublisherRowsFromCsv,
  normalizePublisherRow,
  normalizePublisherSheet,
} from "@/lib/top-down/workbench";
import { getCsvIntegrity, VersionNotFoundError } from "@/lib/version-api";

const STORAGE_ROOT = path.join(process.cwd(), "storage");
const IMPORTS_DIR = path.join(STORAGE_ROOT, "imports");
const EXPORTS_DIR = path.join(STORAGE_ROOT, "exports");
const STORE_PATH = path.join(STORAGE_ROOT, "top-down-workbench.json");
const STORE_TEMP_PATH = path.join(STORAGE_ROOT, "top-down-workbench.json.tmp");
const DATASET_ID = "top_down_dataset";
const MAX_LOG_COUNT = 100;
const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;
const AUTO_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __topDownAutoRefreshSchedulerStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __topDownAutoRefreshSchedulerRunning: boolean | undefined;
  // eslint-disable-next-line no-var
  var __topDownStoreWritePromise: Promise<void> | undefined;
}

type PersistedVersion = TopDownVersionSnapshot & {
  publishers: PublisherSheet[];
};

type PersistedArtifact = {
  id: string;
  kind: "import_csv" | "export_csv";
  originalName: string;
  storagePath: string;
  mimeType: string;
  createdAt: string;
  createdBy: string;
  publisherKey?: string;
};

type PersistedStore = {
  datasetId: string;
  datasetName: string;
  createdAt: string;
  updatedAt: string;
  publishers: PublisherSheet[];
  versions: PersistedVersion[];
  logs: ActivityLogEntry[];
  artifacts: PersistedArtifact[];
};

function nowIso() {
  return new Date().toISOString();
}

function createEntityId(prefix = "id") {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function createEntryFromOption(option: SensorTowerOption): PublisherPlatformEntry {
  return {
    appId: option.appId,
    publisherName: option.publisherName,
    appName: option.appName,
    source: "resolved",
  };
}

function reconcileEntriesWithOptions(entries: PublisherPlatformEntry[], options: SensorTowerOption[]) {
  if (options.length === 0) {
    return entries;
  }

  const optionLookup = new Map(options.map((option) => [option.appId, option]));
  return entries
    .map((entry) => optionLookup.get(entry.appId))
    .filter((option): option is SensorTowerOption => Boolean(option))
    .map(createEntryFromOption);
}

function createLog(
  action: string,
  actor: string,
  targetType: string,
  targetId: string,
  detail: string,
): ActivityLogEntry {
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

function isAutoRefreshEnabled() {
  return process.env.ENABLE_SENSORTOWER_AUTO_REFRESH !== "false";
}

function isBuildProcess() {
  const normalizedArgs = process.argv.map((argument) => argument.toLowerCase());
  return normalizedArgs.some((argument) => argument.includes("next")) && normalizedArgs.includes("build");
}

async function ensureStorageDirectories() {
  await fs.mkdir(IMPORTS_DIR, { recursive: true });
  await fs.mkdir(EXPORTS_DIR, { recursive: true });
}

function createInitialStore(): PersistedStore {
  const publishers = createPublisherSeeds().map((publisher, index) => ({
    id: `publisher_${index + 1}`,
    key: publisher.key,
    name: publisher.name,
    revenueMultiplier: publisher.revenueMultiplier ?? "1",
    rows: publisher.rows,
  }));
  return {
    datasetId: DATASET_ID,
    datasetName: "Mapping Publisher to Apps (Top Down)",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    publishers,
    versions: [],
    logs: [
      createLog(
        "initialize_dataset",
        "system",
        "dataset",
        DATASET_ID,
        "Loaded starter publisher sheets for the top-down workflow.",
      ),
    ],
    artifacts: [],
  };
}

function normalizeLog(value: unknown): ActivityLogEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ActivityLogEntry>;
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
    publisherKey: normalizeText(candidate.publisherKey) || undefined,
  };
}

function normalizeVersion(value: unknown, index: number): PersistedVersion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PersistedVersion> & { publishers?: unknown };
  const rows = Array.isArray(candidate.publishers)
    ? candidate.publishers.map((publisher, publisherIndex) =>
        normalizePublisherSheet(publisher as Partial<PublisherSheet>, publisherIndex),
      )
    : [];

  return {
    id: normalizeText(candidate.id) || createEntityId("version"),
    label: normalizeText(candidate.label) || `Snapshot ${index + 1}`,
    createdAt: normalizeText(candidate.createdAt) || nowIso(),
    createdBy: normalizeText(candidate.createdBy) || "system",
    publisherCount:
      typeof candidate.publisherCount === "number" && Number.isFinite(candidate.publisherCount)
        ? candidate.publisherCount
        : rows.length,
    publishers: rows,
  };
}

function normalizeStore(value: unknown): PersistedStore {
  if (!value || typeof value !== "object") {
    return createInitialStore();
  }

  const candidate = value as Partial<PersistedStore> & {
    publishers?: unknown;
    versions?: unknown;
    logs?: unknown;
    artifacts?: unknown;
  };

  const publishers = Array.isArray(candidate.publishers)
    ? candidate.publishers.map((publisher, index) =>
        normalizePublisherSheet(publisher as Partial<PublisherSheet>, index),
      )
    : createInitialStore().publishers;

  const versions = Array.isArray(candidate.versions)
    ? candidate.versions
        .map((version, index) => normalizeVersion(version, index))
        .filter((version): version is PersistedVersion => Boolean(version))
    : [];

  const logs = Array.isArray(candidate.logs)
    ? candidate.logs
        .map((entry) => normalizeLog(entry))
        .filter((entry): entry is ActivityLogEntry => Boolean(entry))
    : [];

  const artifacts = Array.isArray(candidate.artifacts)
    ? candidate.artifacts
        .map((artifact) => normalizeArtifact(artifact))
        .filter((artifact): artifact is PersistedArtifact => Boolean(artifact))
    : [];

  return {
    datasetId: normalizeText(candidate.datasetId) || DATASET_ID,
    datasetName: normalizeText(candidate.datasetName) || "Mapping Publisher to Apps (Top Down)",
    createdAt: normalizeText(candidate.createdAt) || nowIso(),
    updatedAt: normalizeText(candidate.updatedAt) || nowIso(),
    publishers,
    versions,
    logs,
    artifacts,
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
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(0, index + 1);
      }
    }
  }

  return null;
}

async function tryRecoverMalformedStore(raw: string) {
  const recoveredJson = findFirstCompleteJsonObject(raw);
  if (!recoveredJson) {
    return null;
  }

  try {
    return normalizeStore(JSON.parse(recoveredJson));
  } catch {
    return null;
  }
}

async function readStore(): Promise<PersistedStore> {
  await ensureStorageDirectories();

  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    try {
      return normalizeStore(JSON.parse(raw));
    } catch (error) {
      const recoveredStore = await tryRecoverMalformedStore(raw);
      if (!recoveredStore) {
        throw error;
      }

      appendLogs(recoveredStore, [
        createLog(
          "repair_store_json",
          "system",
          "dataset",
          DATASET_ID,
          "Recovered the persisted workbench store after malformed trailing JSON was detected.",
        ),
      ]);
      await writeStore(recoveredStore);
      return recoveredStore;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const initialStore = createInitialStore();
    await writeStore(initialStore);
    return initialStore;
  }
}

function getLastFullRefreshAt(store: PersistedStore) {
  const matchingLogs = store.logs.filter(
    (entry) =>
      entry.action === "full_refresh_sensortower" ||
      entry.action === "scheduled_full_refresh_sensortower",
  );

  const latestTimestamp = matchingLogs
    .map((entry) => Date.parse(entry.createdAt))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => right - left)[0];

  return Number.isFinite(latestTimestamp) ? new Date(latestTimestamp) : null;
}

function shouldRunScheduledFullRefresh(now: Date, lastRunAt: Date | null) {
  if (now.getDay() !== 0) {
    return false;
  }

  if (!lastRunAt) {
    return true;
  }

  return now.getTime() - lastRunAt.getTime() >= FOUR_WEEKS_MS;
}

function buildResolvedRow(
  row: PublisherRowDraft,
  resolution: SensorTowerResolveResponse,
): PublisherRowDraft {
  const nextResolution = {
    status: resolution.status,
    unifiedAppId: resolution.unifiedAppId,
    resolvedGameName: resolution.resolvedGameName ?? "",
    errorMessage: resolution.errorMessage ?? "",
    resolvedAt: resolution.resolvedAt ?? nowIso(),
    iosOptions: resolution.iosOptions ?? [],
    androidOptions: resolution.androidOptions ?? [],
  };

  return {
    ...row,
    iosApps: reconcileEntriesWithOptions(row.iosApps, nextResolution.iosOptions),
    androidApps: reconcileEntriesWithOptions(row.androidApps, nextResolution.androidOptions),
    sensorTowerResolution: nextResolution,
  };
}

async function performSensorTowerFullRefresh(
  operatorName: string,
  action: "full_refresh_sensortower" | "scheduled_full_refresh_sensortower",
) {
  const store = await readStore();
  let scannedRows = 0;
  let resolvedCount = 0;
  let emptyCount = 0;
  let failedCount = 0;
  let changedCount = 0;

  const nextPublishers = await Promise.all(
    store.publishers.map(async (publisher) => {
      const nextRows = await Promise.all(
        publisher.rows.map(async (row) => {
          const sensorTowerLink = normalizeText(row.sensorTowerLink);
          if (!sensorTowerLink) {
            return row;
          }

          scannedRows += 1;

          let resolution: SensorTowerResolveResponse;
          try {
            resolution = await resolveSensorTowerOverviewLink(sensorTowerLink);
          } catch (error) {
            resolution = {
              status: "failed",
              unifiedAppId: "",
              resolvedGameName: "",
              iosOptions: [],
              androidOptions: [],
              errorMessage:
                error instanceof Error ? error.message : "Failed to resolve the SensorTower link.",
              resolvedAt: nowIso(),
            };
          }

          if (resolution.status === "resolved") {
            resolvedCount += 1;
          } else if (resolution.status === "empty") {
            emptyCount += 1;
          } else {
            failedCount += 1;
          }

          const nextRow = buildResolvedRow(row, resolution);
          if (JSON.stringify(nextRow) !== JSON.stringify(row)) {
            changedCount += 1;
          }

          return nextRow;
        }),
      );

      return {
        ...publisher,
        rows: nextRows.map((row, rowIndex) => normalizePublisherRow(row, rowIndex + 1)),
      };
    }),
  );

  store.publishers = nextPublishers;
  appendLogs(store, [
    createLog(
      action,
      operatorName,
      "dataset",
      store.datasetId,
      `Refreshed ${scannedRows} SensorTower-linked rows (${resolvedCount} resolved, ${emptyCount} empty, ${failedCount} failed, ${changedCount} changed).`,
    ),
  ]);

  await writeStore(store);

  return {
    state: makeWorkbenchState(store, operatorName),
    summary: {
      scannedRows,
      resolvedCount,
      emptyCount,
      failedCount,
      changedCount,
    },
  };
}

async function runScheduledSensorTowerFullRefreshIfDue() {
  if (!isAutoRefreshEnabled() || globalThis.__topDownAutoRefreshSchedulerRunning) {
    return;
  }

  globalThis.__topDownAutoRefreshSchedulerRunning = true;

  try {
    const store = await readStore();
    const now = new Date();
    const lastRunAt = getLastFullRefreshAt(store);

    if (!shouldRunScheduledFullRefresh(now, lastRunAt)) {
      return;
    }

    await performSensorTowerFullRefresh("Scheduler", "scheduled_full_refresh_sensortower");
  } catch (error) {
    const store = await readStore();
    appendLogs(store, [
      createLog(
        "scheduled_full_refresh_sensortower_failed",
        "Scheduler",
        "dataset",
        DATASET_ID,
        error instanceof Error ? error.message : "Scheduled SensorTower full refresh failed.",
      ),
    ]);
    await writeStore(store);
  } finally {
    globalThis.__topDownAutoRefreshSchedulerRunning = false;
  }
}

function ensureAutoRefreshSchedulerStarted() {
  if (!isAutoRefreshEnabled() || isBuildProcess() || globalThis.__topDownAutoRefreshSchedulerStarted) {
    return;
  }

  globalThis.__topDownAutoRefreshSchedulerStarted = true;
  void runScheduledSensorTowerFullRefreshIfDue();
  const intervalHandle = setInterval(() => {
    void runScheduledSensorTowerFullRefreshIfDue();
  }, AUTO_REFRESH_CHECK_INTERVAL_MS);
  intervalHandle.unref?.();
}

async function writeStore(store: PersistedStore) {
  await ensureStorageDirectories();
  store.updatedAt = nowIso();
  const payload = JSON.stringify(store, null, 2);

  const previousWrite = globalThis.__topDownStoreWritePromise ?? Promise.resolve();
  const nextWrite = previousWrite.then(async () => {
    await fs.writeFile(STORE_TEMP_PATH, payload, "utf-8");
    await fs.rename(STORE_TEMP_PATH, STORE_PATH);
  });

  globalThis.__topDownStoreWritePromise = nextWrite.catch(() => undefined);
  await nextWrite;
}

function makeWorkbenchState(
  store: PersistedStore,
  operatorName: string,
  options: { logLimit?: number } = {},
): TopDownWorkbenchState {
  const logLimit =
    typeof options.logLimit === "number" && Number.isFinite(options.logLimit)
      ? Math.max(0, Math.floor(options.logLimit))
      : 24;

  return {
    datasetId: store.datasetId,
    operatorName,
    publishers: store.publishers,
    versions: store.versions.map((version) => ({
      id: version.id,
      label: version.label,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      publisherCount: version.publisherCount,
    })),
    versionFreshness: getTopDownVersionFreshnessFromStore(store),
    logs: store.logs.slice(0, logLimit),
  };
}

function getTopDownCsvSnapshot(publishers: PublisherSheet[]) {
  const flattenedRows = flattenPublisherRows(publishers);
  const csv = buildFlattenedCsv(flattenedRows);
  return {
    flattenedAppCount: flattenedRows.length,
    checksumSha256: getCsvIntegrity(csv).checksumSha256,
  };
}

function getTopDownVersionFreshnessFromStore(store: PersistedStore): TopDownVersionFreshness {
  const current = getTopDownCsvSnapshot(store.publishers);
  const latestVersion = store.versions[0] ?? null;
  const latest = latestVersion ? getTopDownCsvSnapshot(latestVersion.publishers) : null;

  return {
    hasUnversionedChanges: !latest || current.checksumSha256 !== latest.checksumSha256,
    currentChecksumSha256: current.checksumSha256,
    currentFlattenedAppCount: current.flattenedAppCount,
    latestVersionId: latestVersion?.id ?? null,
    latestVersionLabel: latestVersion?.label ?? null,
    latestVersionCreatedAt: latestVersion?.createdAt ?? null,
    latestVersionChecksumSha256: latest?.checksumSha256 ?? null,
    latestVersionFlattenedAppCount: latest?.flattenedAppCount ?? null,
  };
}

function getSensorTowerIssueCount(rows: PublisherRowDraft[]) {
  return rows.filter((row) => {
    const hasLink = row.sensorTowerLink.trim().length > 0;
    const status = row.sensorTowerResolution.status;
    return hasLink && (status === "failed" || status === "empty");
  }).length;
}

function makeOverviewState(
  store: PersistedStore,
  operatorName: string,
  options: { logLimit?: number } = {},
): TopDownOverviewState {
  const logLimit =
    typeof options.logLimit === "number" && Number.isFinite(options.logLimit)
      ? Math.max(0, Math.floor(options.logLimit))
      : 24;
  const publishers = store.publishers.map((publisher) => {
    const flattenedAppCount = flattenPublisherRows([publisher]).length;
    const needsReviewCount = publisher.rows.filter((row) => row.reviewStatus === "needs_review").length;
    return {
      id: publisher.id,
      key: publisher.key,
      name: publisher.name,
      revenueMultiplier: publisher.revenueMultiplier || "1",
      rowCount: publisher.rows.length,
      flattenedAppCount,
      needsReviewCount,
      sensorTowerIssueCount: getSensorTowerIssueCount(publisher.rows),
    };
  });

  return {
    datasetId: store.datasetId,
    operatorName,
    publishers,
    publisherCount: publishers.length,
    flattenedRowCount: publishers.reduce((total, publisher) => total + publisher.flattenedAppCount, 0),
    needsReviewCount: publishers.reduce((total, publisher) => total + publisher.needsReviewCount, 0),
    versions: store.versions.map((version) => ({
      id: version.id,
      label: version.label,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      publisherCount: version.publisherCount,
    })),
    versionFreshness: getTopDownVersionFreshnessFromStore(store),
    logs: store.logs.slice(0, logLimit),
  };
}

function slugifyPublisherKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "publisher";
}

function buildUniquePublisherKey(name: string, publishers: PublisherSheet[]) {
  const baseKey = slugifyPublisherKey(name);
  const existingKeys = new Set(publishers.map((publisher) => publisher.key));
  if (!existingKeys.has(baseKey)) {
    return baseKey;
  }

  let suffix = 2;
  while (existingKeys.has(`${baseKey}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseKey}-${suffix}`;
}

function clonePublishers(publishers: PublisherSheet[]) {
  return structuredClone(publishers);
}

function appendLogs(store: PersistedStore, logs: ActivityLogEntry[]) {
  if (logs.length === 0) {
    return;
  }

  store.logs = [...logs, ...store.logs].slice(0, MAX_LOG_COUNT);
}

function serializePlatformEntries(row: PublisherRowDraft) {
  return JSON.stringify({
    ios: row.iosApps.map((entry) => ({
      appId: entry.appId,
      publisherName: entry.publisherName,
      appName: entry.appName,
      source: entry.source,
    })),
    android: row.androidApps.map((entry) => ({
      appId: entry.appId,
      publisherName: entry.publisherName,
      appName: entry.appName,
      source: entry.source,
    })),
  });
}

function describeRow(publisherName: string, row: PublisherRowDraft) {
  return `${publisherName} / ${row.gameName || `row ${row.ordinal}`}`;
}

function withUnifiedAppId(row: PublisherRowDraft, unifiedAppId: string) {
  if (!unifiedAppId) {
    return row;
  }

  return {
    ...row,
    sensorTowerResolution: {
      ...row.sensorTowerResolution,
      unifiedAppId,
    },
  };
}

function createUnifiedAppIdResolver() {
  const cache = new Map<string, Promise<string>>();

  return async (row: PublisherRowDraft) => {
    const persistedUnifiedAppId = normalizeText(row.sensorTowerResolution.unifiedAppId);
    if (persistedUnifiedAppId) {
      return persistedUnifiedAppId;
    }

    const sensorTowerLink = normalizeText(row.sensorTowerLink);
    if (!sensorTowerLink) {
      return "";
    }

    if (!cache.has(sensorTowerLink)) {
      cache.set(
        sensorTowerLink,
        extractUnifiedAppIdFromOverviewLink(sensorTowerLink).catch(() => ""),
      );
    }

    return cache.get(sensorTowerLink) ?? Promise.resolve("");
  };
}

async function upsertPublisherRowsByUnifiedAppId(
  existingRows: PublisherRowDraft[],
  importedRows: PublisherRowDraft[],
) {
  const resolveUnifiedAppId = createUnifiedAppIdResolver();
  const [existingUnifiedIds, importedUnifiedIds] = await Promise.all([
    Promise.all(existingRows.map((row) => resolveUnifiedAppId(row))),
    Promise.all(importedRows.map((row) => resolveUnifiedAppId(row))),
  ]);

  const importedByUnifiedId = new Map<string, PublisherRowDraft>();
  const importedUnifiedOrder: string[] = [];
  const importedWithoutUnifiedId: PublisherRowDraft[] = [];

  importedRows.forEach((row, index) => {
    const unifiedAppId = importedUnifiedIds[index];
    const rowWithUnifiedAppId = withUnifiedAppId(row, unifiedAppId);

    if (!unifiedAppId) {
      importedWithoutUnifiedId.push(rowWithUnifiedAppId);
      return;
    }

    if (!importedByUnifiedId.has(unifiedAppId)) {
      importedUnifiedOrder.push(unifiedAppId);
    }

    importedByUnifiedId.set(unifiedAppId, rowWithUnifiedAppId);
  });

  const mergedRows: PublisherRowDraft[] = [];
  const usedImportedUnifiedIds = new Set<string>();
  const seenExistingUnifiedIds = new Set<string>();
  let replacedCount = 0;

  existingRows.forEach((row, index) => {
    const unifiedAppId = existingUnifiedIds[index];
    const rowWithUnifiedAppId = withUnifiedAppId(row, unifiedAppId);

    if (unifiedAppId) {
      if (seenExistingUnifiedIds.has(unifiedAppId)) {
        return;
      }
      seenExistingUnifiedIds.add(unifiedAppId);
    }

    if (unifiedAppId && importedByUnifiedId.has(unifiedAppId)) {
      mergedRows.push(importedByUnifiedId.get(unifiedAppId)!);
      usedImportedUnifiedIds.add(unifiedAppId);
      replacedCount += 1;
      return;
    }

    mergedRows.push(rowWithUnifiedAppId);
  });

  for (const unifiedAppId of importedUnifiedOrder) {
    if (usedImportedUnifiedIds.has(unifiedAppId)) {
      continue;
    }

    const importedRow = importedByUnifiedId.get(unifiedAppId);
    if (importedRow) {
      mergedRows.push(importedRow);
    }
  }

  mergedRows.push(...importedWithoutUnifiedId);

  return {
    rows: mergedRows.map((row, index) => normalizePublisherRow(row, index + 1)),
    replacedCount,
    insertedCount: importedUnifiedOrder.filter((unifiedAppId) => !usedImportedUnifiedIds.has(unifiedAppId)).length + importedWithoutUnifiedId.length,
  };
}

function buildPlatformSelectionLogs(
  previousPublishers: PublisherSheet[],
  nextPublishers: PublisherSheet[],
  operatorName: string,
) {
  const previousRows = new Map<string, { publisherName: string; row: PublisherRowDraft }>();

  for (const publisher of previousPublishers) {
    for (const row of publisher.rows) {
      previousRows.set(row.id, { publisherName: publisher.name, row: normalizePublisherRow(row, row.ordinal) });
    }
  }

  const logs: ActivityLogEntry[] = [];

  for (const publisher of nextPublishers) {
    for (const row of publisher.rows) {
      const previous = previousRows.get(row.id);
      if (!previous) {
        continue;
      }

      if (serializePlatformEntries(previous.row) !== serializePlatformEntries(row)) {
        logs.push(
          createLog(
            "update_platform_selection",
            operatorName,
            "publisher_row",
            row.id,
            `Updated app selections for ${describeRow(publisher.name, row)}`,
          ),
        );
      }
    }
  }

  return logs;
}

export async function ensureTopDownDataset() {
  ensureAutoRefreshSchedulerStarted();
  await readStore();
  return DATASET_ID;
}

export async function getTopDownWorkbenchState(
  operatorName = "Local operator",
  options: { logLimit?: number } = {},
): Promise<TopDownWorkbenchState> {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  return makeWorkbenchState(store, operatorName, options);
}

export async function getTopDownOverviewState(
  operatorName = "Local operator",
  options: { logLimit?: number } = {},
): Promise<TopDownOverviewState> {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  return makeOverviewState(store, operatorName, options);
}

export async function getTopDownVersionFreshness(): Promise<TopDownVersionFreshness> {
  ensureAutoRefreshSchedulerStarted();
  return getTopDownVersionFreshnessFromStore(await readStore());
}

export async function getTopDownPublisherRegistry(): Promise<TopDownPublisherRegistryEntry[]> {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  return store.publishers
    .map((publisher) => ({
      publisherName: publisher.name.trim(),
      revenueMultiplier: publisher.revenueMultiplier.trim() || "1",
    }))
    .filter((publisher) => publisher.publisherName)
    .sort((left, right) => left.publisherName.localeCompare(right.publisherName, undefined, { sensitivity: "base" }));
}

export async function addTopDownPublisher(name: string, operatorName: string): Promise<TopDownOverviewState> {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Enter a publisher name first.");
  }

  store.publishers.push({
    id: `publisher_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: buildUniquePublisherKey(trimmedName, store.publishers),
    name: trimmedName,
    revenueMultiplier: "1",
    rows: [],
  });
  appendLogs(store, [
    createLog("add_publisher", operatorName, "publisher_sheet", trimmedName, `Added publisher ${trimmedName}.`),
  ]);
  await writeStore(store);
  return makeOverviewState(store, operatorName);
}

export async function updateTopDownPublisherRevenueMultiplier(
  publisherId: string,
  revenueMultiplier: string,
  operatorName: string,
): Promise<TopDownOverviewState> {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  const publisher = store.publishers.find((item) => item.id === publisherId);
  if (!publisher) {
    throw new Error("Publisher was not found.");
  }

  publisher.revenueMultiplier = revenueMultiplier.trim() || "1";
  appendLogs(store, [
    createLog(
      "update_publisher_multiplier",
      operatorName,
      "publisher_sheet",
      publisher.id,
      `Updated revenue multiplier for ${publisher.name}.`,
    ),
  ]);
  await writeStore(store);
  return makeOverviewState(store, operatorName);
}

export async function saveTopDownPublishers(
  publishers: PublisherSheet[],
  operatorName: string,
): Promise<TopDownWorkbenchState> {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  const normalizedPublishers = clonePublishers(
    publishers.map((publisher, publisherIndex) => normalizePublisherSheet(publisher, publisherIndex)),
  );
  const selectionLogs = buildPlatformSelectionLogs(store.publishers, normalizedPublishers, operatorName);

  store.publishers = normalizedPublishers.map((publisher, publisherIndex) => ({
    ...publisher,
    rows: publisher.rows.map((row, rowIndex) => normalizePublisherRow(row, rowIndex + 1)),
    id: publisher.id || `publisher_${publisherIndex + 1}`,
  }));

  appendLogs(store, [
    ...selectionLogs,
    createLog(
      "save_publishers",
      operatorName,
      "dataset",
      store.datasetId,
      `Saved ${publishers.length} publisher sheets`,
    ),
  ]);

  await writeStore(store);
  return makeWorkbenchState(store, operatorName);
}

export async function importPublisherCsvFile(
  publisherKey: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
  operatorName: string,
) {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  const publisher = store.publishers.find((item) => item.key === publisherKey);

  if (!publisher) {
    throw new Error(`Publisher sheet "${publisherKey}" was not found.`);
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedFileName = `${Date.now()}_${safeName}`;
  const storedPath = path.join(IMPORTS_DIR, storedFileName);
  await fs.writeFile(storedPath, bytes);

  const importedRows = importPublisherRowsFromCsv(Buffer.from(bytes).toString("utf-8")).map((row, index) =>
    normalizePublisherRow(row, index + 1),
  );
  const mergeResult = await upsertPublisherRowsByUnifiedAppId(publisher.rows, importedRows);
  publisher.rows = mergeResult.rows;

  store.artifacts.unshift({
    id: createEntityId("artifact"),
    kind: "import_csv",
    originalName: fileName,
    storagePath: storedPath,
    mimeType,
    createdAt: nowIso(),
    createdBy: operatorName,
    publisherKey,
  });

  appendLogs(store, [
    createLog(
      "import_csv",
      operatorName,
      "publisher_sheet",
      publisher.id,
      `Imported ${importedRows.length} CSV rows into ${publisher.name} (${mergeResult.replacedCount} replaced, ${mergeResult.insertedCount} inserted).`,
    ),
  ]);

  await writeStore(store);
  return makeWorkbenchState(store, operatorName);
}

export async function createTopDownVersion(operatorName: string) {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  const version: PersistedVersion = {
    id: createEntityId("version"),
    label: `Snapshot ${new Date().toLocaleString()}`,
    createdAt: nowIso(),
    createdBy: operatorName,
    publisherCount: store.publishers.length,
    publishers: clonePublishers(store.publishers),
  };

  store.versions.unshift(version);
  appendLogs(store, [
    createLog(
      "save_version",
      operatorName,
      "dataset_version",
      version.id,
      `Captured ${version.publisherCount} publishers in a version snapshot`,
    ),
  ]);

  await writeStore(store);
  return makeWorkbenchState(store, operatorName);
}

export async function listTopDownVersions(): Promise<TopDownVersionMetadata[]> {
  const store = await readStore();
  return store.versions.map(({ id, label, createdAt, createdBy, publisherCount, publishers }) => {
    const flattenedRows = flattenPublisherRows(publishers);
    const csv = buildFlattenedCsv(flattenedRows);
    return {
      id,
      workflow: "top_down",
      label,
      createdAt,
      createdBy,
      schemaVersion: 1,
      publisherCount,
      flattenedAppCount: flattenedRows.length,
      ...getCsvIntegrity(csv),
    };
  });
}

export async function exportTopDownVersionCsv(versionId: string) {
  const store = await readStore();
  const version = store.versions.find((item) => item.id === versionId);
  if (!version) {
    throw new VersionNotFoundError();
  }

  const csv = buildFlattenedCsv(flattenPublisherRows(version.publishers));
  return {
    fileName: `mapping_publisher_to_apps_top_down_${version.id}.csv`,
    csv,
  };
}

export async function restoreTopDownVersion(versionId: string, operatorName: string) {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  const version = store.versions.find((item) => item.id === versionId);

  if (!version) {
    throw new Error("Version not found.");
  }

  store.publishers = clonePublishers(
    version.publishers.map((publisher, index) => normalizePublisherSheet(publisher, index)),
  );
  appendLogs(store, [
    createLog("restore_version", operatorName, "dataset_version", version.id, `Restored ${version.label}`),
  ]);

  await writeStore(store);
  return makeWorkbenchState(store, operatorName);
}

export async function exportTopDownCsv(operatorName: string) {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  const flattenedRows = flattenPublisherRows(store.publishers);
  const csv = buildFlattenedCsv(flattenedRows);
  const fileName = `mapping_publisher_to_apps_top_down_${Date.now()}.csv`;
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
    createLog(
      "export_csv",
      operatorName,
      "dataset_export",
      fileName,
      `Exported ${flattenedRows.length} flattened rows`,
    ),
  ]);

  await writeStore(store);

  return {
    fileName,
    csv,
  };
}

export async function appendTopDownActivityLog(
  action: string,
  actor: string,
  targetType: string,
  targetId: string,
  detail: string,
) {
  ensureAutoRefreshSchedulerStarted();
  const store = await readStore();
  appendLogs(store, [createLog(action, actor, targetType, targetId, detail)]);
  await writeStore(store);
}

export async function runFullSensorTowerRefresh(operatorName = "Local operator") {
  ensureAutoRefreshSchedulerStarted();
  return performSensorTowerFullRefresh(operatorName, "full_refresh_sensortower");
}
