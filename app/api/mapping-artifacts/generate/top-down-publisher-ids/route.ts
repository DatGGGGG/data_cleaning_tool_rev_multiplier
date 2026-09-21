import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse, readJsonObject } from "@/lib/mapping-artifacts/route";
import { startTopDownEnrichment } from "@/lib/mapping-artifacts/server";

export async function POST(request: Request) {
  try {
    const principal = await requireMappingArtifactCapability(request, "publish");
    const body = await readJsonObject(request);
    const result = await startTopDownEnrichment(String(body.sourceArtifactId || ""), String(body.localTopDownVersionId || ""), principal);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
