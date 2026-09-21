import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse, readJsonObject } from "@/lib/mapping-artifacts/route";
import { publishSavedBottomUpVersion } from "@/lib/mapping-artifacts/server";

export async function POST(request: Request) {
  try {
    const principal = await requireMappingArtifactCapability(request, "publish");
    const body = await readJsonObject(request);
    return NextResponse.json(await publishSavedBottomUpVersion(String(body.versionId || ""), principal));
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
