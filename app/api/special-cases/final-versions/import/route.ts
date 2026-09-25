import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { HistoricalFinalImportError } from "@/lib/special-cases/final-import";
import { getSpecialCasesOverview, importSpecialCaseHistoricalFinal } from "@/lib/special-cases/server";

export async function POST(request: Request) {
  try {
    const principal = await requireMappingArtifactCapability(request, "commit");
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new HistoricalFinalImportError("Choose a CSV file to upload.");
    const imported = await importSpecialCaseHistoricalFinal({
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }, principal.displayName);
    return NextResponse.json({
      version: imported.version,
      overview: await getSpecialCasesOverview(true),
      importSummary: {
        filename: file.name,
        inputRowCount: imported.inputRowCount,
        alreadyExisted: imported.alreadyExisted,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof HistoricalFinalImportError ? error.status : (error as { status?: number })?.status ?? 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Could not import the historical final CSV." } }, { status });
  }
}
