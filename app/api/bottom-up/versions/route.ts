import { NextResponse } from "next/server";
import { createBottomUpVersion } from "@/lib/bottom-up/server";

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
