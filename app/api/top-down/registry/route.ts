import { NextResponse } from "next/server";
import { getTopDownPublisherRegistry } from "@/lib/top-down/server";

export async function GET() {
  const registry = await getTopDownPublisherRegistry();
  return NextResponse.json({ registry });
}
