import { NextResponse } from "next/server";
import { createTopDownVersion, listTopDownVersions } from "@/lib/top-down/server";
import { handleVersionListRequest } from "@/lib/version-api";

export async function GET(request: Request) {
  return handleVersionListRequest(request, listTopDownVersions);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { operatorName?: string };
    const state = await createTopDownVersion(body.operatorName?.trim() || "Local operator");
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create version." },
      { status: 500 },
    );
  }
}
