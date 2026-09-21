import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";
import { activateFullMappingArtifact } from "@/lib/mapping-artifacts/server";

export async function POST(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const principal = await requireMappingArtifactCapability(request, "activate");
    const { artifactId } = await context.params;
    return NextResponse.json(await activateFullMappingArtifact(artifactId, principal));
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
