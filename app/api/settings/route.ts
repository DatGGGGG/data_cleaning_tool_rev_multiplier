import { NextResponse } from "next/server";
import { getPublicAppSettings, updateAppSettings } from "@/lib/app-settings/server";

export async function GET() {
  try {
    const settings = await getPublicAppSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load settings." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const operatorName = String(body.operatorName ?? "").trim() || "Local operator";
    const settings = await updateAppSettings(
      {
        bottomUpProductionSource: body.bottomUpProductionSource as never,
        strategyDataApiBaseUrl: String(body.strategyDataApiBaseUrl ?? ""),
        strategyDataApiKey: String(body.strategyDataApiKey ?? ""),
        strategyDataApiPageSize: Number(body.strategyDataApiPageSize ?? 500),
        bottomUpSeedCsv: String(body.bottomUpSeedCsv ?? ""),
        appFullInfoCurrentNdjson: String(body.appFullInfoCurrentNdjson ?? ""),
        clearStrategyDataApiKey: Boolean(body.clearStrategyDataApiKey),
      },
      operatorName,
    );

    return NextResponse.json({ settings, message: "Saved application settings." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save settings." },
      { status: 500 },
    );
  }
}
