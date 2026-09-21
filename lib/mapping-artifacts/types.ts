export type MappingArtifactType =
  | "top_down_raw"
  | "top_down_with_publisher_ids"
  | "bottom_up"
  | "full";

export type MappingArtifactStatus = "draft" | "committed";

export type MappingArtifactValidation = {
  required_columns: string[];
  missing_value_counts: Record<string, number>;
  duplicate_row_count: number;
  conflicting_key_count: number;
  unresolved_publisher_id_count: number;
  valid: boolean;
  blocking_errors: string[];
};

export type MappingArtifact = {
  id: string;
  artifact_type: MappingArtifactType;
  status: MappingArtifactStatus;
  canonical_filename: string;
  relative_path: string;
  schema_version: number;
  row_count: number;
  checksum_sha256: string;
  created_at: string;
  created_by: string;
  committed_at: string | null;
  committed_by: string | null;
  source_workbench_workflow: string | null;
  source_workbench_version_id: string | null;
  source_workbench_version_label: string | null;
  source_artifact_ids: string[];
  source_artifact_checksums: Record<string, string>;
  validation: MappingArtifactValidation;
  generator_version: string | null;
  repository_git_sha: string | null;
  bootstrap_import: boolean;
};

export type MappingArtifactJobStatus = "queued" | "running" | "success" | "failed" | "interrupted";

export type MappingArtifactJob = {
  id: string;
  job_type: string;
  status: MappingArtifactJobStatus;
  result_artifact_id: string | null;
  error_code: string | null;
  error_summary: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type MappingArtifactReadiness = {
  uiEnabled: boolean;
  mutationsEnabled: boolean;
  authenticated: boolean;
  canPublish: boolean;
  canCommit: boolean;
  canActivate: boolean;
  upstreamConfigured: boolean;
  message: string;
};

export type MappingArtifactPublicationReceipt = {
  workflow: "top_down" | "bottom_up";
  localVersionId: string;
  localVersionLabel: string;
  localChecksumSha256: string;
  remoteArtifactId: string;
  remoteArtifactType: "top_down_raw" | "bottom_up";
  remoteStatus: "committed";
  publishedAt: string;
  publishedBy: string;
};

export type MappingArtifactIntegrationLog = {
  id: string;
  action: string;
  actor: string;
  targetType: string;
  targetId: string;
  detail: string;
  createdAt: string;
};

export type MappingArtifactWorkbenchStore = {
  schemaVersion: 1;
  updatedAt: string;
  publications: MappingArtifactPublicationReceipt[];
  generationJobs: Array<{
    remoteJobId: string;
    sourceArtifactId: string;
    localTopDownVersionId: string;
    status: MappingArtifactJobStatus;
    resultArtifactId: string | null;
    errorCode: string | null;
    errorSummary: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  selections: {
    topDownWithPublisherIdsArtifactId: string | null;
    bottomUpArtifactId: string | null;
  };
  activity: MappingArtifactIntegrationLog[];
};
