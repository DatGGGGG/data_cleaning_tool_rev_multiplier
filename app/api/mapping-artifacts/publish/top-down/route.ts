import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse, readJsonObject } from "@/lib/mapping-artifacts/route";
import { publishSavedTopDownVersion } from "@/lib/mapping-artifacts/server";

export async function POST(request: Request) {
  try {
    const principal = await requireMappingArtifactCapability(request, "publish");
    const body = await readJsonObject(request);
    return NextResponse.json(await publishSavedTopDownVersion(String(body.versionId || ""), principal));
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
