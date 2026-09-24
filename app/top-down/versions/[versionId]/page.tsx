import { notFound } from "next/navigation";
import { LocalVersionDetail } from "@/components/local-version-detail";
import { getTopDownVersionPreview } from "@/lib/top-down/server";
import { VersionNotFoundError } from "@/lib/version-api";

export const dynamic = "force-dynamic";

export default async function TopDownVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = await params;
    return <LocalVersionDetail preview={await getTopDownVersionPreview(versionId)} />;
  } catch (error) {
    if (error instanceof VersionNotFoundError) notFound();
    throw error;
  }
}
