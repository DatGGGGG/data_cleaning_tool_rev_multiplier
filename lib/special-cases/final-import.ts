import { parseCsvPreview } from "@/lib/csv-preview";
import type { SpecialCaseFinalRow } from "@/lib/special-cases/types";
import { text } from "@/lib/special-cases/workbench";

export class HistoricalFinalImportError extends Error {
  public readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseHistoricalFinalCsv(content: string) {
  const parsed = parseCsvPreview(content);
  const positions = Object.fromEntries(
    parsed.columns.map((column, index) => [text(column).toLowerCase(), index]),
  );
  for (const column of ["app_id", "cleaned_publisher_name", "revenue_multiplier"]) {
    if (positions[column] === undefined)
      throw new HistoricalFinalImportError(`Historical final CSV is missing required column ${column}.`);
  }
  const ids = new Set<string>();
  const rows: SpecialCaseFinalRow[] = [];
  for (const source of parsed.rows) {
    const appId = text(source[positions.app_id]);
    const cleanedPublisherName = text(source[positions.cleaned_publisher_name]);
    const revenueMultiplier = text(source[positions.revenue_multiplier]);
    if (!appId) throw new HistoricalFinalImportError("Historical final CSV contains a blank app_id.");
    if (ids.has(appId)) throw new HistoricalFinalImportError(`Historical final CSV contains duplicate app_id ${appId}.`);
    const multiplier = Number(revenueMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0)
      throw new HistoricalFinalImportError(`App ${appId} needs a positive revenue_multiplier.`);
    ids.add(appId);
    rows.push({ appId, cleanedPublisherName, revenueMultiplier });
  }
  return { rows: rows.sort((left, right) => left.appId.localeCompare(right.appId)), inputRowCount: parsed.rows.length };
}
