import { NextResponse } from "next/server";
import { lookupSensorTowerLocalApp } from "@/lib/top-down/sensortower";
import type { SensorTowerPlatform } from "@/lib/top-down/types";

type LookupRequestBody = {
  appId?: string;
  os?: SensorTowerPlatform;
};

function isPlatform(value: unknown): value is SensorTowerPlatform {
  return value === "ios" || value === "android";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LookupRequestBody;
    if (!isPlatform(body.os)) {
      return NextResponse.json(
        {
          found: false,
          os: "android",
          appId: "",
          errorMessage: "A valid platform is required.",
        },
        { status: 400 },
      );
    }

    const payload = await lookupSensorTowerLocalApp(body.os, body.appId?.trim() || "");
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        found: false,
        os: "android",
        appId: "",
        errorMessage: error instanceof Error ? error.message : "Failed to validate the manual app ID.",
      },
      { status: 500 },
    );
  }
}
