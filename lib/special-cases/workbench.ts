import { createHash } from "node:crypto";
import type { SpecialCaseAppReview, SpecialCaseFinalRow, SpecialCaseInvestigationRow, SpecialCasePublisherGroup, SpecialCasePublisherReview, SpecialCaseSourceRow } from "@/lib/special-cases/types";

export function text(value: unknown) { return String(value ?? "").replace(/\r/g, "").trim(); }
export function csvCell(value: unknown) { const normalized = String(value ?? ""); return /[",\n\r]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized; }
export function sha256(content: string) { return createHash("sha256").update(content).digest("hex"); }

export function buildSourceCsv(rows: SpecialCaseSourceRow[]) {
  return ["app_id,name,url,publisher_id,publisher_name,cleaned_publisher_name,revenue_multiplier", ...rows.map((row) => [row.appId,row.name,row.url,row.publisherId,row.publisherName,row.cleanedPublisherName,row.revenueMultiplier].map(csvCell).join(","))].join("\n") + "\n";
}

export function buildFinalCsv(rows: SpecialCaseFinalRow[]) {
  return ["app_id,cleaned_publisher_name,revenue_multiplier", ...rows.map((row) => [row.appId,row.cleanedPublisherName,row.revenueMultiplier].map(csvCell).join(","))].join("\n") + "\n";
}

export function cumulativeBaselineRows(baselineRows: SpecialCaseSourceRow[], currentRows: SpecialCaseSourceRow[]) {
  const baselineIds = new Set(baselineRows.map((row) => text(row.appId)));
  const currentIds = new Set(currentRows.map((row) => text(row.appId)));
  const rowsByAppId = new Map<string, SpecialCaseSourceRow>();
  for (const row of baselineRows) rowsByAppId.set(text(row.appId), row);
  // Current production metadata wins for an app present in both sources.
  for (const row of currentRows) rowsByAppId.set(text(row.appId), row);
  return {
    rows: [...rowsByAppId.values()].sort((left, right) => left.appId.localeCompare(right.appId)),
    addedAppCount: [...currentIds].filter((appId) => !baselineIds.has(appId)).length,
    overlappingAppCount: [...currentIds].filter((appId) => baselineIds.has(appId)).length,
  };
}

export function publisherGroups(rows: SpecialCaseSourceRow[], reviews: Record<string, SpecialCasePublisherReview>, priorAppIds: Set<string>) {
  const values = new Map<string, SpecialCasePublisherGroup>();
  for (const row of rows) {
    const current = values.get(row.publisherName) ?? { publisherName: row.publisherName, cleanedPublisherName: row.cleanedPublisherName, revenueMultiplier: row.revenueMultiplier, appCount: 0, newAppCount: 0, isSuspected: false, isChecked: false, notes: "" };
    current.appCount += 1;
    if (!priorAppIds.has(row.appId)) current.newAppCount += 1;
    const review = reviews[row.publisherName];
    if (review) { current.isSuspected = review.isSuspected; current.isChecked = review.isChecked; current.notes = review.notes; }
    values.set(row.publisherName, current);
  }
  return [...values.values()].sort((a,b) => b.appCount - a.appCount || a.publisherName.localeCompare(b.publisherName));
}

export function investigationRows(rows: SpecialCaseSourceRow[], priorAppIds: Set<string>, publisherReviews: Record<string, SpecialCasePublisherReview>, appReviews: Record<string, SpecialCaseAppReview>) : SpecialCaseInvestigationRow[] {
  return rows.filter((row) => publisherReviews[row.publisherName]?.isSuspected).map((row) => {
    const review = appReviews[row.appId];
    return { ...row, isNewApp: !priorAppIds.has(row.appId), isNewSpecialCase: !priorAppIds.has(row.appId), isHistoricalFinal: false, historicalCleanedPublisherName: "", historicalRevenueMultiplier: "", isSuspected: true, isChecked: Boolean(publisherReviews[row.publisherName]?.isChecked), needReadjustment: Boolean(review?.needReadjustment), adjustmentMode: review?.adjustmentMode ?? "", adjustedCleanedPublisherName: review?.adjustedCleanedPublisherName ?? "", adjustedRevenueMultiplier: review?.adjustedRevenueMultiplier ?? "", notes: review?.notes ?? "" };
  });
}

export function finalWorkingRows(
  currentRows: SpecialCaseSourceRow[],
  priorAppIds: Set<string>,
  publisherReviews: Record<string, SpecialCasePublisherReview>,
  appReviews: Record<string, SpecialCaseAppReview>,
  historicalFinalRows: SpecialCaseFinalRow[],
): SpecialCaseInvestigationRow[] {
  const historicalByAppId = new Map(historicalFinalRows.map((row) => [row.appId, row]));
  const sourceByAppId = new Map(
    currentRows
      .filter((row) => publisherReviews[row.publisherName]?.isSuspected)
      .map((row) => [row.appId, row]),
  );
  const appIds = new Set([...historicalByAppId.keys(), ...sourceByAppId.keys()]);
  return [...appIds].map((appId) => {
    const source = sourceByAppId.get(appId);
    const historical = historicalByAppId.get(appId);
    const review = appReviews[appId];
    const isHistoricalFinal = Boolean(historical);
    const includeInFinal = review ? review.needReadjustment : isHistoricalFinal;
    const inheritedPublisher = historical?.cleanedPublisherName ?? "";
    const inheritedMultiplier = historical?.revenueMultiplier ?? "";
    const adjustmentMode = review?.adjustmentMode ?? (isHistoricalFinal ? (inheritedPublisher ? "set" : "clear") : "");
    return {
      ...(source ?? {
        appId,
        name: "",
        url: "",
        publisherId: "",
        publisherName: "",
        cleanedPublisherName: "",
        revenueMultiplier: "",
      }),
      isNewApp: source ? !priorAppIds.has(appId) : false,
      isNewSpecialCase: !isHistoricalFinal,
      isHistoricalFinal,
      historicalCleanedPublisherName: inheritedPublisher,
      historicalRevenueMultiplier: inheritedMultiplier,
      isSuspected: source ? true : false,
      isChecked: source ? Boolean(publisherReviews[source.publisherName]?.isChecked) : true,
      needReadjustment: includeInFinal,
      adjustmentMode,
      adjustedCleanedPublisherName: review?.adjustedCleanedPublisherName ?? inheritedPublisher,
      adjustedRevenueMultiplier: review?.adjustedRevenueMultiplier ?? inheritedMultiplier,
      notes: review?.notes ?? "",
    };
  }).sort((left, right) => left.appId.localeCompare(right.appId));
}

export function adjustmentRows(rows: SpecialCaseInvestigationRow[]) {
  const errors: string[] = [];
  const appIds = new Set<string>();
  const output: SpecialCaseFinalRow[] = [];
  for (const row of rows.filter((item) => item.needReadjustment)) {
    if (!row.appId) errors.push("An adjusted row is missing app_id.");
    if (appIds.has(row.appId)) errors.push(`Duplicate adjustment for app_id ${row.appId}.`);
    appIds.add(row.appId);
    const multiplier = Number(row.adjustedRevenueMultiplier);
    if (row.adjustedRevenueMultiplier && (!Number.isFinite(multiplier) || multiplier <= 0)) errors.push(`App ${row.appId} needs a positive adjusted revenue multiplier when provided.`);
    if (row.adjustmentMode !== "clear" && row.adjustmentMode !== "set") errors.push(`App ${row.appId} needs an explicit publisher adjustment mode.`);
    if (row.adjustmentMode === "set" && !row.adjustedCleanedPublisherName) errors.push(`App ${row.appId} needs an adjusted cleaned publisher.`);
    output.push({ appId: row.appId, cleanedPublisherName: row.adjustmentMode === "clear" ? "" : row.adjustedCleanedPublisherName, revenueMultiplier: row.adjustedRevenueMultiplier });
  }
  return { rows: output, errors };
}
