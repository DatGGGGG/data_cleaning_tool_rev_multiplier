import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";
import { refreshTopDownEnrichmentJob } from "@/lib/mapping-artifacts/server";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    await requireMappingArtifactCapability(request, "read");
    const { jobId } = await context.params;
    return NextResponse.json(await refreshTopDownEnrichmentJob(jobId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
