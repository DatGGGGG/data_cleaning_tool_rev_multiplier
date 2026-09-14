import { promises as fs } from "node:fs";
import path from "node:path";

export type BottomUpProductionSource = "auto" | "api" | "file";

export type AppSettings = {
  bottomUpProductionSource: BottomUpProductionSource;
  strategyDataApiBaseUrl: string;
  strategyDataApiKey: string;
  strategyDataApiPageSize: number;
  bottomUpSeedCsv: string;
  appFullInfoCurrentNdjson: string;
  updatedAt: string;
  updatedBy: string;
};

export type PublicAppSettings = Omit<AppSettings, "strategyDataApiKey"> & {
  strategyDataApiKey: string;
  strategyDataApiKeyPresent: boolean;
};

const STORAGE_ROOT = path.join(process.cwd(), "storage");
const SETTINGS_PATH = path.join(STORAGE_ROOT, "app-settings.json");
const SETTINGS_TEMP_PATH = path.join(STORAGE_ROOT, "app-settings.json.tmp");

const DEFAULT_BOTTOM_UP_SEED_CSV =
  "D:\\Coding\\vn_strategy_data_system\\manual\\mapping_publisher_to_publisherids_revenue_multiplier_bottom_up_current.csv";
const DEFAULT_APP_FULL_INFO_CURRENT_NDJSON =
  "D:\\Coding\\vn_strategy_data_system\\data\\base\\st_api_app_full_info_current.ndjson";

declare global {
  // eslint-disable-next-line no-var
  var __appSettingsWritePromise: Promise<void> | undefined;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function normalizeProductionSource(value: unknown): BottomUpProductionSource {
  return value === "api" || value === "file" ? value : "auto";
}

function normalizePageSize(value: unknown) {
  const numeric = Number(value);
  return Math.max(1, Math.min(Number.isFinite(numeric) ? Math.floor(numeric) : 500, 500));
}

function envDefaultSettings(): AppSettings {
  return {
    bottomUpProductionSource: normalizeProductionSource(process.env.BOTTOM_UP_PRODUCTION_SOURCE),
    strategyDataApiBaseUrl: normalizeText(process.env.STRATEGY_DATA_API_BASE_URL) || "http://localhost:8000",
    strategyDataApiKey: normalizeText(process.env.STRATEGY_DATA_API_KEY),
    strategyDataApiPageSize: normalizePageSize(process.env.STRATEGY_DATA_API_PAGE_SIZE || 500),
    bottomUpSeedCsv: normalizeText(process.env.BOTTOM_UP_SEED_CSV) || DEFAULT_BOTTOM_UP_SEED_CSV,
    appFullInfoCurrentNdjson:
      normalizeText(process.env.APP_FULL_INFO_CURRENT_NDJSON) || DEFAULT_APP_FULL_INFO_CURRENT_NDJSON,
    updatedAt: nowIso(),
    updatedBy: "system",
  };
}

function normalizeSettings(value: unknown, fallback = envDefaultSettings()): AppSettings {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<AppSettings>;
  return {
    bottomUpProductionSource: normalizeProductionSource(
      candidate.bottomUpProductionSource || fallback.bottomUpProductionSource,
    ),
    strategyDataApiBaseUrl: normalizeText(candidate.strategyDataApiBaseUrl) || fallback.strategyDataApiBaseUrl,
    strategyDataApiKey: normalizeText(candidate.strategyDataApiKey) || fallback.strategyDataApiKey,
    strategyDataApiPageSize: normalizePageSize(candidate.strategyDataApiPageSize || fallback.strategyDataApiPageSize),
    bottomUpSeedCsv: normalizeText(candidate.bottomUpSeedCsv) || fallback.bottomUpSeedCsv,
    appFullInfoCurrentNdjson: normalizeText(candidate.appFullInfoCurrentNdjson) || fallback.appFullInfoCurrentNdjson,
    updatedAt: normalizeText(candidate.updatedAt) || fallback.updatedAt,
    updatedBy: normalizeText(candidate.updatedBy) || fallback.updatedBy,
  };
}

async function ensureStorageDirectory() {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
}

async function readStoredSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf-8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return envDefaultSettings();
    }
    throw error;
  }
}

async function writeStoredSettings(settings: AppSettings) {
  await ensureStorageDirectory();
  const payload = JSON.stringify(settings, null, 2);
  const previousWrite = globalThis.__appSettingsWritePromise ?? Promise.resolve();
  const nextWrite = previousWrite.then(async () => {
    await fs.writeFile(SETTINGS_TEMP_PATH, payload, "utf-8");
    await fs.rename(SETTINGS_TEMP_PATH, SETTINGS_PATH);
  });

  globalThis.__appSettingsWritePromise = nextWrite.catch(() => undefined);
  await nextWrite;
}

export async function getEffectiveAppSettings() {
  return readStoredSettings();
}

export function toPublicAppSettings(settings: AppSettings): PublicAppSettings {
  return {
    ...settings,
    strategyDataApiKey: "",
    strategyDataApiKeyPresent: Boolean(settings.strategyDataApiKey),
  };
}

export async function getPublicAppSettings() {
  return toPublicAppSettings(await getEffectiveAppSettings());
}

export async function updateAppSettings(
  updates: Partial<AppSettings> & { clearStrategyDataApiKey?: boolean },
  operatorName: string,
) {
  const current = await readStoredSettings();
  const next = normalizeSettings({
    ...current,
    ...updates,
    strategyDataApiKey: updates.clearStrategyDataApiKey
      ? ""
      : normalizeText(updates.strategyDataApiKey) || current.strategyDataApiKey,
    updatedAt: nowIso(),
    updatedBy: operatorName,
  });

  await writeStoredSettings(next);
  return toPublicAppSettings(next);
}
