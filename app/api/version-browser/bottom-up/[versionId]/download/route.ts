import { exportBottomUpVersionCsv } from "@/lib/bottom-up/server";
import { getCsvIntegrity, isValidVersionId, VersionNotFoundError } from "@/lib/version-api";
import { asMappingArtifactError } from "@/lib/mapping-artifacts/errors";
import { requireVersionBrowserRead } from "@/lib/version-browser";

export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  try {
    await requireVersionBrowserRead(request);
    const { versionId } = await context.params;
    if (!isValidVersionId(versionId)) return Response.json({ error: { code: "invalid_request", message: "Malformed version ID." } }, { status: 400 });
    const exported = await exportBottomUpVersionCsv(versionId);
    return new Response(exported.csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exported.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-SHA256": getCsvIntegrity(exported.csv).checksumSha256,
    } });
  } catch (error) {
    if (error instanceof VersionNotFoundError) return Response.json({ error: { code: "not_found", message: error.message } }, { status: 404 });
    const resolved = asMappingArtifactError(error);
    return Response.json({ error: { code: resolved.code, message: resolved.message } }, { status: resolved.status });
  }
}
