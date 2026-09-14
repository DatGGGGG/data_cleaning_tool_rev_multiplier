import { ActivityLogViewer } from "@/components/activity-log-viewer";
import { getTopDownWorkbenchState } from "@/lib/top-down/server";

export const dynamic = "force-dynamic";

export default async function AuditTrailPage() {
  const initialState = await getTopDownWorkbenchState("Local operator", { logLimit: 100 });

  return <ActivityLogViewer logs={initialState.logs} />;
}
