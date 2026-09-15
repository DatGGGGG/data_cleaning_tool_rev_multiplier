import { BottomUpEditor } from "@/components/bottom-up-editor";
import type { BottomUpWorkbenchState } from "@/lib/bottom-up/types";

export default async function BottomUpPage() {
  const initialState: BottomUpWorkbenchState = {
    datasetId: "bottom_up_dataset",
    operatorName: "Local operator",
    rows: [],
    checkedPublisherNames: [],
    checkedPublisherCount: 0,
    appCandidates: [],
    appCandidateCount: 0,
    publisherCandidates: [],
    publisherCandidateCount: 0,
    versions: [],
    logs: [],
    productionSync: {
      status: "idle",
      stage: "Not started",
      message: "App Full Info has not been loaded from production yet.",
      startedAt: "",
      updatedAt: "",
      completedAt: "",
      pagesRead: 0,
      scannedRecords: 0,
      expectedRecordCount: 0,
      sourceType: "",
      nextOffset: 0,
    },
  };
  return (
    <BottomUpEditor
      initialState={initialState}
      registeredPublisherNames={[]}
      registeredPublisherRevenueMultipliers={{}}
    />
  );
}
