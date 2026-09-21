import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { getRemoteArtifactCatalog } from "@/lib/mapping-artifacts/server";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";

export async function GET(request: Request) {
  try {
    await requireMappingArtifactCapability(request, "read");
    const url = new URL(request.url);
    return NextResponse.json(await getRemoteArtifactCatalog({
      type: url.searchParams.get("type") as never || undefined,
      status: url.searchParams.get("status") || undefined,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
