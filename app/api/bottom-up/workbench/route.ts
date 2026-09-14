import { NextResponse } from "next/server";
import { getBottomUpWorkbenchState, saveBottomUpRows } from "@/lib/bottom-up/server";
import type { BottomUpRowDraft } from "@/lib/bottom-up/types";

function getOperatorName(searchParams: URLSearchParams) {
  return searchParams.get("operatorName")?.trim() || "Local operator";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const state = await getBottomUpWorkbenchState(getOperatorName(url.searchParams));
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load bottom-up workbench." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      operatorName?: string;
      rows?: BottomUpRowDraft[];
      checkedPublisherNames?: string[];
    };
    const state = await saveBottomUpRows(
      body.rows ?? [],
      body.operatorName?.trim() || "Local operator",
      body.checkedPublisherNames,
    );
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save bottom-up workbench." },
      { status: 500 },
    );
  }
}
