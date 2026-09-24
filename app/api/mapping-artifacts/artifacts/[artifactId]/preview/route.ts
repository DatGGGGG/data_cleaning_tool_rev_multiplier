import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { previewRemoteArtifact } from "@/lib/mapping-artifacts/server";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";

export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    await requireMappingArtifactCapability(request, "read");
    const { artifactId } = await context.params;
    const url = new URL(request.url);
    return NextResponse.json(await previewRemoteArtifact(artifactId, {
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 50),
      search: url.searchParams.get("search") || "",
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
