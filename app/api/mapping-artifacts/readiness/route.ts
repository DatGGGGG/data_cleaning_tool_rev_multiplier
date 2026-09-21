import { NextResponse } from "next/server";
import { getMappingArtifactReadiness } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getMappingArtifactReadiness(request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
