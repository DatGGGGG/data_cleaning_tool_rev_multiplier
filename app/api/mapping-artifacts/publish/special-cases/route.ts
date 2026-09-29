import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";
import { publishSavedSpecialCasesVersion } from "@/lib/mapping-artifacts/server";

export async function POST(request: Request) {
  try {
    const principal = await requireMappingArtifactCapability(request, "publish");
    const body = (await request.json()) as { versionId?: string };
    const versionId = body.versionId?.trim();
    if (!versionId) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "A Special Cases saved version is required." } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await publishSavedSpecialCasesVersion(versionId, principal),
    );
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
