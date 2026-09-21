import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";
import { commitMappingArtifact } from "@/lib/mapping-artifacts/server";

export async function POST(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const principal = await requireMappingArtifactCapability(request, "commit");
    const { artifactId } = await context.params;
    return NextResponse.json(await commitMappingArtifact(artifactId, principal));
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
