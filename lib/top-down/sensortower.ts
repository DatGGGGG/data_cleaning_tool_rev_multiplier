import {
  buildSensorTowerOptionLabel,
  createIdleResolutionState,
} from "@/lib/top-down/workbench";
import type {
  SensorTowerLocalAppLookupResponse,
  SensorTowerOption,
  SensorTowerPlatform,
  SensorTowerResolveResponse,
  SensorTowerResolutionStatus,
} from "@/lib/top-down/types";

const DEFAULT_BASE_URL = "https://api.sensortower.com";
const UNIFIED_HEX_PATTERN = /^[0-9a-f]{24}$/i;
const IOS_NUMERIC_PATTERN = /^\d+$/;
const ANDROID_PACKAGE_PATTERN = /^(?=.*\.)[A-Za-z0-9._-]+$/;

type LocalAppRecord = {
  app_id?: number | string;
  unified_app_id?: string;
  publisher_name?: string;
  name?: string;
};

type UnifiedAppRecord = {
  unified_app_id?: string;
  name?: string;
  itunes_apps?: Array<{ app_id?: number | string }>;
  android_apps?: Array<{ app_id?: number | string }>;
};

type ParsedOverviewLink = {
  unifiedCandidates: string[];
  iosCandidates: string[];
  androidCandidates: string[];
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function getApiKey() {
  const apiKey = process.env.ST_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing ST_API_KEY. Add it to your local .env file before using SensorTower resolution.");
  }
  return apiKey;
}

function getBaseUrl() {
  return process.env.SENSORTOWER_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function parseSensorTowerOverviewLink(link: string): ParsedOverviewLink {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(link);
  } catch {
    throw new Error("The SensorTower link is not a valid URL.");
  }

  if (!parsedUrl.hostname.toLowerCase().includes("sensortower.com")) {
    throw new Error("The link must come from SensorTower.");
  }

  const segments = parsedUrl.pathname.split("/").map(decodeURIComponent).filter(Boolean);
  const overviewIndex = segments.findIndex((segment) => segment.toLowerCase() === "overview");
  if (overviewIndex === -1) {
    throw new Error("The link must be a SensorTower overview URL.");
  }

  const candidates = segments.slice(overviewIndex + 1);
  if (candidates.length === 0) {
    throw new Error("The SensorTower overview URL does not contain any app identifiers.");
  }

  const unifiedCandidates: string[] = [];
  const iosCandidates: string[] = [];
  const androidCandidates: string[] = [];

  candidates.forEach((candidate, index) => {
    const value = normalizeText(candidate);
    if (!value) {
      return;
    }

    if (index === 0 && UNIFIED_HEX_PATTERN.test(value)) {
      unifiedCandidates.push(value);
      return;
    }

    if (IOS_NUMERIC_PATTERN.test(value)) {
      iosCandidates.push(value);
      return;
    }

    if (ANDROID_PACKAGE_PATTERN.test(value)) {
      androidCandidates.push(value);
    }
  });

  if (unifiedCandidates.length === 0 && iosCandidates.length === 0 && androidCandidates.length === 0) {
    throw new Error("No usable app identifiers were found in the SensorTower link.");
  }

  return {
    unifiedCandidates: dedupeStrings(unifiedCandidates),
    iosCandidates: dedupeStrings(iosCandidates),
    androidCandidates: dedupeStrings(androidCandidates),
  };
}

export async function extractUnifiedAppIdFromOverviewLink(link: string): Promise<string> {
  const trimmedLink = normalizeText(link);
  if (!trimmedLink) {
    return "";
  }

  const parsed = parseSensorTowerOverviewLink(trimmedLink);
  if (parsed.unifiedCandidates[0]) {
    return parsed.unifiedCandidates[0];
  }

  const [iosCandidateRecords, androidCandidateRecords] = await Promise.all([
    fetchLocalAppRecords("ios", parsed.iosCandidates),
    fetchLocalAppRecords("android", parsed.androidCandidates),
  ]);

  const unifiedIdsFromLocalRecords = dedupeStrings(
    [...iosCandidateRecords, ...androidCandidateRecords].map(getLocalRecordUnifiedId),
  );

  if (unifiedIdsFromLocalRecords.length > 1) {
    throw new Error("The SensorTower link points to conflicting unified app IDs.");
  }

  return unifiedIdsFromLocalRecords[0] ?? "";
}

async function sensorTowerRequest<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(endpoint, getBaseUrl());

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`SensorTower request failed (${response.status}) for ${endpoint}.`);
  }

  return (await response.json()) as T;
}

async function fetchLocalAppRecords(
  os: SensorTowerPlatform,
  appIds: string[],
): Promise<LocalAppRecord[]> {
  if (appIds.length === 0) {
    return [];
  }

  const payload = await sensorTowerRequest<{ apps?: LocalAppRecord[] }>(`/v1/${os}/apps`, {
    app_ids: appIds.join(","),
  });

  return payload.apps ?? [];
}

export async function lookupSensorTowerLocalApp(
  os: SensorTowerPlatform,
  appId: string,
): Promise<SensorTowerLocalAppLookupResponse> {
  const normalizedAppId = normalizeText(appId);

  if (!normalizedAppId) {
    return {
      found: false,
      os,
      appId: "",
      errorMessage: "Provide an app ID before validating it.",
    };
  }

  const records = await fetchLocalAppRecords(os, [normalizedAppId]);
  const record = records.find((candidate) => getLocalRecordAppId(candidate) === normalizedAppId);

  if (!record) {
    return {
      found: false,
      os,
      appId: normalizedAppId,
      errorMessage: "SensorTower could not find that app ID.",
    };
  }

  return {
    found: true,
    os,
    appId: normalizedAppId,
    publisherName: normalizeText(record.publisher_name),
    appName: normalizeText(record.name),
    unifiedAppId: normalizeText(record.unified_app_id),
  };
}

async function fetchUnifiedApp(unifiedAppId: string): Promise<UnifiedAppRecord | null> {
  const payload = await sensorTowerRequest<{ apps?: UnifiedAppRecord[] }>("/v1/unified/apps", {
    app_id_type: "unified",
    app_ids: unifiedAppId,
  });

  return payload.apps?.[0] ?? null;
}

function getLocalRecordAppId(record: LocalAppRecord) {
  return normalizeText(record.app_id);
}

function getLocalRecordUnifiedId(record: LocalAppRecord) {
  return normalizeText(record.unified_app_id);
}

function buildOption(
  os: SensorTowerPlatform,
  unifiedAppId: string,
  appId: string,
  localRecord: LocalAppRecord | undefined,
  fallbackAppName: string,
): SensorTowerOption {
  const publisherName = normalizeText(localRecord?.publisher_name);
  const appName = normalizeText(localRecord?.name) || fallbackAppName;

  return {
    appId,
    publisherName,
    appName,
    source: "resolved",
    os,
    unifiedAppId,
    label: buildSensorTowerOptionLabel(publisherName, appId, appName),
  };
}

function extractUnifiedChildIds(record: UnifiedAppRecord, key: "itunes_apps" | "android_apps") {
  const values = Array.isArray(record[key]) ? record[key] : [];
  return dedupeStrings(
    values.map((item) => normalizeText(item?.app_id)),
  );
}

export async function resolveSensorTowerOverviewLink(link: string): Promise<SensorTowerResolveResponse> {
  const trimmedLink = normalizeText(link);
  if (!trimmedLink) {
    return {
      ...createIdleResolutionState(),
      errorMessage: "Provide a SensorTower overview link first.",
    };
  }

  const parsed = parseSensorTowerOverviewLink(trimmedLink);
  const iosCandidateRecords = await fetchLocalAppRecords("ios", parsed.iosCandidates);
  const androidCandidateRecords = await fetchLocalAppRecords("android", parsed.androidCandidates);
  const unifiedIdsFromLocalRecords = dedupeStrings(
    [...iosCandidateRecords, ...androidCandidateRecords].map(getLocalRecordUnifiedId),
  );
  const directUnifiedId = parsed.unifiedCandidates[0] ?? "";

  if (unifiedIdsFromLocalRecords.length > 1) {
    return {
      status: "failed",
      unifiedAppId: "",
      resolvedGameName: "",
      iosOptions: [],
      androidOptions: [],
      errorMessage: "The SensorTower link points to conflicting unified app IDs.",
    };
  }

  if (directUnifiedId && unifiedIdsFromLocalRecords[0] && directUnifiedId !== unifiedIdsFromLocalRecords[0]) {
    return {
      status: "failed",
      unifiedAppId: "",
      resolvedGameName: "",
      iosOptions: [],
      androidOptions: [],
      errorMessage: "The SensorTower link did not resolve to one consistent unified app ID.",
    };
  }

  const unifiedAppId = directUnifiedId || unifiedIdsFromLocalRecords[0] || "";
  if (!unifiedAppId) {
    return {
      status: "failed",
      unifiedAppId: "",
      resolvedGameName: "",
      iosOptions: [],
      androidOptions: [],
      errorMessage: "Unable to determine a unified app ID from the SensorTower link.",
    };
  }

  const unifiedRecord = await fetchUnifiedApp(unifiedAppId);
  if (!unifiedRecord) {
    return {
      status: "failed",
      unifiedAppId,
      resolvedGameName: "",
      iosOptions: [],
      androidOptions: [],
      errorMessage: "SensorTower did not return unified app details for this link.",
    };
  }

  const iosChildIds = extractUnifiedChildIds(unifiedRecord, "itunes_apps");
  const androidChildIds = extractUnifiedChildIds(unifiedRecord, "android_apps");
  const [iosChildRecords, androidChildRecords] = await Promise.all([
    fetchLocalAppRecords("ios", iosChildIds),
    fetchLocalAppRecords("android", androidChildIds),
  ]);

  const iosLookup = new Map(iosChildRecords.map((record) => [getLocalRecordAppId(record), record]));
  const androidLookup = new Map(androidChildRecords.map((record) => [getLocalRecordAppId(record), record]));
  const fallbackAppName = normalizeText(unifiedRecord.name);
  const iosOptions = iosChildIds.map((appId) =>
    buildOption("ios", unifiedAppId, appId, iosLookup.get(appId), fallbackAppName),
  );
  const androidOptions = androidChildIds.map((appId) =>
    buildOption("android", unifiedAppId, appId, androidLookup.get(appId), fallbackAppName),
  );
  const status: SensorTowerResolutionStatus = iosOptions.length === 0 && androidOptions.length === 0 ? "empty" : "resolved";
  const errorMessage =
    status === "empty" ? "SensorTower resolved the game, but no child app IDs were returned." : undefined;

  return {
    status,
    unifiedAppId,
    resolvedGameName: fallbackAppName,
    iosOptions,
    androidOptions,
    errorMessage,
    resolvedAt: new Date().toISOString(),
  };
}
