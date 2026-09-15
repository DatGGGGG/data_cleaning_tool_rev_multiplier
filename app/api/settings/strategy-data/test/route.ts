import { NextResponse } from "next/server";
import { testStrategyDataApiConnection } from "@/lib/app-settings/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      strategyDataApiBaseUrl?: unknown;
      strategyDataApiKey?: unknown;
    };
    const result = await testStrategyDataApiConnection(body);
    return NextResponse.json({
      ...result,
      message: `Connected to App Full Info through ${result.baseUrl}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to test the Strategy Data API connection." },
      { status: 502 },
    );
  }
}
