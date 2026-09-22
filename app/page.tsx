import { WorkbenchOverview } from "@/components/workbench-overview";
import type { TopDownOverviewState } from "@/lib/top-down/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialState: TopDownOverviewState = {
    datasetId: "top_down_dataset",
    operatorName: "Local operator",
    publishers: [],
    publisherCount: 0,
    flattenedRowCount: 0,
    needsReviewCount: 0,
    versions: [],
    versionFreshness: {
      hasUnversionedChanges: false,
      currentChecksumSha256: "",
      currentFlattenedAppCount: 0,
      latestVersionId: null,
      latestVersionLabel: null,
      latestVersionCreatedAt: null,
      latestVersionChecksumSha256: null,
      latestVersionFlattenedAppCount: null,
    },
    logs: [],
  };

  return <WorkbenchOverview initialState={initialState} />;
}
