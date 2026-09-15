import { exportTopDownVersionCsv } from "@/lib/top-down/server";

export async function GET(_request: Request, context: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = await context.params;
    const { fileName, csv } = await exportTopDownVersionCsv(versionId);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to export version.";
    return new Response(message, { status: message === "Version not found." ? 404 : 500 });
  }
}
