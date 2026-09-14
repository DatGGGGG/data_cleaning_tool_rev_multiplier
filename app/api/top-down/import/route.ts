import { NextResponse } from "next/server";
import { importPublisherCsvFile } from "@/lib/top-down/server";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const publisherKey = formData.get("publisherKey")?.toString() ?? "";
    const operatorName = formData.get("operatorName")?.toString().trim() || "Local operator";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing CSV file." }, { status: 400 });
    }

    if (!publisherKey) {
      return NextResponse.json({ error: "Missing publisher key." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const state = await importPublisherCsvFile(
      publisherKey,
      file.name,
      file.type || "text/csv",
      bytes,
      operatorName,
    );

    return NextResponse.json({
      state,
      message: `Imported ${file.name} into ${publisherKey}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import CSV." },
      { status: 500 },
    );
  }
}
