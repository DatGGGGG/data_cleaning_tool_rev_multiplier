import { ArtifactDetailView } from "@/components/artifact-detail-view";

export const dynamic = "force-dynamic";

export default async function ArtifactDetailPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return <ArtifactDetailView artifactId={artifactId} />;
}
