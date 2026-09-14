import type {
  FlattenedPublisherRow,
  PublisherPlatformEntry,
  PublisherPlatformSource,
  PublisherRowDraft,
  PublisherSheet,
  SensorTowerOption,
  SensorTowerResolutionState,
  SensorTowerResolutionStatus,
} from "@/lib/top-down/types";

type ParsedCsvRow = Record<string, string>;

type LegacyPublisherRowLike = Partial<PublisherRowDraft> & {
  iosAppId?: string;
  iosStoreAccount?: string;
  androidAppId?: string;
  androidStoreAccount?: string;
  sensorTowerResolution?: Partial<SensorTowerResolutionState> | null;
};

function createRowId() {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatAuditDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeText(value: string) {
  return value.replace(/\r/g, "").trim();
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }

  return value;
}

function isPublisherPlatformSource(value: unknown): value is PublisherPlatformSource {
  return value === "resolved" || value === "manual";
}

function isResolutionStatus(value: unknown): value is SensorTowerResolutionStatus {
  return (
    value === "idle" ||
    value === "resolving" ||
    value === "resolved" ||
    value === "failed" ||
    value === "empty"
  );
}

export function buildSensorTowerOptionLabel(publisherName: string, appId: string, appName = "") {
  const primary = publisherName.trim() || appName.trim() || "Unknown publisher";
  return `${primary} | ${appId.trim()}`;
}

export function createPlatformEntry(
  appId = "",
  publisherName = "",
  appName = "",
  source: PublisherPlatformSource = "manual",
): PublisherPlatformEntry {
  return {
    appId,
    publisherName,
    appName,
    source,
  };
}

export function createIdleResolutionState(
  status: SensorTowerResolutionStatus = "idle",
  overrides: Partial<SensorTowerResolutionState> = {},
): SensorTowerResolutionState {
  return {
    status,
    unifiedAppId: "",
    resolvedGameName: "",
    errorMessage: "",
    resolvedAt: "",
    iosOptions: [],
    androidOptions: [],
    ...overrides,
  };
}

function normalizePlatformEntry(value: unknown, fallbackSource: PublisherPlatformSource): PublisherPlatformEntry | null {
  if (typeof value === "string") {
    const appId = normalizeText(value);
    return appId ? createPlatformEntry(appId, "", "", fallbackSource) : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PublisherPlatformEntry> & { id?: string };
  const appId = normalizeText(String(candidate.appId ?? candidate.id ?? ""));
  if (!appId) {
    return null;
  }

  return {
    appId,
    publisherName: normalizeText(String(candidate.publisherName ?? "")),
    appName: normalizeText(String(candidate.appName ?? "")),
    source: isPublisherPlatformSource(candidate.source) ? candidate.source : fallbackSource,
  };
}

function dedupePlatformEntries(entries: PublisherPlatformEntry[]) {
  const seen = new Set<string>();
  const result: PublisherPlatformEntry[] = [];

  for (const entry of entries) {
    const key = entry.appId.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function normalizePlatformEntries(
  currentEntries: unknown,
  legacyAppId = "",
  legacyPublisherName = "",
  fallbackSource: PublisherPlatformSource = "manual",
) {
  const normalized = Array.isArray(currentEntries)
    ? currentEntries
        .map((entry) => normalizePlatformEntry(entry, fallbackSource))
        .filter((entry): entry is PublisherPlatformEntry => Boolean(entry))
    : [];

  if (normalized.length > 0) {
    return dedupePlatformEntries(normalized);
  }

  const legacyEntry = normalizePlatformEntry(
    legacyAppId ? { appId: legacyAppId, publisherName: legacyPublisherName, source: fallbackSource } : null,
    fallbackSource,
  );

  return legacyEntry ? [legacyEntry] : [];
}

function normalizeSensorTowerOption(value: unknown, os: "ios" | "android"): SensorTowerOption | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SensorTowerOption>;
  const entry = normalizePlatformEntry(candidate, "resolved");
  if (!entry) {
    return null;
  }

  const unifiedAppId = normalizeText(String(candidate.unifiedAppId ?? ""));

  return {
    ...entry,
    os,
    unifiedAppId,
    label: normalizeText(String(candidate.label ?? buildSensorTowerOptionLabel(entry.publisherName, entry.appId, entry.appName))),
  };
}

function normalizeResolutionState(value: unknown): SensorTowerResolutionState {
  if (!value || typeof value !== "object") {
    return createIdleResolutionState();
  }

  const candidate = value as Partial<SensorTowerResolutionState>;
  return createIdleResolutionState(isResolutionStatus(candidate.status) ? candidate.status : "idle", {
    unifiedAppId: normalizeText(String(candidate.unifiedAppId ?? "")),
    resolvedGameName: normalizeText(String(candidate.resolvedGameName ?? "")),
    errorMessage: normalizeText(String(candidate.errorMessage ?? "")),
    resolvedAt: normalizeText(String(candidate.resolvedAt ?? "")),
    iosOptions: Array.isArray(candidate.iosOptions)
      ? candidate.iosOptions
          .map((option) => normalizeSensorTowerOption(option, "ios"))
          .filter((option): option is SensorTowerOption => Boolean(option))
      : [],
    androidOptions: Array.isArray(candidate.androidOptions)
      ? candidate.androidOptions
          .map((option) => normalizeSensorTowerOption(option, "android"))
          .filter((option): option is SensorTowerOption => Boolean(option))
      : [],
  });
}

export function createEmptyRow(ordinal: number): PublisherRowDraft {
  return {
    id: createRowId(),
    ordinal,
    gameName: "",
    sensorTowerLink: "",
    iosApps: [],
    androidApps: [],
    sensorTowerResolution: createIdleResolutionState(),
    addingDate: "",
    adder: "",
    reviewStatus: "needs_review",
    notes: "",
  };
}

export function normalizePublisherRow(row: LegacyPublisherRowLike, ordinalFallback = 1): PublisherRowDraft {
  const next = {
    ...createEmptyRow(ordinalFallback),
    ...row,
  };

  return {
    id: typeof next.id === "string" && next.id ? next.id : createRowId(),
    ordinal: typeof next.ordinal === "number" && Number.isFinite(next.ordinal) ? next.ordinal : ordinalFallback,
    gameName: normalizeText(String(next.gameName ?? "")),
    sensorTowerLink: normalizeText(String(next.sensorTowerLink ?? "")),
    iosApps: normalizePlatformEntries(next.iosApps, row.iosAppId, row.iosStoreAccount),
    androidApps: normalizePlatformEntries(next.androidApps, row.androidAppId, row.androidStoreAccount),
    sensorTowerResolution: normalizeResolutionState(next.sensorTowerResolution),
    addingDate: normalizeText(String(next.addingDate ?? "")),
    adder: normalizeText(String(next.adder ?? "")),
    reviewStatus:
      next.reviewStatus === "confirmed" || next.reviewStatus === "seeded" ? next.reviewStatus : "needs_review",
    notes: normalizeText(String(next.notes ?? "")),
  };
}

export function normalizePublisherSheet(
  publisher: Partial<PublisherSheet> & { rows?: unknown },
  indexFallback = 0,
): PublisherSheet {
  const normalizedRows = Array.isArray(publisher.rows)
    ? publisher.rows.map((row, index) => normalizePublisherRow(row as LegacyPublisherRowLike, index + 1))
    : [];

  return {
    id: typeof publisher.id === "string" && publisher.id ? publisher.id : `publisher_${indexFallback + 1}`,
    key: normalizeText(String(publisher.key ?? `publisher_${indexFallback + 1}`)),
    name: normalizeText(String(publisher.name ?? `Publisher ${indexFallback + 1}`)),
    revenueMultiplier: normalizeText(String(publisher.revenueMultiplier ?? "")) || "1",
    rows: normalizedRows.map((row, index) => ({
      ...row,
      ordinal: index + 1,
    })),
  };
}

export function flattenPublisherRows(publishers: PublisherSheet[]): FlattenedPublisherRow[] {
  return publishers.flatMap((publisher) =>
    publisher.rows.flatMap((row) => {
      const flattened: FlattenedPublisherRow[] = [];
      const gameName = normalizeText(row.gameName);
      const sensorTowerLink = normalizeText(row.sensorTowerLink);

      for (const entry of row.iosApps) {
        const appId = normalizeText(entry.appId);
        if (!appId) {
          continue;
        }
        flattened.push({
          id: `${row.id}_ios_${appId}`,
          os: "ios",
          cleanedPublisherName: publisher.name,
          gameName,
          sensorTowerLink,
          appIdTrimmed: appId,
        });
      }

      for (const entry of row.androidApps) {
        const appId = normalizeText(entry.appId);
        if (!appId) {
          continue;
        }
        flattened.push({
          id: `${row.id}_android_${appId}`,
          os: "android",
          cleanedPublisherName: publisher.name,
          gameName,
          sensorTowerLink,
          appIdTrimmed: appId,
        });
      }

      return flattened;
    }),
  );
}

export function buildFlattenedCsv(rows: FlattenedPublisherRow[]) {
  const header = "os,cleaned_publisher_name,game_name,sensor_tower_link,app_id_trimmed";
  const body = rows.map((row) =>
    [
      row.os,
      row.cleanedPublisherName,
      row.gameName,
      row.sensorTowerLink,
      row.appIdTrimmed,
    ]
      .map(csvEscape)
      .join(","),
  );

  return [header, ...body].join("\n");
}

function parseCsv(text: string): ParsedCsvRow[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows.filter((item) => item.some((value) => value.trim() !== ""));
  if (!headerRow) {
    return [];
  }

  return dataRows.map((dataRow) =>
    headerRow.reduce<ParsedCsvRow>((accumulator, header, index) => {
      accumulator[header.trim()] = dataRow[index]?.trim() ?? "";
      return accumulator;
    }, {}),
  );
}

function pickValue(row: ParsedCsvRow, keys: string[]) {
  for (const key of keys) {
    const found = row[key];
    if (typeof found === "string" && found !== "") {
      return found;
    }
  }

  const entries = Object.entries(row);
  const lowerCaseLookup = new Map(entries.map(([key, value]) => [key.trim().toLowerCase(), value]));

  for (const key of keys) {
    const found = lowerCaseLookup.get(key.trim().toLowerCase());
    if (typeof found === "string" && found !== "") {
      return found;
    }
  }

  const wantsGameName = keys.some((key) => key.toLowerCase().includes("game"));
  if (wantsGameName) {
    const fuzzyGameName = entries.find(([header, value]) => {
      const lowerHeader = header.trim().toLowerCase();
      return lowerHeader.includes("game") && value.trim() !== "";
    });

    if (fuzzyGameName) {
      return fuzzyGameName[1];
    }
  }

  return "";
}

function isImportedHeaderRow(row: ParsedCsvRow) {
  const values = Object.values(row).map((value) => value.trim().toLowerCase());

  return values.includes("app id") || values.includes("tãªn store account") || values.includes("ten store account");
}

export function importPublisherRowsFromCsv(text: string): PublisherRowDraft[] {
  const parsedRows = parseCsv(text);

  const importedRows = parsedRows
    .map((parsedRow) => ({
      gameName: pickValue(parsedRow, ["Ten Game", "TÃªn Game", "TÃƒÂªn Game", "game_name", "gameName"]),
      sensorTowerLink: pickValue(parsedRow, ["Link SensorTower", "sensor_tower_link", "sensorTowerLink"]),
      iosAppId: pickValue(parsedRow, ["iOS App ID", "iOS", "ios_app_id", "iosAppId"]),
      iosStoreAccount: pickValue(parsedRow, [
        "Ten Store Account iOS",
        "TÃªn Store Account iOS",
        "TÃƒÂªn Store Account iOS",
        "iOS Store Account",
        "ios_store_account",
      ]),
      androidAppId: pickValue(parsedRow, ["Android App ID", "Android", "android_app_id", "androidAppId"]),
      androidStoreAccount: pickValue(parsedRow, [
        "Ten Store Account Android",
        "TÃªn Store Account Android",
        "TÃƒÂªn Store Account Android",
        "Android Store Account",
        "android_store_account",
      ]),
      addingDate: pickValue(parsedRow, ["Adding Date", "adding_date"]),
      adder: pickValue(parsedRow, ["Adder", "adder"]),
      notes: pickValue(parsedRow, ["Notes", "notes"]),
      raw: parsedRow,
    }))
    .filter((row) => {
      if (isImportedHeaderRow(row.raw)) {
        return false;
      }

      return Boolean(
        row.gameName ||
          row.sensorTowerLink ||
          row.iosAppId ||
          row.androidAppId ||
          row.iosStoreAccount ||
          row.androidStoreAccount,
      );
    });

  return importedRows.map((row, index) =>
    normalizePublisherRow(
      {
        ...createEmptyRow(index + 1),
        gameName: row.gameName,
        sensorTowerLink: row.sensorTowerLink,
        iosApps: row.iosAppId ? [createPlatformEntry(row.iosAppId, row.iosStoreAccount, "", "manual")] : [],
        androidApps: row.androidAppId
          ? [createPlatformEntry(row.androidAppId, row.androidStoreAccount, "", "manual")]
          : [],
        addingDate: row.addingDate,
        adder: row.adder,
        reviewStatus: "seeded",
        notes: row.notes,
        sensorTowerResolution: createIdleResolutionState(),
      },
      index + 1,
    ),
  );
}

export function getPublisherStats(
  publishers: PublisherSheet[],
  flattenedRows: FlattenedPublisherRow[],
  selectedPublisherId: string,
) {
  const selectedPublisher = publishers.find((publisher) => publisher.id === selectedPublisherId) ?? publishers[0];
  const selectedPublisherRows = selectedPublisher ? flattenPublisherRows([selectedPublisher]) : [];
  const appIdCounts = new Map<string, number>();

  for (const row of flattenedRows) {
    const count = appIdCounts.get(row.appIdTrimmed) ?? 0;
    appIdCounts.set(row.appIdTrimmed, count + 1);
  }

  const duplicateCount = [...appIdCounts.values()].filter((count) => count > 1).length;
  const needsReviewCount = publishers.reduce(
    (total, publisher) =>
      total + publisher.rows.filter((row) => row.reviewStatus === "needs_review").length,
    0,
  );

  return {
    selectedPublisherIosCount: selectedPublisherRows.filter((row) => row.os === "ios").length,
    selectedPublisherAndroidCount: selectedPublisherRows.filter((row) => row.os === "android").length,
    duplicateCount,
    needsReviewCount,
  };
}
