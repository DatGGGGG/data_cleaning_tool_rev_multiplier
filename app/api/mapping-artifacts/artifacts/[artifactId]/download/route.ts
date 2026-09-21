import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { mappingArtifactErrorResponse } from "@/lib/mapping-artifacts/route";
import { downloadRemoteArtifact } from "@/lib/mapping-artifacts/client";

function safeFileName(value: string | null) {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return (match?.[1] || "mapping-artifact.csv").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    await requireMappingArtifactCapability(request, "read");
    const { artifactId } = await context.params;
    const { body, headers } = await downloadRemoteArtifact(artifactId);
    return new Response(body, {
      headers: {
        "Content-Type": headers.get("content-type") || "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFileName(headers.get("content-disposition"))}"`,
        "Cache-Control": "no-store",
        "X-Artifact-Id": headers.get("x-artifact-id") || artifactId,
        "X-Checksum-SHA256": headers.get("x-checksum-sha256") || "",
      },
    });
  } catch (error) {
    return mappingArtifactErrorResponse(error);
  }
}
