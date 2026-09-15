import { NextResponse } from "next/server";
import { createBottomUpVersion, listBottomUpVersions } from "@/lib/bottom-up/server";

export async function GET() {
  try {
    return NextResponse.json({ versions: await listBottomUpVersions() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load bottom-up versions." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { operatorName?: string };
    const state = await createBottomUpVersion(body.operatorName?.trim() || "Local operator");
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create bottom-up version." },
      { status: 500 },
    );
  }
}
