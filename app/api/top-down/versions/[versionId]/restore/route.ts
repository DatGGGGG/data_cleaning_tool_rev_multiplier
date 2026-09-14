import { NextResponse } from "next/server";
import { restoreTopDownVersion } from "@/lib/top-down/server";

type RouteContext = {
  params: Promise<{
    versionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const body = (await request.json()) as { operatorName?: string };
    const { versionId } = await context.params;
    const state = await restoreTopDownVersion(versionId, body.operatorName?.trim() || "Local operator");
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to restore version." },
      { status: 500 },
    );
  }
}
