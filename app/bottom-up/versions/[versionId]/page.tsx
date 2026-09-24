import { notFound } from "next/navigation";
import { LocalVersionDetail } from "@/components/local-version-detail";
import { getBottomUpVersionPreview } from "@/lib/bottom-up/server";
import { VersionNotFoundError } from "@/lib/version-api";

export const dynamic = "force-dynamic";

export default async function BottomUpVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = await params;
    return <LocalVersionDetail preview={await getBottomUpVersionPreview(versionId)} />;
  } catch (error) {
    if (error instanceof VersionNotFoundError) notFound();
    throw error;
  }
}
