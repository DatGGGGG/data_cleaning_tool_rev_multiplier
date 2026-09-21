import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { getRemoteActiveArtifactState } from "@/lib/mapping-artifacts/server";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";

export async function GET(request: Request) {
  try {
    await requireMappingArtifactCapability(request, "read");
    return NextResponse.json(await getRemoteActiveArtifactState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
