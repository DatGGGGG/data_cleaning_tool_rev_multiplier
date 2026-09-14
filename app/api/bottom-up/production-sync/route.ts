import { NextResponse } from "next/server";
import { syncBottomUpFromProduction } from "@/lib/bottom-up/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { operatorName?: string };
    const operatorName = body.operatorName?.trim() || "Local operator";
    const result = await syncBottomUpFromProduction(operatorName);

    return NextResponse.json({
      ...result,
      message: `Loaded ${result.summary.candidateRows} production publisher candidates from App Full Info.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync Bottom Up rows from production." },
      { status: 500 },
    );
  }
}
