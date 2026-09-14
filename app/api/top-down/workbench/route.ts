import { NextResponse } from "next/server";
import { getTopDownWorkbenchState, saveTopDownPublishers } from "@/lib/top-down/server";
import type { PublisherSheet } from "@/lib/top-down/types";

function getOperatorName(searchParams: URLSearchParams) {
  return searchParams.get("operatorName")?.trim() || "Local operator";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const state = await getTopDownWorkbenchState(getOperatorName(url.searchParams));
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load workbench." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      operatorName?: string;
      publishers?: PublisherSheet[];
    };

    const state = await saveTopDownPublishers(
      body.publishers ?? [],
      body.operatorName?.trim() || "Local operator",
    );
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save workbench." },
      { status: 500 },
    );
  }
}
