export type BottomUpReviewStatus = "needs_review" | "confirmed" | "seeded";

export type BottomUpRowDraft = {
  id: string;
  ordinal: number;
  cleanedPublisherName: string;
  publisherId: string;
  publisherName: string;
  revenueMultiplier: string;
  reviewStatus: BottomUpReviewStatus;
  notes: string;
  adder: string;
  addingDate: string;
};

export type BottomUpAppCandidate = {
  id: string;
  appId: string;
  name: string;
  publisherName: string;
  publisherId: string;
  humanizedName: string;
  validCountries: string;
  topCountries: string;
  publisherCountry: string;
  hasVnValidCountry: boolean;
  hasVnTopCountry: boolean;
  isVietnamPublisherCountry: boolean;
  relatedToVn: boolean;
};

export type BottomUpPublisherCandidate = {
  publisherName: string;
  publisherIds: string[];
  appCount: number;
  apps: Array<{
    appId: string;
    name: string;
  }>;
};

export type BottomUpStep1FilterField =
  | "all"
  | "publisherName"
  | "cleanedPublisherName"
  | "isInVnPublisherList"
  | "isInLatestMapping"
  | "isChecked"
  | "publisherIds"
  | "appCount";

export type BottomUpStep1SortField = Exclude<BottomUpStep1FilterField, "all">;

export type BottomUpStep1FilterRule = {
  id?: string;
  field: BottomUpStep1FilterField;
  value: string;
};

export type BottomUpStep1PublisherRow = {
  publisherName: string;
  cleanedPublisherName: string;
  publisherIds: string[];
  appCount: number;
  isInVnPublisherList: boolean;
  isInLatestMapping: boolean;
  isChecked: boolean;
  apps: Array<{
    appId: string;
    name: string;
  }>;
};

export type BottomUpVersionSnapshot = {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  rowCount: number;
};

export type BottomUpVersionMetadata = BottomUpVersionSnapshot & {
  workflow: "bottom_up";
  schemaVersion: 1;
  csvByteSize: number;
  checksumSha256: string;
  mappedRowCount: number;
  needsReviewCount: number;
};

export type BottomUpActivityLogEntry = {
  id: string;
  action: string;
  actor: string;
  targetType: string;
  targetId: string;
  detail: string;
  createdAt: string;
};

export type BottomUpWorkbenchState = {
  datasetId: string;
  operatorName: string;
  rows: BottomUpRowDraft[];
  checkedPublisherNames: string[];
  checkedPublisherCount: number;
  appCandidates: BottomUpAppCandidate[];
  appCandidateCount: number;
  publisherCandidates: BottomUpPublisherCandidate[];
  publisherCandidateCount: number;
  versions: BottomUpVersionSnapshot[];
  logs: BottomUpActivityLogEntry[];
};
