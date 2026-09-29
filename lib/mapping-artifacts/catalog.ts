import type {
  MappingArtifact,
  MappingArtifactActiveEntry,
  MappingArtifactActiveState,
  MappingArtifactPublicationReceipt,
  MappingArtifactType,
} from "@/lib/mapping-artifacts/types";

export const MAPPING_ARTIFACT_TYPES = ["top_down_raw", "top_down_with_publisher_ids", "bottom_up", "full", "special_cases"] as const;

export type CatalogArtifactType = (typeof MAPPING_ARTIFACT_TYPES)[number];

export type ArtifactLineageSource = {
  artifact: MappingArtifact | null;
  id: string;
  checksum: string | null;
};

export type FullMappingLineageSource = ArtifactLineageSource & {
  expectedType: "top_down_with_publisher_ids" | "bottom_up";
};

export type FullMappingLineage = {
  enrichedTopDown: FullMappingLineageSource;
  bottomUp: FullMappingLineageSource;
};

export type PublishedSavedVersion = {
  artifactId: string;
  status: "committed";
  publishedAt: string | null;
  publishedBy: string | null;
};

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function artifactTypeLabel(type: MappingArtifactType) {
  if (type === "top_down_raw") return "Raw Top Down";
  if (type === "top_down_with_publisher_ids") return "Apps + Publisher IDs";
  if (type === "bottom_up") return "Bottom Up";
  if (type === "special_cases") return "Special Cases";
  return "Full Mapping";
}

export function artifactValidationLabel(artifact: MappingArtifact) {
  if (artifact.validation.valid && artifact.validation.blocking_errors.length === 0) return "Passed";
  return artifact.validation.blocking_errors.join(" ") || "Validation requires review";
}

export function committedArtifacts(artifacts: MappingArtifact[]) {
  return artifacts
    .filter((artifact) => artifact.status === "committed")
    .sort((left, right) => timestamp(right.committed_at || right.created_at) - timestamp(left.committed_at || left.created_at));
}

export function committedFullArtifacts(artifacts: MappingArtifact[]) {
  return committedArtifacts(artifacts).filter((artifact) => artifact.artifact_type === "full");
}

export function publishedSavedVersion(
  workflow: "top_down" | "bottom_up",
  versionId: string,
  checksumSha256: string,
  artifacts: MappingArtifact[],
  receipts: MappingArtifactPublicationReceipt[] = [],
): PublishedSavedVersion | null {
  const expectedType = workflow === "top_down" ? "top_down_raw" : "bottom_up";
  const remote = artifacts.find((artifact) => (
    artifact.artifact_type === expectedType
    && artifact.status === "committed"
    && artifact.source_workbench_workflow === workflow
    && artifact.source_workbench_version_id === versionId
    && artifact.checksum_sha256 === checksumSha256
  ));
  if (remote) {
    return {
      artifactId: remote.id,
      status: "committed",
      publishedAt: remote.committed_at || remote.created_at,
      publishedBy: remote.committed_by || remote.created_by,
    };
  }

  const receipt = receipts.find((item) => (
    item.workflow === workflow
    && item.localVersionId === versionId
    && item.localChecksumSha256 === checksumSha256
    && item.remoteArtifactType === expectedType
    && item.remoteStatus === "committed"
  ));
  return receipt?.remoteStatus === "committed" ? {
    artifactId: receipt.remoteArtifactId,
    status: receipt.remoteStatus,
    publishedAt: receipt.publishedAt,
    publishedBy: receipt.publishedBy,
  } : null;
}

export function artifactSearchText(artifact: MappingArtifact) {
  return [
    artifact.id,
    artifact.canonical_filename,
    artifact.checksum_sha256,
    artifact.created_by,
    artifact.committed_by,
    artifact.source_workbench_workflow,
    artifact.source_workbench_version_id,
    artifact.source_workbench_version_label,
    ...artifact.source_artifact_ids,
    ...Object.values(artifact.source_artifact_checksums),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

export function filterCommittedArtifacts(
  artifacts: MappingArtifact[],
  filters: { type?: CatalogArtifactType | "all"; search?: string } = {},
) {
  const type = filters.type || "all";
  const search = filters.search?.trim().toLocaleLowerCase() || "";
  return committedArtifacts(artifacts).filter((artifact) => {
    if (type !== "all" && artifact.artifact_type !== type) return false;
    return !search || artifactSearchText(artifact).includes(search);
  });
}

export function artifactCounts(artifacts: MappingArtifact[]) {
  const counts = Object.fromEntries(MAPPING_ARTIFACT_TYPES.map((type) => [type, 0])) as Record<CatalogArtifactType, number>;
  for (const artifact of committedArtifacts(artifacts)) counts[artifact.artifact_type] += 1;
  return counts;
}

export function activeArtifactEntry(
  active: MappingArtifactActiveState | null,
  type: "full" | "special_cases",
) {
  return active?.[type] ?? null;
}

export function activeFullEntry(active: MappingArtifactActiveState | null) {
  return activeArtifactEntry(active, "full");
}

export function activeSpecialCasesEntry(active: MappingArtifactActiveState | null) {
  return activeArtifactEntry(active, "special_cases");
}

export function isActiveFullArtifact(artifactId: string, active: MappingArtifactActiveEntry | null) {
  return active?.artifact.id === artifactId;
}

export function isActiveSpecialCasesArtifact(
  artifactId: string,
  active: MappingArtifactActiveEntry | null,
) {
  return active?.artifact.id === artifactId;
}

export function canActivateCommittedFull(
  artifact: MappingArtifact,
  active: MappingArtifactActiveEntry | null,
  isAdmin: boolean,
) {
  return isAdmin && artifact.artifact_type === "full" && artifact.status === "committed" && !isActiveFullArtifact(artifact.id, active);
}

export function resolveArtifactLineage(artifact: MappingArtifact, catalog: MappingArtifact[]): ArtifactLineageSource[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return artifact.source_artifact_ids.map((id) => {
    const source = byId.get(id) || null;
    return { artifact: source, id, checksum: source?.checksum_sha256 ?? artifact.source_artifact_checksums[id] ?? null };
  });
}

function knownSource(
  sources: ArtifactLineageSource[],
  expectedType: FullMappingLineageSource["expectedType"],
) {
  return sources.find((source) => source.artifact?.artifact_type === expectedType) || null;
}

function typedSource(
  expectedType: FullMappingLineageSource["expectedType"],
  source: ArtifactLineageSource | null,
): FullMappingLineageSource {
  return { expectedType, artifact: source?.artifact || null, id: source?.id || "", checksum: source?.checksum || null };
}

export function resolveFullMappingLineage(fullArtifact: MappingArtifact, catalog: MappingArtifact[]): FullMappingLineage {
  const sources = resolveArtifactLineage(fullArtifact, catalog);
  const enriched = knownSource(sources, "top_down_with_publisher_ids");
  const bottomUp = knownSource(sources, "bottom_up");
  const used = new Set([enriched?.id, bottomUp?.id].filter(Boolean));
  const fallback = sources.filter((source) => !used.has(source.id));
  return {
    enrichedTopDown: typedSource("top_down_with_publisher_ids", enriched || fallback.shift() || null),
    bottomUp: typedSource("bottom_up", bottomUp || fallback.shift() || null),
  };
}

export function activationConfirmationMessage(candidate: MappingArtifact, active: MappingArtifactActiveEntry | null, catalog: MappingArtifact[]) {
  const lineage = resolveFullMappingLineage(candidate, catalog);
  return [
    "Activate this committed Full Mapping?",
    `Current active: ${active?.artifact.id ?? "none"}`,
    `Candidate: ${candidate.id}`,
    `Rows: ${candidate.row_count}`,
    `Checksum: ${candidate.checksum_sha256}`,
    `Apps + Publisher IDs source: ${lineage.enrichedTopDown.id || "not recorded"}`,
    `Bottom Up source: ${lineage.bottomUp.id || "not recorded"}`,
    "This affects future artifact-mode staging runs only and does not start a pipeline.",
  ].join("\n");
}

export function activeStateAfterFailedActivation(previous: MappingArtifactActiveState | null) {
  return previous;
}

export function publicArtifactDetails(artifact: MappingArtifact) {
  return {
    canonicalFilename: artifact.canonical_filename,
    schemaVersion: artifact.schema_version,
    checksum: artifact.checksum_sha256,
    createdAt: artifact.created_at,
    createdBy: artifact.created_by,
    committedAt: artifact.committed_at,
    committedBy: artifact.committed_by,
    sourceWorkflow: artifact.source_workbench_workflow,
    sourceVersionId: artifact.source_workbench_version_id,
    sourceVersionLabel: artifact.source_workbench_version_label,
    generatorVersion: artifact.generator_version,
    repositoryGitSha: artifact.repository_git_sha,
    bootstrapImport: artifact.bootstrap_import,
    validation: artifact.validation,
    sourceArtifactIds: artifact.source_artifact_ids,
    sourceArtifactChecksums: artifact.source_artifact_checksums,
  };
}
