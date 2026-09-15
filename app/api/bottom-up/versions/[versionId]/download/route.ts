import { exportBottomUpVersionCsv } from "@/lib/bottom-up/server";
import { handleVersionDownloadRequest } from "@/lib/version-api";

export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await context.params;
  return handleVersionDownloadRequest(request, versionId, exportBottomUpVersionCsv);
}
