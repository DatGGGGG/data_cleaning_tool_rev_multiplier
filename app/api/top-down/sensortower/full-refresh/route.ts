import { NextResponse } from "next/server";
import { runFullSensorTowerRefresh } from "@/lib/top-down/server";

type FullRefreshRequestBody = {
  operatorName?: string;
};

function isAuthorized(request: Request) {
  const expectedToken = process.env.SENSORTOWER_REFRESH_TOKEN?.trim();
  if (!expectedToken) {
    return true;
  }

  const providedToken = request.headers.get("x-refresh-token")?.trim();
  return providedToken === expectedToken;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized full refresh request." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FullRefreshRequestBody;
    const result = await runFullSensorTowerRefresh(body.operatorName?.trim() || "Local operator");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run SensorTower full refresh." },
      { status: 500 },
    );
  }
}
