import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";
import { getRemoteArtifactDetail } from "@/lib/mapping-artifacts/server";

export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    await requireMappingArtifactCapability(request, "read");
    const { artifactId } = await context.params;
    return NextResponse.json(await getRemoteArtifactDetail(artifactId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
