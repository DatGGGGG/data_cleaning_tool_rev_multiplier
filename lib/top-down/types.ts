export type ReviewStatus = "needs_review" | "confirmed" | "seeded";

export type SensorTowerPlatform = "ios" | "android";

export type PublisherPlatformSource = "resolved" | "manual";

export type PublisherPlatformEntry = {
  appId: string;
  publisherName: string;
  appName: string;
  source: PublisherPlatformSource;
};

export type SensorTowerResolutionStatus = "idle" | "resolving" | "resolved" | "failed" | "empty";

export type SensorTowerOption = PublisherPlatformEntry & {
  os: SensorTowerPlatform;
  unifiedAppId: string;
  label: string;
};

export type SensorTowerResolutionState = {
  status: SensorTowerResolutionStatus;
  unifiedAppId: string;
  resolvedGameName: string;
  errorMessage: string;
  resolvedAt: string;
  iosOptions: SensorTowerOption[];
  androidOptions: SensorTowerOption[];
};

export type PublisherRowDraft = {
  id: string;
  ordinal: number;
  gameName: string;
  sensorTowerLink: string;
  iosApps: PublisherPlatformEntry[];
  androidApps: PublisherPlatformEntry[];
  sensorTowerResolution: SensorTowerResolutionState;
  addingDate: string;
  adder: string;
  reviewStatus: ReviewStatus;
  notes: string;
};

export type PublisherSheet = {
  id: string;
  key: string;
  name: string;
  revenueMultiplier: string;
  rows: PublisherRowDraft[];
};

export type PublisherSeed = {
  key: string;
  name: string;
  revenueMultiplier?: string;
  sortOrder: number;
  rows: PublisherRowDraft[];
};

export type FlattenedPublisherRow = {
  id: string;
  os: SensorTowerPlatform;
  cleanedPublisherName: string;
  gameName: string;
  sensorTowerLink: string;
  appIdTrimmed: string;
};

export type ActivityLogEntry = {
  id: string;
  action: string;
  actor: string;
  targetType: string;
  targetId: string;
  detail: string;
  createdAt: string;
};

export type TopDownVersionSnapshot = {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  publisherCount: number;
};

export type TopDownWorkbenchState = {
  datasetId: string;
  operatorName: string;
  publishers: PublisherSheet[];
  versions: TopDownVersionSnapshot[];
  logs: ActivityLogEntry[];
};

export type PublisherOverviewRow = {
  id: string;
  key: string;
  name: string;
  revenueMultiplier: string;
  rowCount: number;
  flattenedAppCount: number;
  needsReviewCount: number;
  sensorTowerIssueCount: number;
};

export type TopDownOverviewState = {
  datasetId: string;
  operatorName: string;
  publishers: PublisherOverviewRow[];
  publisherCount: number;
  flattenedRowCount: number;
  needsReviewCount: number;
  versions: TopDownVersionSnapshot[];
  logs: ActivityLogEntry[];
};

export type TopDownPublisherRegistryEntry = {
  publisherName: string;
  revenueMultiplier: string;
};

export type SensorTowerResolveResponse = {
  status: SensorTowerResolutionStatus;
  unifiedAppId: string;
  resolvedGameName?: string;
  iosOptions: SensorTowerOption[];
  androidOptions: SensorTowerOption[];
  errorMessage?: string;
  resolvedAt?: string;
};

export type SensorTowerLocalAppLookupResponse = {
  found: boolean;
  os: SensorTowerPlatform;
  appId: string;
  publisherName?: string;
  appName?: string;
  unifiedAppId?: string;
  errorMessage?: string;
};
