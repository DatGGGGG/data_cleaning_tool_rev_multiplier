import type { SpecialCasePublisherGroup } from "@/lib/special-cases/types";

export type SpecialCasePublisherSortField =
  | "publisherName"
  | "cleanedPublisherName"
  | "revenueMultiplier"
  | "appCount"
  | "newAppCount"
  | "isSuspected"
  | "isChecked";

export type SpecialCasePublisherSortDirection = "asc" | "desc";
export type SpecialCasePublisherBooleanFilter = "all" | "yes" | "no";

export type SpecialCasePublisherGroupFilters = {
  search: string;
  cleanedPublisherName: string;
  revenueMultiplier: string;
  suspected: SpecialCasePublisherBooleanFilter;
  checked: SpecialCasePublisherBooleanFilter;
  newApps: "all" | "has_new" | "none";
};

function canonical(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim().toLocaleLowerCase();
}

function matchesBoolean(value: boolean, filter: SpecialCasePublisherBooleanFilter) {
  return filter === "all" || (filter === "yes" ? value : !value);
}

export function filterSpecialCasePublisherGroups(groups: SpecialCasePublisherGroup[], filters: SpecialCasePublisherGroupFilters) {
  const terms = canonical(filters.search).split(/\s+/).filter(Boolean);
  return groups.filter((group) => {
    const searchable = canonical([group.publisherName, group.cleanedPublisherName, group.revenueMultiplier, group.notes].join(" "));
    return terms.every((term) => searchable.includes(term)) &&
      (!filters.cleanedPublisherName || group.cleanedPublisherName === filters.cleanedPublisherName) &&
      (!filters.revenueMultiplier || group.revenueMultiplier === filters.revenueMultiplier) &&
      matchesBoolean(group.isSuspected, filters.suspected) &&
      matchesBoolean(group.isChecked, filters.checked) &&
      (filters.newApps === "all" || (filters.newApps === "has_new" ? group.newAppCount > 0 : group.newAppCount === 0));
  });
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareNumber(left: string | number, right: string | number) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber - rightNumber : compareText(String(left), String(right));
}

export function sortSpecialCasePublisherGroups(groups: SpecialCasePublisherGroup[], field: SpecialCasePublisherSortField, direction: SpecialCasePublisherSortDirection) {
  const directionFactor = direction === "asc" ? 1 : -1;
  return [...groups].sort((left, right) => {
    let comparison = 0;
    if (field === "appCount" || field === "newAppCount") comparison = left[field] - right[field];
    else if (field === "revenueMultiplier") comparison = compareNumber(left.revenueMultiplier, right.revenueMultiplier);
    else if (field === "isSuspected" || field === "isChecked") comparison = Number(left[field]) - Number(right[field]);
    else comparison = compareText(left[field], right[field]);
    return comparison !== 0 ? comparison * directionFactor : compareText(left.publisherName, right.publisherName);
  });
}
