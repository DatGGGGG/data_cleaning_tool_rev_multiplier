import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { getEffectiveAppSettings } from "@/lib/app-settings/server";
import { parseCsvPreview } from "@/lib/csv-preview";
import {
  downloadRemoteArtifact,
  getRemoteActiveArtifacts,
  getRemoteArtifact,
} from "@/lib/mapping-artifacts/client";
import type { MappingArtifact } from "@/lib/mapping-artifacts/types";
import type {
  SpecialCaseAppReview,
  SpecialCaseFinalRow,
  SpecialCaseFinalVersion,
  SpecialCaseJob,
  SpecialCasePublisherReview,
  SpecialCaseSourceRow,
  SpecialCaseSourceVersion,
  SpecialCasesOverview,
} from "@/lib/special-cases/types";
import { HistoricalFinalImportError, parseHistoricalFinalCsv } from "@/lib/special-cases/final-import";
import {
  HISTORICAL_BASELINE_MAX_BYTES,
  HistoricalBaselineImportError,
  parseHistoricalBaselineCsv,
} from "@/lib/special-cases/source-import";
import {
  adjustmentRows,
  buildFinalCsv,
  buildSourceCsv,
  cumulativeBaselineRows,
  finalWorkingRows,
  investigationRows,
  publisherGroups,
  sha256,
  text,
} from "@/lib/special-cases/workbench";

const ROOT = path.join(process.cwd(), "storage", "special-cases");
const STORE_PATH = path.join(ROOT, "workbench.json");
const SNAPSHOTS = path.join(ROOT, "source-snapshots");
const FINALS = path.join(ROOT, "final-versions");
const JOBS = path.join(ROOT, "jobs");
const id = (prefix: string) =>
  `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const now = () => new Date().toISOString();

type Store = {
  schemaVersion: number;
  sourceVersions: SpecialCaseSourceVersion[];
  finalVersions: SpecialCaseFinalVersion[];
  currentSourceVersionId: string | null;
  comparisonSourceVersionId: string | null;
  selectedFinalBaselineVersionId: string | null;
  publisherReviews: Record<string, SpecialCasePublisherReview>;
  reviewsBySource: Record<string, Record<string, SpecialCaseAppReview>>;
};
type Snapshot = SpecialCaseSourceVersion & { rows: SpecialCaseSourceRow[] };
declare global {
  var __specialCasesWrite: Promise<void> | undefined;
}

function emptyStore(): Store {
  return {
    schemaVersion: 1,
    sourceVersions: [],
    finalVersions: [],
    currentSourceVersionId: null,
    comparisonSourceVersionId: null,
    selectedFinalBaselineVersionId: null,
    publisherReviews: {},
    reviewsBySource: {},
  };
}
async function dirs() {
  await Promise.all([
    fs.mkdir(SNAPSHOTS, { recursive: true }),
    fs.mkdir(FINALS, { recursive: true }),
    fs.mkdir(JOBS, { recursive: true }),
  ]);
}
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}
async function atomic(file: string, value: unknown) {
  await dirs();
  const temp = `${file}.${id("tmp")}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, file);
}
function normalizeSourceVersion(
  source: SpecialCaseSourceVersion,
): SpecialCaseSourceVersion {
  return {
    ...source,
    sourceType: source.sourceType ?? "file",
    fullArtifactId: source.fullArtifactId ?? null,
    fullArtifactChecksum: source.fullArtifactChecksum ?? null,
    originalFilename: source.originalFilename ?? null,
    importedRowCount: source.importedRowCount ?? null,
    duplicateAppIdCount: source.duplicateAppIdCount ?? null,
    baseBaselineSourceVersionId: source.baseBaselineSourceVersionId ?? null,
    mergedCurrentSourceVersionId: source.mergedCurrentSourceVersionId ?? null,
    baseBaselineChecksum: source.baseBaselineChecksum ?? null,
    mergedCurrentSourceChecksum: source.mergedCurrentSourceChecksum ?? null,
    addedAppCount: source.addedAppCount ?? null,
    overlappingAppCount: source.overlappingAppCount ?? null,
  };
}
function normalizeFinalVersion(version: SpecialCaseFinalVersion): SpecialCaseFinalVersion {
  return {
    ...version,
    sourceVersionId: version.sourceVersionId ?? null,
    fullArtifactId: version.fullArtifactId ?? null,
    historicalVersionId: version.historicalVersionId ?? null,
    versionType: version.versionType ?? "generated",
    originalFilename: version.originalFilename ?? null,
    importedRowCount: version.importedRowCount ?? null,
  };
}
async function store() {
  const current = await readJson<Store>(STORE_PATH, emptyStore());
  current.sourceVersions = current.sourceVersions.map(normalizeSourceVersion);
  current.finalVersions = current.finalVersions.map(normalizeFinalVersion);
  current.selectedFinalBaselineVersionId ??= null;
  return current;
}
async function mutate<T>(fn: (current: Store) => Promise<T> | T): Promise<T> {
  const previous = globalThis.__specialCasesWrite ?? Promise.resolve();
  let result!: T;
  const next = previous.then(async () => {
    const current = await store();
    result = await fn(current);
    await atomic(STORE_PATH, current);
  });
  globalThis.__specialCasesWrite = next.catch(() => undefined);
  await next;
  return result;
}
function snapshotPath(sourceVersionId: string) {
  return path.join(SNAPSHOTS, `${sourceVersionId}.json`);
}
function finalPath(versionId: string) {
  return path.join(FINALS, `${versionId}.csv`);
}
function reviewContextKey(sourceVersionId: string, finalBaselineVersionId: string | null) {
  return `${sourceVersionId}::${finalBaselineVersionId ?? "none"}`;
}
async function readFinalRows(versionId: string): Promise<SpecialCaseFinalRow[]> {
  const parsed = parseCsvPreview(await fs.readFile(finalPath(versionId), "utf8"));
  return parsed.rows.map((row) => ({
    appId: text(row[0]),
    cleanedPublisherName: text(row[1]),
    revenueMultiplier: text(row[2]),
  }));
}
function jobPath(jobId: string) {
  return path.join(JOBS, `${jobId}.json`);
}
async function readSnapshot(sourceVersionId: string) {
  const snapshot = await readJson<Snapshot | null>(
    snapshotPath(sourceVersionId),
    null,
  );
  if (!snapshot) throw new Error("Special Cases source version was not found.");
  return { ...normalizeSourceVersion(snapshot), rows: snapshot.rows };
}
async function writeJob(job: SpecialCaseJob) {
  await atomic(jobPath(job.id), job);
}
export async function getSpecialCaseJob(jobId: string) {
  const job = await readJson<SpecialCaseJob | null>(jobPath(jobId), null);
  if (!job) throw new Error("Special Cases source-load job was not found.");
  return job;
}

function requireFullArtifact(artifact: MappingArtifact) {
  if (artifact.artifact_type !== "full" || artifact.status !== "committed")
    throw new Error("Choose a committed Full Mapping artifact.");
}
function fullIndex(csv: string) {
  const parsed = parseCsvPreview(csv);
  const positions = Object.fromEntries(
    parsed.columns.map((column, index) => [text(column), index]),
  );
  for (const required of [
    "cleaned_publisher_name",
    "publisher_id",
    "publisher_name",
    "revenue_multiplier",
  ])
    if (positions[required] === undefined)
      throw new Error(`Full Mapping is missing required column ${required}.`);
  const values = new Map<
    string,
    {
      cleanedPublisherName: string;
      publisherName: string;
      revenueMultiplier: string;
    }
  >();
  for (const row of parsed.rows) {
    const publisherId = text(row[positions.publisher_id]);
    if (publisherId)
      values.set(publisherId, {
        cleanedPublisherName: text(row[positions.cleaned_publisher_name]),
        publisherName: text(row[positions.publisher_name]),
        revenueMultiplier: text(row[positions.revenue_multiplier]),
      });
  }
  return values;
}

function appFromRecord(
  record: Record<string, unknown>,
  mapping: Map<
    string,
    {
      cleanedPublisherName: string;
      publisherName: string;
      revenueMultiplier: string;
    }
  >,
): SpecialCaseSourceRow | null {
  const publisherId = text(record.publisher_id);
  const match = mapping.get(publisherId);
  const appId = text(record.app_id);
  if (!match || !appId) return null;
  return {
    appId,
    name: text(record.name),
    url: text(record.url || record.sensor_tower_link),
    publisherId,
    publisherName: text(record.publisher_name) || match.publisherName,
    cleanedPublisherName: match.cleanedPublisherName,
    revenueMultiplier: match.revenueMultiplier,
  };
}

async function loadFromFile(
  mapping: Map<
    string,
    {
      cleanedPublisherName: string;
      publisherName: string;
      revenueMultiplier: string;
    }
  >,
  onProgress: (scanned: number, matched: number) => Promise<void>,
) {
  const settings = await getEffectiveAppSettings();
  const rows: SpecialCaseSourceRow[] = [];
  let scanned = 0;
  let matched = 0;
  const input = createInterface({
    input: createReadStream(settings.appFullInfoCurrentNdjson),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (!line.trim()) continue;
    scanned++;
    try {
      const row = appFromRecord(
        JSON.parse(line) as Record<string, unknown>,
        mapping,
      );
      if (row) {
        rows.push(row);
        matched++;
      }
    } catch {}
    if (scanned % 1000 === 0) await onProgress(scanned, matched);
  }
  return { rows, scanned, matched, sourceType: "file" as const };
}
async function loadFromApi(
  mapping: Map<
    string,
    {
      cleanedPublisherName: string;
      publisherName: string;
      revenueMultiplier: string;
    }
  >,
  onProgress: (
    scanned: number,
    matched: number,
    pages: number,
  ) => Promise<void>,
) {
  const settings = await getEffectiveAppSettings();
  if (!settings.strategyDataApiBaseUrl || !settings.strategyDataApiKey)
    throw new Error("Strategy Data API credentials are not configured.");
  const rows: SpecialCaseSourceRow[] = [];
  let scanned = 0,
    matched = 0,
    pages = 0,
    offset = 0;
  const pageSize = settings.strategyDataApiPageSize;
  while (true) {
    const response = await fetch(
      `${settings.strategyDataApiBaseUrl.replace(/\/$/, "")}/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": settings.strategyDataApiKey,
        },
        body: JSON.stringify({
          sql: `SELECT app_id, name, url, publisher_id, publisher_name FROM core.dim_app_info WHERE app_id IS NOT NULL ORDER BY app_id LIMIT ${pageSize} OFFSET ${offset}`,
          max_rows: pageSize,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(`Strategy Data API returned HTTP ${response.status}.`);
    const page = Array.isArray(payload.rows) ? payload.rows : [];
    pages++;
    for (const item of page) {
      scanned++;
      const row = appFromRecord(item as Record<string, unknown>, mapping);
      if (row) {
        rows.push(row);
        matched++;
      }
    }
    await onProgress(scanned, matched, pages);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return { rows, scanned, matched, sourceType: "api" as const };
}

async function loadCurrentApps(
  mapping: Map<
    string,
    {
      cleanedPublisherName: string;
      publisherName: string;
      revenueMultiplier: string;
    }
  >,
  report: (scanned: number, matched: number, pages: number) => Promise<void>,
) {
  const settings = await getEffectiveAppSettings();
  const source =
    settings.bottomUpProductionSource === "auto"
      ? settings.strategyDataApiKey
        ? "api"
        : "file"
      : settings.bottomUpProductionSource;
  if (source === "api") return loadFromApi(mapping, report);
  return loadFromFile(mapping, (scanned, matched) =>
    report(scanned, matched, 0),
  );
}

export async function startSpecialCaseSourceJob(
  fullArtifactId: string,
  actor: string,
) {
  const artifact = (await getRemoteArtifact(fullArtifactId)).artifact;
  requireFullArtifact(artifact);
  const job: SpecialCaseJob = {
    id: id("special_cases_source"),
    status: "queued",
    stage: "Queued",
    message: "Preparing current App Full Info source snapshot.",
    pagesRead: 0,
    scannedRecords: 0,
    matchedRecords: 0,
    expectedRecordCount: 0,
    fullArtifactId,
    resultSourceVersionId: null,
    error: null,
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
  };
  await writeJob(job);
  void runSourceJob(job, artifact, actor);
  return job;
}
async function runSourceJob(
  job: SpecialCaseJob,
  artifact: MappingArtifact,
  actor: string,
) {
  try {
    job.status = "running";
    job.stage = "Downloading Full Mapping";
    job.startedAt = now();
    await writeJob(job);
    const downloaded = await downloadRemoteArtifact(artifact.id);
    const csv = Buffer.from(downloaded.body).toString("utf8");
    if (sha256(csv) !== artifact.checksum_sha256)
      throw new Error(
        "Downloaded Full Mapping checksum did not match artifact metadata.",
      );
    const mapping = fullIndex(csv);
    job.stage = "Loading App Full Info";
    job.message =
      "Joining current apps to the selected committed Full Mapping.";
    await writeJob(job);
    const loaded = await loadCurrentApps(
      mapping,
      async (scanned, matched, pages) => {
        job.scannedRecords = scanned;
        job.matchedRecords = matched;
        job.pagesRead = pages;
        job.message = `Scanned ${scanned.toLocaleString()} apps; matched ${matched.toLocaleString()} apps.`;
        await writeJob(job);
      },
    );
    const distinct = [
      ...new Map(loaded.rows.map((row) => [row.appId, row])).values(),
    ].sort((a, b) => a.appId.localeCompare(b.appId));
    const csvContent = buildSourceCsv(distinct);
    const source: Snapshot = {
      id: id("special_cases_source_version"),
      label: `Current App Full Info ${new Date().toLocaleString()}`,
      createdAt: now(),
      createdBy: actor,
      fullArtifactId: artifact.id,
      fullArtifactChecksum: artifact.checksum_sha256,
      rowCount: distinct.length,
      checksum: sha256(csvContent),
      sourceType: loaded.sourceType,
      originalFilename: null,
      importedRowCount: null,
      duplicateAppIdCount: null,
      baseBaselineSourceVersionId: null,
      mergedCurrentSourceVersionId: null,
      baseBaselineChecksum: null,
      mergedCurrentSourceChecksum: null,
      addedAppCount: null,
      overlappingAppCount: null,
      rows: distinct,
    };
    await atomic(snapshotPath(source.id), source);
    await mutate((current) => {
      const { rows: _rows, ...metadata } = source;
      current.sourceVersions.unshift(metadata);
      current.currentSourceVersionId = source.id;
      current.reviewsBySource[source.id] = {};
    });
    job.status = "success";
    job.stage = "Complete";
    job.message = `Saved ${distinct.length.toLocaleString()} apps in an immutable source version.`;
    job.scannedRecords = loaded.scanned;
    job.matchedRecords = distinct.length;
    job.resultSourceVersionId = source.id;
    job.finishedAt = now();
    await writeJob(job);
  } catch (error) {
    job.status = "failed";
    job.stage = "Failed";
    job.error =
      error instanceof Error
        ? error.message
        : "Could not load Special Cases source.";
    job.message = job.error;
    job.finishedAt = now();
    await writeJob(job);
  }
}

export async function getSpecialCasesOverview(
  canMutate: boolean,
): Promise<SpecialCasesOverview> {
  const current = await store();
  const selected = current.currentSourceVersionId
    ? await readSnapshot(current.currentSourceVersionId)
    : null;
  const prior = current.comparisonSourceVersionId
    ? await readSnapshot(current.comparisonSourceVersionId)
    : null;
  const active =
    (await getRemoteActiveArtifacts()).active.full?.artifact.id ?? null;
  const priorIds = new Set(prior?.rows.map((row) => row.appId) ?? []);
  const selectedFinalBaseline = current.selectedFinalBaselineVersionId
    ? await readFinalRows(current.selectedFinalBaselineVersionId)
    : [];
  return {
    sourceVersions: current.sourceVersions,
    finalVersions: current.finalVersions,
    currentSourceVersionId: current.currentSourceVersionId,
    comparisonSourceVersionId: current.comparisonSourceVersionId,
    selectedFinalBaselineVersionId: current.selectedFinalBaselineVersionId,
    activeFullArtifactId: active,
    publisherGroups: selected
      ? publisherGroups(selected.rows, current.publisherReviews, priorIds)
      : [],
    knownCleanedPublishers: [
      ...new Set(
        [
          ...(selected?.rows.map((row) => row.cleanedPublisherName) ?? []),
          ...selectedFinalBaseline.map((row) => row.cleanedPublisherName),
        ].filter(Boolean),
      ),
    ].sort(),
    canMutate,
  };
}
export function isComparisonBaseline(source: SpecialCaseSourceVersion) {
  return (
    source.sourceType === "uploaded_baseline" ||
    source.sourceType === "cumulative_baseline"
  );
}
export async function setComparisonSourceVersion(
  sourceVersionId: string | null,
) {
  await mutate((current) => {
    if (!sourceVersionId) {
      current.comparisonSourceVersionId = null;
      return;
    }
    const source = current.sourceVersions.find(
      (item) => item.id === sourceVersionId,
    );
    if (!source) throw new Error("Selected comparison baseline was not found.");
    if (!isComparisonBaseline(source))
      throw new Error(
        "Only historical or cumulative baseline versions can be used for comparison.",
      );
    current.comparisonSourceVersionId = source.id;
  });
}
export async function importSpecialCaseHistoricalBaseline(
  input: { filename: string; mimeType: string; bytes: Uint8Array },
  actor: string,
) {
  const filename = text(input.filename);
  if (!filename.toLowerCase().endsWith(".csv"))
    throw new HistoricalBaselineImportError(
      "Choose a CSV file for the historical baseline.",
    );
  if (!input.bytes.length)
    throw new HistoricalBaselineImportError(
      "The historical baseline CSV is empty.",
    );
  if (input.bytes.length > HISTORICAL_BASELINE_MAX_BYTES)
    throw new HistoricalBaselineImportError(
      "The historical baseline CSV exceeds the 25 MB limit.",
      413,
    );
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw new HistoricalBaselineImportError(
      "The historical baseline CSV must be UTF-8 encoded.",
    );
  }
  const parsed = parseHistoricalBaselineCsv(content);
  const canonicalCsv = buildSourceCsv(parsed.rows);
  const checksum = sha256(canonicalCsv);
  const result = await mutate(async (current) => {
    const existing = current.sourceVersions.find(
      (item) =>
        item.sourceType === "uploaded_baseline" && item.checksum === checksum,
    );
    if (existing) {
      current.comparisonSourceVersionId = existing.id;
      return { sourceVersion: existing, alreadyExisted: true };
    }
    const source: Snapshot = {
      id: id("special_cases_source_version"),
      label: `Historical baseline ${new Date().toLocaleString()}`,
      createdAt: now(),
      createdBy: actor,
      fullArtifactId: null,
      fullArtifactChecksum: null,
      rowCount: parsed.uniqueAppCount,
      checksum,
      sourceType: "uploaded_baseline",
      originalFilename: filename,
      importedRowCount: parsed.inputRowCount,
      duplicateAppIdCount: parsed.duplicateAppIdCount,
      baseBaselineSourceVersionId: null,
      mergedCurrentSourceVersionId: null,
      baseBaselineChecksum: null,
      mergedCurrentSourceChecksum: null,
      addedAppCount: null,
      overlappingAppCount: null,
      rows: parsed.rows,
    };
    await atomic(snapshotPath(source.id), source);
    const { rows: _rows, ...metadata } = source;
    current.sourceVersions.unshift(metadata);
    current.comparisonSourceVersionId = source.id;
    return { sourceVersion: metadata, alreadyExisted: false };
  });
  return {
    ...result,
    inputRowCount: parsed.inputRowCount,
    uniqueAppCount: parsed.uniqueAppCount,
    duplicateAppIdCount: parsed.duplicateAppIdCount,
  };
}
export async function importSpecialCaseHistoricalFinal(
  input: { filename: string; bytes: Uint8Array },
  actor: string,
) {
  const filename = text(input.filename);
  if (!filename.toLowerCase().endsWith(".csv"))
    throw new HistoricalFinalImportError("Choose a CSV file for the historical final version.");
  if (!input.bytes.length)
    throw new HistoricalFinalImportError("The historical final CSV is empty.");
  if (input.bytes.length > HISTORICAL_BASELINE_MAX_BYTES)
    throw new HistoricalFinalImportError("The historical final CSV exceeds the 25 MB limit.", 413);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw new HistoricalFinalImportError("The historical final CSV must be UTF-8 encoded.");
  }
  const parsed = parseHistoricalFinalCsv(content);
  const canonicalCsv = buildFinalCsv(parsed.rows);
  const checksum = sha256(canonicalCsv);
  return mutate(async (current) => {
    const existing = current.finalVersions.find(
      (version) => version.versionType === "uploaded_history" && version.checksum === checksum,
    );
    if (existing) {
      current.selectedFinalBaselineVersionId = existing.id;
      return { version: existing, alreadyExisted: true, inputRowCount: parsed.inputRowCount };
    }
    const version: SpecialCaseFinalVersion = {
      id: id("special_cases_final"),
      label: `Historical Final Special Cases ${new Date().toLocaleString()}`,
      createdAt: now(),
      createdBy: actor,
      rowCount: parsed.rows.length,
      checksum,
      sourceVersionId: null,
      fullArtifactId: null,
      historicalVersionId: null,
      versionType: "uploaded_history",
      originalFilename: filename,
      importedRowCount: parsed.inputRowCount,
    };
    await dirs();
    await fs.writeFile(finalPath(version.id), canonicalCsv, "utf8");
    current.finalVersions.unshift(version);
    current.selectedFinalBaselineVersionId = version.id;
    return { version, alreadyExisted: false, inputRowCount: parsed.inputRowCount };
  });
}
export async function setSelectedFinalBaselineVersion(finalVersionId: string | null) {
  await mutate((current) => {
    if (!finalVersionId) {
      current.selectedFinalBaselineVersionId = null;
      return;
    }
    if (!current.finalVersions.some((version) => version.id === finalVersionId))
      throw new Error("Selected Historical Final Special Cases version was not found.");
    current.selectedFinalBaselineVersionId = finalVersionId;
  });
}
export async function createCumulativeSpecialCaseBaseline(
  baseBaselineSourceVersionId: string,
  appFullInfoSourceVersionId: string,
  actor: string,
) {
  return mutate(async (current) => {
    const baselineMetadata = current.sourceVersions.find(
      (item) => item.id === baseBaselineSourceVersionId,
    );
    if (!baselineMetadata) throw new Error("Selected baseline was not found.");
    if (!isComparisonBaseline(baselineMetadata))
      throw new Error("Choose a historical or cumulative baseline.");
    const appSourceMetadata = current.sourceVersions.find(
      (item) => item.id === appFullInfoSourceVersionId,
    );
    if (!appSourceMetadata)
      throw new Error("Selected App Full Info source was not found.");
    if (
      appSourceMetadata.sourceType !== "api" &&
      appSourceMetadata.sourceType !== "file"
    )
      throw new Error("Choose a production App Full Info source to merge.");
    const baseline = await readSnapshot(baselineMetadata.id);
    const appSource = await readSnapshot(appSourceMetadata.id);
    if (!appSource.fullArtifactId || !appSource.fullArtifactChecksum)
      throw new Error(
        "The selected App Full Info source is missing Full Mapping lineage.",
      );
    const { rows, addedAppCount, overlappingAppCount } = cumulativeBaselineRows(
      baseline.rows,
      appSource.rows,
    );
    const csv = buildSourceCsv(rows);
    const checksum = sha256(csv);
    const existing = current.sourceVersions.find(
      (item) =>
        item.sourceType === "cumulative_baseline" &&
        item.checksum === checksum &&
        item.baseBaselineSourceVersionId === baseline.id &&
        item.mergedCurrentSourceVersionId === appSource.id,
    );
    if (existing) return { sourceVersion: existing, alreadyExisted: true };
    const source: Snapshot = {
      id: id("special_cases_source_version"),
      label: `Cumulative baseline ${new Date().toLocaleString()}`,
      createdAt: now(),
      createdBy: actor,
      fullArtifactId: appSource.fullArtifactId,
      fullArtifactChecksum: appSource.fullArtifactChecksum,
      rowCount: rows.length,
      checksum,
      sourceType: "cumulative_baseline",
      originalFilename: null,
      importedRowCount: null,
      duplicateAppIdCount: null,
      baseBaselineSourceVersionId: baseline.id,
      mergedCurrentSourceVersionId: appSource.id,
      baseBaselineChecksum: baseline.checksum,
      mergedCurrentSourceChecksum: appSource.checksum,
      addedAppCount,
      overlappingAppCount,
      rows,
    };
    await atomic(snapshotPath(source.id), source);
    const { rows: _rows, ...metadata } = source;
    current.sourceVersions.unshift(metadata);
    return { sourceVersion: metadata, alreadyExisted: false };
  });
}
export async function savePublisherReviews(
  entries: Array<
    Pick<
      SpecialCasePublisherReview,
      "publisherName" | "isSuspected" | "isChecked" | "notes"
    >
  >,
  actor: string,
) {
  await mutate((current) => {
    for (const entry of entries) {
      const name = text(entry.publisherName);
      if (name)
        current.publisherReviews[name] = {
          publisherName: name,
          isSuspected: Boolean(entry.isSuspected),
          isChecked: Boolean(entry.isChecked),
          notes: text(entry.notes),
          updatedAt: now(),
          updatedBy: actor,
        };
    }
  });
}
export async function saveAppReviews(
  sourceVersionId: string,
  finalBaselineVersionId: string | null,
  entries: Array<Omit<SpecialCaseAppReview, "updatedAt" | "updatedBy">>,
  actor: string,
) {
  await mutate((current) => {
    if (!current.sourceVersions.some((item) => item.id === sourceVersionId))
      throw new Error("Source version was not found.");
    if (finalBaselineVersionId !== current.selectedFinalBaselineVersionId)
      throw new Error("Historical Final Special Cases selection changed. Refresh Step 4 before saving.");
    const contextKey = reviewContextKey(sourceVersionId, finalBaselineVersionId);
    const target = (current.reviewsBySource[contextKey] ??= {});
    for (const entry of entries) {
      target[entry.appId] = {
        ...entry,
        appId: text(entry.appId),
        needReadjustment: Boolean(entry.needReadjustment),
        adjustmentMode:
          entry.adjustmentMode === "clear" || entry.adjustmentMode === "set"
            ? entry.adjustmentMode
            : "",
        adjustedCleanedPublisherName: text(entry.adjustedCleanedPublisherName),
        adjustedRevenueMultiplier: text(entry.adjustedRevenueMultiplier),
        notes: text(entry.notes),
        updatedAt: now(),
        updatedBy: actor,
      };
    }
    current.reviewsBySource[contextKey] = target;
  });
}
export async function getInvestigationPage(query: {
  page: number;
  pageSize: number;
  search: string;
  newOnly: boolean;
  adjustmentsOnly: boolean;
  incompleteOnly: boolean;
}) {
  const current = await store();
  if (!current.currentSourceVersionId) return { rows: [], total: 0 };
  const selected = await readSnapshot(current.currentSourceVersionId);
  const prior = current.comparisonSourceVersionId
    ? await readSnapshot(current.comparisonSourceVersionId)
    : null;
  const finalBaseline = current.selectedFinalBaselineVersionId
    ? await readFinalRows(current.selectedFinalBaselineVersionId)
    : [];
  const contextKey = reviewContextKey(
    selected.id,
    current.selectedFinalBaselineVersionId,
  );
  let rows = finalWorkingRows(
    selected.rows,
    new Set(prior?.rows.map((row) => row.appId) ?? []),
    current.publisherReviews,
    current.reviewsBySource[contextKey] ?? current.reviewsBySource[selected.id] ?? {},
    finalBaseline,
  );
  const needle = text(query.search).toLowerCase();
  if (needle)
    rows = rows.filter((row) =>
      [
        row.appId,
        row.name,
        row.publisherName,
        row.cleanedPublisherName,
        row.publisherId,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  if (query.newOnly) rows = rows.filter((row) => row.isNewSpecialCase);
  if (query.adjustmentsOnly) rows = rows.filter((row) => row.needReadjustment);
  if (query.incompleteOnly)
    rows = rows.filter(
      (row) =>
        row.needReadjustment &&
        (!row.adjustmentMode ||
          (row.adjustmentMode === "set" && !row.adjustedCleanedPublisherName)),
    );
  rows.sort(
    (a, b) =>
      a.publisherName.localeCompare(b.publisherName) ||
      a.name.localeCompare(b.name),
  );
  const total = rows.length;
  const start =
    (Math.max(1, query.page) - 1) * Math.max(1, Math.min(100, query.pageSize));
  return {
    rows: rows.slice(start, start + Math.max(1, Math.min(100, query.pageSize))),
    total,
  };
}
export async function createSpecialCaseFinalVersion(actor: string) {
  const current = await store();
  if (!current.currentSourceVersionId)
    throw new Error(
      "Load a current source version before saving final Special Cases.",
    );
  const source = await readSnapshot(current.currentSourceVersionId);
  if (
    source.sourceType === "uploaded_baseline" ||
    !source.fullArtifactId ||
    !source.fullArtifactChecksum
  )
    throw new Error(
      "A Special Cases final version can only be generated from a production source with Full Mapping lineage.",
    );
  const prior = current.comparisonSourceVersionId
    ? await readSnapshot(current.comparisonSourceVersionId)
    : null;
  const finalBaseline = current.selectedFinalBaselineVersionId
    ? await readFinalRows(current.selectedFinalBaselineVersionId)
    : [];
  if (current.finalVersions.length && !current.selectedFinalBaselineVersionId)
    throw new Error("Select a Historical Final Special Cases baseline before saving.");
  const contextKey = reviewContextKey(source.id, current.selectedFinalBaselineVersionId);
  const examined = finalWorkingRows(
    source.rows,
    new Set(prior?.rows.map((row) => row.appId) ?? []),
    current.publisherReviews,
    current.reviewsBySource[contextKey] ?? current.reviewsBySource[source.id] ?? {},
    finalBaseline,
  );
  const thisTime = adjustmentRows(examined);
  if (thisTime.errors.length) throw new Error(thisTime.errors.join(" "));
  const rows = thisTime.rows.sort((a, b) => a.appId.localeCompare(b.appId));
  const csv = buildFinalCsv(rows);
  const version: SpecialCaseFinalVersion = {
    id: id("special_cases_final"),
    label: `Special Cases ${new Date().toLocaleString()}`,
    createdAt: now(),
    createdBy: actor,
    rowCount: rows.length,
    checksum: sha256(csv),
    sourceVersionId: source.id,
    fullArtifactId: source.fullArtifactId,
    historicalVersionId: current.selectedFinalBaselineVersionId,
    versionType: "generated",
    originalFilename: null,
    importedRowCount: null,
  };
  await fs.writeFile(finalPath(version.id), csv, "utf8");
  await mutate((next) => {
    next.finalVersions.unshift(version);
    next.selectedFinalBaselineVersionId = version.id;
  });
  return version;
}
export async function downloadSpecialCaseSource(id: string) {
  const snapshot = await readSnapshot(id);
  return {
    filename: `special_cases_source_${id}.csv`,
    content: buildSourceCsv(snapshot.rows),
  };
}
export async function downloadSpecialCaseFinal(id: string) {
  await getSpecialCaseFinalVersion(id);
  return {
    filename: `mapping_app_to_revenue_multiplier_special_cases_${id}.csv`,
    content: await fs.readFile(finalPath(id), "utf8"),
  };
}

export async function getSpecialCaseFinalVersion(id: string) {
  const current = await store();
  const version = current.finalVersions.find((item) => item.id === id);
  if (!version) throw new Error("Special Cases final version was not found.");
  return version;
}
