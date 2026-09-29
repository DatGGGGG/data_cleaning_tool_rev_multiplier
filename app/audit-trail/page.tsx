import { ActivityLogViewer } from "@/components/activity-log-viewer";
import { readMappingArtifactStore } from "@/lib/mapping-artifacts/store";
import { getTopDownWorkbenchState } from "@/lib/top-down/server";

export const dynamic = "force-dynamic";

export default async function AuditTrailPage() {
  const [initialState, mappingArtifacts] = await Promise.all([
    getTopDownWorkbenchState("Local operator", { logLimit: 100 }),
    readMappingArtifactStore(),
  ]);
  const logs = [...initialState.logs, ...mappingArtifacts.activity]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 250);

  return <ActivityLogViewer logs={logs} />;
}
