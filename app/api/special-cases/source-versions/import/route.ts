import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { HistoricalBaselineImportError } from "@/lib/special-cases/source-import";
import { getSpecialCasesOverview, importSpecialCaseHistoricalBaseline } from "@/lib/special-cases/server";

export async function POST(request: Request) {
  try {
    const principal = await requireMappingArtifactCapability(request, "commit");
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new HistoricalBaselineImportError("Choose a CSV file to upload.");
    const imported = await importSpecialCaseHistoricalBaseline({
      filename: file.name,
      mimeType: file.type || "text/csv",
      bytes: new Uint8Array(await file.arrayBuffer()),
    }, principal.displayName);
    return NextResponse.json({
      sourceVersion: imported.sourceVersion,
      overview: await getSpecialCasesOverview(true),
      importSummary: {
        filename: file.name,
        inputRowCount: imported.inputRowCount,
        uniqueAppCount: imported.uniqueAppCount,
        duplicateAppIdCount: imported.duplicateAppIdCount,
        alreadyExisted: imported.alreadyExisted,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof HistoricalBaselineImportError ? error.status : (error as { status?: number })?.status ?? 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Could not import the historical baseline CSV." } }, { status });
  }
}
