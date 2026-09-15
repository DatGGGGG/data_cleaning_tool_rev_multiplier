import { NextResponse } from "next/server";
import { createTopDownVersion, listTopDownVersions } from "@/lib/top-down/server";

export async function GET() {
  try {
    return NextResponse.json({ versions: await listTopDownVersions() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load versions." },
      { status: 500 },
    );
  }
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
