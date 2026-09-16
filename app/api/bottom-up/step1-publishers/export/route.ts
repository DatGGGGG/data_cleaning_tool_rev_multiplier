import { exportBottomUpStep1PublisherCsv } from "@/lib/bottom-up/server";
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
    const operatorName = url.searchParams.get("operatorName")?.trim() || "Local operator";
    const sortField = (url.searchParams.get("sortField") ?? "") as BottomUpStep1SortField | "";
    const sortDirection = url.searchParams.get("sortDirection") === "desc" ? "desc" : "asc";
    const { fileName, csv, rowCount } = await exportBottomUpStep1PublisherCsv({
      operatorName,
      filters: parseFilters(url.searchParams.get("filters")),
      sortField,
      sortDirection,
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Export-Row-Count": String(rowCount),
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Failed to export filtered Step 1 publisher names.", {
      status: 500,
    });
  }
}
