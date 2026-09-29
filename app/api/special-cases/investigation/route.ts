import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { INVESTIGATION_SORT_FIELDS, validateInvestigationFilters } from "@/lib/special-cases/investigation-filters";
import { getInvestigationPage } from "@/lib/special-cases/server";
import type { SpecialCaseInvestigationSortDirection, SpecialCaseInvestigationSortField } from "@/lib/special-cases/types";

export async function GET(request: Request) {
  try {
    await requireMappingArtifactCapability(request, "read");
    const query = new URL(request.url).searchParams;
    const rawFilters = query.get("filters");
    let filters: unknown = [];
    if (rawFilters) {
      try { filters = JSON.parse(rawFilters); }
      catch { throw Object.assign(new Error("Filters must be valid JSON."), { status: 400 }); }
    } else {
      // Retain old deep links while all clients upgrade to the filter builder.
      const legacy: unknown[] = [];
      const search = query.get("search") ?? "";
      if (search) legacy.push({ id: "legacy-search", field: "all", operator: "contains", value: search });
      if (query.get("newOnly") === "true") legacy.push({ id: "legacy-new", field: "isNewSpecialCase", operator: "is", value: "true" });
      if (query.get("adjustmentsOnly") === "true") legacy.push({ id: "legacy-adjustments", field: "needReadjustment", operator: "is", value: "true" });
      if (query.get("incompleteOnly") === "true") legacy.push({ id: "legacy-incomplete", field: "incomplete", operator: "is", value: "true" });
      filters = legacy;
    }
    const requestedSortField = query.get("sortField") as SpecialCaseInvestigationSortField | null;
    const sortField = requestedSortField && INVESTIGATION_SORT_FIELDS.includes(requestedSortField)
      ? requestedSortField : "publisherName";
    const requestedSortDirection = query.get("sortDirection");
    const sortDirection: SpecialCaseInvestigationSortDirection = requestedSortDirection === "desc" ? "desc" : "asc";
    return NextResponse.json(await getInvestigationPage({
      page: Number(query.get("page")) || 1,
      pageSize: Number(query.get("pageSize")) || 25,
      filters: validateInvestigationFilters(filters),
      sortField,
      sortDirection,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Could not load investigation rows." } }, { status: (error as { status?: number })?.status ?? 500 });
  }
}
