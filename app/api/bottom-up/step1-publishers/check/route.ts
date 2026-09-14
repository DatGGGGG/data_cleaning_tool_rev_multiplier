import { NextResponse } from "next/server";
import { updateBottomUpStep1Checked } from "@/lib/bottom-up/server";
import type { BottomUpStep1FilterRule, BottomUpStep1SortField } from "@/lib/bottom-up/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      operatorName?: string;
      checked?: boolean;
      mode?: "selected" | "filtered";
      publisherNames?: string[];
      filters?: BottomUpStep1FilterRule[];
      sortField?: BottomUpStep1SortField | "";
      sortDirection?: "asc" | "desc";
    };
    const result = await updateBottomUpStep1Checked({
      operatorName: body.operatorName?.trim() || "Local operator",
      checked: Boolean(body.checked),
      mode: body.mode === "filtered" ? "filtered" : "selected",
      publisherNames: body.publisherNames,
      filters: body.filters,
      sortField: body.sortField,
      sortDirection: body.sortDirection,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update Step 1 checked publishers." },
      { status: 500 },
    );
  }
}
