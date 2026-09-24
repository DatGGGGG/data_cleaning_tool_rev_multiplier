import { AppsPublisherIdsWorkbench } from "@/components/apps-publisher-ids-workbench";
import { getMappingArtifactDashboard } from "@/lib/mapping-artifacts/server";

export const dynamic = "force-dynamic";

export default async function AppsPublisherIdsPage() {
  const { enrichmentResumeJob } = await getMappingArtifactDashboard();
  return <AppsPublisherIdsWorkbench enrichmentResumeJob={enrichmentResumeJob} />;
}
