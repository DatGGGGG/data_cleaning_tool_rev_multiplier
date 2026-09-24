import { NextResponse } from "next/server";
import { listBottomUpStep1Versions } from "@/lib/bottom-up/server";

export async function GET() {
  try {
    return NextResponse.json(
      { versions: await listBottomUpStep1Versions() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Step 1 versions." },
      { status: 500 },
    );
  }
}
