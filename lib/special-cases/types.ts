export type SpecialCaseSourceRow = {
  appId: string;
  name: string;
  url: string;
  publisherId: string;
  publisherName: string;
  cleanedPublisherName: string;
  revenueMultiplier: string;
};

export type SpecialCaseSourceVersion = {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  fullArtifactId: string;
  fullArtifactChecksum: string;
  rowCount: number;
  checksum: string;
  sourceType: "api" | "file";
};

export type SpecialCasePublisherReview = {
  publisherName: string;
  isSuspected: boolean;
  isChecked: boolean;
  notes: string;
  updatedAt: string;
  updatedBy: string;
};

export type SpecialCaseAdjustmentMode = "clear" | "set" | "";
export type SpecialCaseAppReview = {
  appId: string;
  needReadjustment: boolean;
  adjustmentMode: SpecialCaseAdjustmentMode;
  adjustedCleanedPublisherName: string;
  adjustedRevenueMultiplier: string;
  notes: string;
  updatedAt: string;
  updatedBy: string;
};

export type SpecialCaseInvestigationRow = SpecialCaseSourceRow & {
  isNewApp: boolean;
  isSuspected: boolean;
  isChecked: boolean;
  needReadjustment: boolean;
  adjustmentMode: SpecialCaseAdjustmentMode;
  adjustedCleanedPublisherName: string;
  adjustedRevenueMultiplier: string;
  notes: string;
};

export type SpecialCasePublisherGroup = {
  publisherName: string;
  cleanedPublisherName: string;
  revenueMultiplier: string;
  appCount: number;
  newAppCount: number;
  isSuspected: boolean;
  isChecked: boolean;
  notes: string;
};

export type SpecialCaseFinalRow = {
  appId: string;
  cleanedPublisherName: string;
  revenueMultiplier: string;
};

export type SpecialCaseFinalVersion = {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  rowCount: number;
  checksum: string;
  sourceVersionId: string;
  fullArtifactId: string;
  historicalVersionId: string | null;
};

export type SpecialCaseJob = {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  stage: string;
  message: string;
  pagesRead: number;
  scannedRecords: number;
  matchedRecords: number;
  expectedRecordCount: number;
  fullArtifactId: string;
  resultSourceVersionId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SpecialCasesOverview = {
  sourceVersions: SpecialCaseSourceVersion[];
  finalVersions: SpecialCaseFinalVersion[];
  currentSourceVersionId: string | null;
  comparisonSourceVersionId: string | null;
  activeFullArtifactId: string | null;
  publisherGroups: SpecialCasePublisherGroup[];
  knownCleanedPublishers: string[];
  canMutate: boolean;
};
