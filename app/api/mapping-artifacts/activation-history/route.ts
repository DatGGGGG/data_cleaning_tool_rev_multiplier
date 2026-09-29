import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { getRemoteActivationHistory } from "@/lib/mapping-artifacts/client";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";

export async function GET(request: Request) {
  try {
    await requireMappingArtifactCapability(request, "read");
    const type = new URL(request.url).searchParams.get("type");
    if (type !== "full" && type !== "special_cases") {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Activation history requires a full or special_cases type." } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await getRemoteActivationHistory(type),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
