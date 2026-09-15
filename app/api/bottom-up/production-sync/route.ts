import { NextResponse } from "next/server";
import { getBottomUpProductionSyncState, startBottomUpProductionSync } from "@/lib/bottom-up/server";

export async function GET() {
  try {
    return NextResponse.json({ syncStatus: await getBottomUpProductionSyncState() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read production load status." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { operatorName?: string };
    const operatorName = body.operatorName?.trim() || "Local operator";
    const result = await startBottomUpProductionSync(operatorName);

    return NextResponse.json(
      {
        ...result,
        message: result.started
          ? "Production App Full Info load started. You can safely leave this page and return later."
          : "A production App Full Info load is already running.",
      },
      { status: result.started ? 202 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync Bottom Up rows from production." },
      { status: 500 },
    );
  }
}
