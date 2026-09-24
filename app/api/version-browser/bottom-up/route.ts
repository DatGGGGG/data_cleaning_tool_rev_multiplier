import { NextResponse } from "next/server";
import { asMappingArtifactError } from "@/lib/mapping-artifacts/errors";
import { listSourceVersionBrowserItems, requireVersionBrowserRead } from "@/lib/version-browser";

export async function GET(request: Request) {
  try {
    await requireVersionBrowserRead(request);
    return NextResponse.json({ versions: await listSourceVersionBrowserItems("bottom_up") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const resolved = asMappingArtifactError(error);
    return NextResponse.json({ error: { code: resolved.code, message: resolved.message } }, { status: resolved.status });
  }
}
