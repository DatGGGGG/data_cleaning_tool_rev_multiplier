import { NextResponse } from "next/server";
import { appendTopDownActivityLog } from "@/lib/top-down/server";
import { resolveSensorTowerOverviewLink } from "@/lib/top-down/sensortower";

type ResolveRequestBody = {
  link?: string;
  operatorName?: string;
  publisherKey?: string;
  rowId?: string;
};

function buildTarget(body: ResolveRequestBody) {
  if (body.rowId) {
    return {
      targetType: "publisher_row",
      targetId: body.rowId,
    };
  }

  if (body.publisherKey) {
    return {
      targetType: "publisher_sheet",
      targetId: body.publisherKey,
    };
  }

  return {
    targetType: "dataset",
    targetId: "top_down_dataset",
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as ResolveRequestBody;
  const operatorName = body.operatorName?.trim() || "Local operator";
  const { targetType, targetId } = buildTarget(body);

  try {
    const resolution = await resolveSensorTowerOverviewLink(body.link?.trim() || "");

    if (resolution.status === "failed" || resolution.status === "empty") {
      await appendTopDownActivityLog(
        "resolve_sensortower_failure",
        operatorName,
        targetType,
        targetId,
        resolution.errorMessage || "SensorTower resolution failed.",
      );
    } else {
      await appendTopDownActivityLog(
        "resolve_sensortower_link",
        operatorName,
        targetType,
        targetId,
        `Resolved SensorTower link to unified app ${resolution.unifiedAppId}`,
      );
    }

    return NextResponse.json(resolution);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve the SensorTower link.";
    await appendTopDownActivityLog(
      "resolve_sensortower_failure",
      operatorName,
      targetType,
      targetId,
      message,
    );
    return NextResponse.json(
      {
        status: "failed",
        unifiedAppId: "",
        resolvedGameName: "",
        iosOptions: [],
        androidOptions: [],
        errorMessage: message,
      },
      { status: 200 },
    );
  }
}
