import type {
  SpecialCaseInvestigationFilterField,
  SpecialCaseInvestigationFilterOperator,
  SpecialCaseInvestigationFilterRule,
  SpecialCaseInvestigationRow,
  SpecialCaseInvestigationSortDirection,
  SpecialCaseInvestigationSortField,
} from "@/lib/special-cases/types";

export const INVESTIGATION_FILTER_FIELDS: readonly SpecialCaseInvestigationFilterField[] = [
  "all", "appId", "name", "url", "publisherId", "publisherName",
  "cleanedPublisherName", "revenueMultiplier", "historicalCleanedPublisherName", "historicalRevenueMultiplier", "isNewSpecialCase",
  "isHistoricalFinal", "needReadjustment", "incomplete", "isChecked",
  "adjustmentMode", "adjustedCleanedPublisherName", "adjustedRevenueMultiplier", "notes",
] as const;

export const INVESTIGATION_FILTER_OPERATORS: readonly SpecialCaseInvestigationFilterOperator[] = [
  "contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with",
  "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal",
  "is_blank", "is_not_blank", "is", "is_not",
] as const;

export const INVESTIGATION_SORT_FIELDS: readonly SpecialCaseInvestigationSortField[] = [
  "appId", "name", "publisherId", "publisherName", "cleanedPublisherName",
  "revenueMultiplier", "isNewSpecialCase", "isHistoricalFinal", "needReadjustment",
  "isChecked", "adjustmentMode", "adjustedCleanedPublisherName", "adjustedRevenueMultiplier",
] as const;

export const TEXT_FILTER_FIELDS = new Set<SpecialCaseInvestigationFilterField>([
  "all", "appId", "name", "url", "publisherId", "publisherName", "cleanedPublisherName", "historicalCleanedPublisherName",
  "adjustedCleanedPublisherName", "notes",
]);
export const NUMBER_FILTER_FIELDS = new Set<SpecialCaseInvestigationFilterField>([
  "revenueMultiplier", "historicalRevenueMultiplier", "adjustedRevenueMultiplier",
]);
export const STATUS_FILTER_FIELDS = new Set<SpecialCaseInvestigationFilterField>([
  "isNewSpecialCase", "isHistoricalFinal", "needReadjustment", "incomplete", "isChecked", "adjustmentMode",
]);

const TEXT_OPERATORS = new Set<SpecialCaseInvestigationFilterOperator>([
  "contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with", "is_blank", "is_not_blank",
]);
const NUMBER_OPERATORS = new Set<SpecialCaseInvestigationFilterOperator>([
  "equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "is_blank", "is_not_blank",
]);
const STATUS_OPERATORS = new Set<SpecialCaseInvestigationFilterOperator>(["is", "is_not"]);

export function investigationIncomplete(row: SpecialCaseInvestigationRow) {
  return row.needReadjustment && (!row.adjustmentMode || (row.adjustmentMode === "set" && !row.adjustedCleanedPublisherName));
}

function text(value: unknown) { return String(value ?? "").replace(/\r/g, "").trim(); }
function canonical(value: unknown) { return text(value).toLocaleLowerCase(); }
function isBlank(value: unknown) { return !text(value); }
function number(value: unknown) { const parsed = Number(text(value)); return Number.isFinite(parsed) ? parsed : null; }

function valueFor(row: SpecialCaseInvestigationRow, field: SpecialCaseInvestigationFilterField) {
  if (field === "all") return [row.appId, row.name, row.url, row.publisherId, row.publisherName, row.cleanedPublisherName, row.revenueMultiplier, row.historicalCleanedPublisherName, row.historicalRevenueMultiplier, row.adjustedCleanedPublisherName, row.adjustedRevenueMultiplier, row.notes].join(" ");
  if (field === "incomplete") return investigationIncomplete(row);
  return row[field];
}

function validOperator(field: SpecialCaseInvestigationFilterField, operator: SpecialCaseInvestigationFilterOperator) {
  return TEXT_FILTER_FIELDS.has(field) ? TEXT_OPERATORS.has(operator) : NUMBER_FILTER_FIELDS.has(field) ? NUMBER_OPERATORS.has(operator) : STATUS_FILTER_FIELDS.has(field) && STATUS_OPERATORS.has(operator);
}

export function validateInvestigationFilters(value: unknown): SpecialCaseInvestigationFilterRule[] {
  if (!Array.isArray(value)) throw new Error("Filters must be an array.");
  if (value.length > 10) throw new Error("At most 10 investigation filters may be applied.");
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") throw new Error(`Filter ${index + 1} is invalid.`);
    const item = candidate as Record<string, unknown>;
    const field = text(item.field) as SpecialCaseInvestigationFilterField;
    const operator = text(item.operator) as SpecialCaseInvestigationFilterOperator;
    const filterValue = text(item.value);
    if (!INVESTIGATION_FILTER_FIELDS.includes(field)) throw new Error(`Filter ${index + 1} uses an unsupported field.`);
    if (!INVESTIGATION_FILTER_OPERATORS.includes(operator) || !validOperator(field, operator)) throw new Error(`Filter ${index + 1} uses an unsupported operator.`);
    if (!filterValue && !["is_blank", "is_not_blank"].includes(operator)) throw new Error(`Filter ${index + 1} needs a value.`);
    if (filterValue.length > 200) throw new Error(`Filter ${index + 1} is too long.`);
    if (NUMBER_FILTER_FIELDS.has(field) && !["is_blank", "is_not_blank"].includes(operator) && number(filterValue) === null) throw new Error(`Filter ${index + 1} needs a valid number.`);
    if (STATUS_FILTER_FIELDS.has(field) && !["true", "false", "clear", "set", "none"].includes(canonical(filterValue))) throw new Error(`Filter ${index + 1} has an invalid status value.`);
    return { id: text(item.id) || `filter-${index + 1}`, field, operator, value: filterValue };
  });
}

function matchesText(actual: unknown, operator: SpecialCaseInvestigationFilterOperator, expected: string) {
  if (operator === "is_blank") return isBlank(actual);
  if (operator === "is_not_blank") return !isBlank(actual);
  const left = canonical(actual); const right = canonical(expected);
  if (operator === "contains") return left.includes(right);
  if (operator === "not_contains") return !left.includes(right);
  if (operator === "equals") return left === right;
  if (operator === "not_equals") return left !== right;
  if (operator === "starts_with") return left.startsWith(right);
  return left.endsWith(right);
}

function matchesNumber(actual: unknown, operator: SpecialCaseInvestigationFilterOperator, expected: string) {
  if (operator === "is_blank") return isBlank(actual);
  if (operator === "is_not_blank") return !isBlank(actual);
  const left = number(actual); const right = number(expected);
  if (left === null || right === null) return false;
  if (operator === "equals") return left === right;
  if (operator === "not_equals") return left !== right;
  if (operator === "greater_than") return left > right;
  if (operator === "greater_than_or_equal") return left >= right;
  if (operator === "less_than") return left < right;
  return left <= right;
}

function matchesStatus(actual: unknown, operator: SpecialCaseInvestigationFilterOperator, expected: string) {
  const normalizedExpected = canonical(expected) === "none" ? "" : canonical(expected);
  const matches = canonical(actual) === normalizedExpected;
  return operator === "is" ? matches : !matches;
}

export function investigationRowMatchesFilters(row: SpecialCaseInvestigationRow, filters: SpecialCaseInvestigationFilterRule[]) {
  return filters.every((rule) => {
    const actual = valueFor(row, rule.field);
    if (TEXT_FILTER_FIELDS.has(rule.field)) return matchesText(actual, rule.operator, rule.value ?? "");
    if (NUMBER_FILTER_FIELDS.has(rule.field)) return matchesNumber(actual, rule.operator, rule.value ?? "");
    return matchesStatus(actual, rule.operator, rule.value ?? "");
  });
}

export function filterInvestigationRows(rows: SpecialCaseInvestigationRow[], filters: SpecialCaseInvestigationFilterRule[]) {
  return rows.filter((row) => investigationRowMatchesFilters(row, filters));
}

function compareText(left: unknown, right: unknown) { return text(left).localeCompare(text(right), undefined, { numeric: true, sensitivity: "base" }); }
function compareValue(left: unknown, right: unknown) {
  const leftNumber = number(left); const rightNumber = number(right);
  return leftNumber !== null && rightNumber !== null ? leftNumber - rightNumber : compareText(left, right);
}

export function sortInvestigationRows(rows: SpecialCaseInvestigationRow[], field: SpecialCaseInvestigationSortField = "publisherName", direction: SpecialCaseInvestigationSortDirection = "asc") {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const comparison = compareValue(valueFor(left, field), valueFor(right, field));
    return comparison ? comparison * factor : compareText(left.appId, right.appId);
  });
}
