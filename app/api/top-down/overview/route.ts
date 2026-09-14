import { NextResponse } from "next/server";
import {
  addTopDownPublisher,
  getTopDownOverviewState,
  updateTopDownPublisherRevenueMultiplier,
} from "@/lib/top-down/server";

function getOperatorName(searchParams: URLSearchParams) {
  return searchParams.get("operatorName")?.trim() || "Local operator";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const state = await getTopDownOverviewState(getOperatorName(url.searchParams));
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load overview." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "add_publisher" | "update_revenue_multiplier";
      operatorName?: string;
      publisherName?: string;
      publisherId?: string;
      revenueMultiplier?: string;
    };
    const operatorName = body.operatorName?.trim() || "Local operator";
    const state =
      body.action === "update_revenue_multiplier"
        ? await updateTopDownPublisherRevenueMultiplier(
            body.publisherId ?? "",
            body.revenueMultiplier ?? "1",
            operatorName,
          )
        : await addTopDownPublisher(body.publisherName ?? "", operatorName);

    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update overview." },
      { status: 500 },
    );
  }
}
