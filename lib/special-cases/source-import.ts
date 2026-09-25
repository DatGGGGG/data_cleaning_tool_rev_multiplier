import { parseCsvPreview } from "@/lib/csv-preview";
import type { SpecialCaseSourceRow } from "@/lib/special-cases/types";
import { text } from "@/lib/special-cases/workbench";

export const HISTORICAL_BASELINE_MAX_BYTES = 25 * 1024 * 1024;
const REQUIRED_COLUMNS = ["app_id", "name", "url", "publisher_id", "publisher_name", "cleaned_publisher_name", "revenue_multiplier"] as const;

export class HistoricalBaselineImportError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HistoricalBaselineImportError";
    this.status = status;
  }
}

export type ParsedHistoricalBaseline = {
  rows: SpecialCaseSourceRow[];
  inputRowCount: number;
  uniqueAppCount: number;
  duplicateAppIdCount: number;
};

export function parseHistoricalBaselineCsv(csv: string): ParsedHistoricalBaseline {
  if (!csv.trim()) throw new HistoricalBaselineImportError("The historical baseline CSV is empty.");
  const parsed = parseCsvPreview(csv);
  const positions = new Map<string, number>();
  parsed.columns.forEach((column, index) => {
    const key = text(column);
    if (!key) throw new HistoricalBaselineImportError(`The CSV header at column ${index + 1} is blank.`);
    if (positions.has(key)) throw new HistoricalBaselineImportError(`The CSV has duplicate column ${key}.`);
    positions.set(key, index);
  });
  for (const column of REQUIRED_COLUMNS) {
    if (!positions.has(column)) throw new HistoricalBaselineImportError(`The historical baseline CSV is missing required column ${column}.`);
  }

  const rowsByAppId = new Map<string, SpecialCaseSourceRow>();
  let duplicateAppIdCount = 0;
  for (const [index, values] of parsed.rows.entries()) {
    const get = (column: (typeof REQUIRED_COLUMNS)[number]) => text(values[positions.get(column)!]);
    const appId = get("app_id");
    if (!appId) throw new HistoricalBaselineImportError(`Row ${index + 2} is missing app_id.`);
    if (rowsByAppId.has(appId)) {
      duplicateAppIdCount += 1;
      continue;
    }
    rowsByAppId.set(appId, {
      appId,
      name: get("name"),
      url: get("url"),
      publisherId: get("publisher_id"),
      publisherName: get("publisher_name"),
      cleanedPublisherName: get("cleaned_publisher_name"),
      revenueMultiplier: get("revenue_multiplier"),
    });
  }
  if (!rowsByAppId.size) throw new HistoricalBaselineImportError("The historical baseline CSV has no app rows.");
  const rows = [...rowsByAppId.values()].sort((left, right) => left.appId.localeCompare(right.appId));
  return { rows, inputRowCount: parsed.rows.length, uniqueAppCount: rows.length, duplicateAppIdCount };
}
