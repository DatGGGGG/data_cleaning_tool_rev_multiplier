import { FullMappingWorkbench } from "@/components/full-mapping-workbench";
import { getMappingArtifactDashboard } from "@/lib/mapping-artifacts/server";

export const dynamic = "force-dynamic";

export default async function FullMappingPage() {
  const { topDownVersions, bottomUpVersions } = await getMappingArtifactDashboard();
  return <FullMappingWorkbench topDownVersions={topDownVersions} bottomUpVersions={bottomUpVersions} />;
}
