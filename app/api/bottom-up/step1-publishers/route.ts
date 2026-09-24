import { NextResponse } from "next/server";
import { getBottomUpStep1PublisherPage } from "@/lib/bottom-up/server";
import type { BottomUpStep1FilterRule, BottomUpStep1SortField } from "@/lib/bottom-up/types";

function parseFilters(value: string | null): BottomUpStep1FilterRule[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((filter) => {
        if (!filter || typeof filter !== "object") {
          return null;
        }
        const candidate = filter as Partial<BottomUpStep1FilterRule>;
        return {
          field: candidate.field ?? "all",
          value: String(candidate.value ?? ""),
        } satisfies BottomUpStep1FilterRule;
      })
      .filter((filter): filter is BottomUpStep1FilterRule => Boolean(filter && filter.value.trim()));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 50);
    const sortField = (url.searchParams.get("sortField") ?? "") as BottomUpStep1SortField | "";
    const sortDirection = url.searchParams.get("sortDirection") === "desc" ? "desc" : "asc";
    const filters = parseFilters(url.searchParams.get("filters"));
    const payload = await getBottomUpStep1PublisherPage({
      page,
      pageSize,
      filters,
      sortField,
      sortDirection,
      newOnly: url.searchParams.get("newOnly") === "true",
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Step 1 publisher names." },
      { status: 500 },
    );
  }
}
