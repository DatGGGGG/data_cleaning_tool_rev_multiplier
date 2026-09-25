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
    return { ...row, isNewApp: !priorAppIds.has(row.appId), isSuspected: true, isChecked: Boolean(publisherReviews[row.publisherName]?.isChecked), needReadjustment: Boolean(review?.needReadjustment), adjustmentMode: review?.adjustmentMode ?? "", adjustedCleanedPublisherName: review?.adjustedCleanedPublisherName ?? "", adjustedRevenueMultiplier: review?.adjustedRevenueMultiplier ?? "", notes: review?.notes ?? "" };
  });
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
    if (!Number.isFinite(multiplier) || multiplier <= 0) errors.push(`App ${row.appId} needs a positive adjusted revenue multiplier.`);
    if (row.adjustmentMode !== "clear" && row.adjustmentMode !== "set") errors.push(`App ${row.appId} needs an explicit publisher adjustment mode.`);
    if (row.adjustmentMode === "set" && !row.adjustedCleanedPublisherName) errors.push(`App ${row.appId} needs an adjusted cleaned publisher.`);
    output.push({ appId: row.appId, cleanedPublisherName: row.adjustmentMode === "clear" ? "" : row.adjustedCleanedPublisherName, revenueMultiplier: row.adjustedRevenueMultiplier });
  }
  return { rows: output, errors };
}
