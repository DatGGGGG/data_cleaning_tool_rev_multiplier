import { exportBottomUpCsv } from "@/lib/bottom-up/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const operatorName = url.searchParams.get("operatorName")?.trim() || "Local operator";
    const { fileName, csv } = await exportBottomUpCsv(operatorName);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Failed to export CSV.", {
      status: 500,
    });
  }
}
