import type {
  MappingArtifact,
  MappingArtifactActiveEntry,
  MappingArtifactActiveState,
  MappingArtifactType,
} from "@/lib/mapping-artifacts/types";

export type FullMappingLineageSource = {
  expectedType: "top_down_with_publisher_ids" | "bottom_up";
  artifact: MappingArtifact | null;
  id: string | null;
  checksum: string | null;
};

export type FullMappingLineage = {
  enrichedTopDown: FullMappingLineageSource;
  bottomUp: FullMappingLineageSource;
};

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function committedFullArtifacts(artifacts: MappingArtifact[]) {
  return artifacts
    .filter((artifact) => artifact.artifact_type === "full" && artifact.status === "committed")
    .sort((left, right) => timestamp(right.committed_at || right.created_at) - timestamp(left.committed_at || left.created_at));
}

export function activeFullEntry(active: MappingArtifactActiveState | null) {
  return active?.full ?? null;
}

export function isActiveFullArtifact(artifactId: string, active: MappingArtifactActiveEntry | null) {
  return active?.artifact.id === artifactId;
}

function knownSource(
  sourceIds: string[],
  artifactsById: Map<string, MappingArtifact>,
  expectedType: FullMappingLineageSource["expectedType"],
) {
  for (const id of sourceIds) {
    const artifact = artifactsById.get(id);
    if (artifact?.artifact_type === expectedType) return artifact;
  }
  return null;
}

function fallbackSource(
  sourceIds: string[],
  consumedIds: Set<string>,
  checksums: Record<string, string>,
  expectedType: FullMappingLineageSource["expectedType"],
): FullMappingLineageSource {
  const id = sourceIds.find((candidate) => !consumedIds.has(candidate)) ?? null;
  if (id) consumedIds.add(id);
  return { expectedType, artifact: null, id, checksum: id ? checksums[id] ?? null : null };
}

function sourceFromArtifact(
  artifact: MappingArtifact,
  expectedType: FullMappingLineageSource["expectedType"],
): FullMappingLineageSource {
  return { expectedType, artifact, id: artifact.id, checksum: artifact.checksum_sha256 };
}

export function resolveFullMappingLineage(fullArtifact: MappingArtifact, catalog: MappingArtifact[]): FullMappingLineage {
  const artifactsById = new Map(catalog.map((artifact) => [artifact.id, artifact]));
  const sourceIds = fullArtifact.source_artifact_ids || [];
  const checksums = fullArtifact.source_artifact_checksums || {};
  const consumedIds = new Set<string>();
  const enriched = knownSource(sourceIds, artifactsById, "top_down_with_publisher_ids");
  const bottomUp = knownSource(sourceIds, artifactsById, "bottom_up");
  if (enriched) consumedIds.add(enriched.id);
  if (bottomUp) consumedIds.add(bottomUp.id);

  return {
    enrichedTopDown: enriched
      ? sourceFromArtifact(enriched, "top_down_with_publisher_ids")
      : fallbackSource(sourceIds, consumedIds, checksums, "top_down_with_publisher_ids"),
    bottomUp: bottomUp
      ? sourceFromArtifact(bottomUp, "bottom_up")
      : fallbackSource(sourceIds, consumedIds, checksums, "bottom_up"),
  };
}

export function activeStateAfterFailedActivation(previous: MappingArtifactActiveState | null) {
  return previous;
}

export function artifactTypeLabel(type: MappingArtifactType) {
  if (type === "top_down_with_publisher_ids") return "Apps + Publisher IDs";
  if (type === "bottom_up") return "Bottom Up";
  if (type === "top_down_raw") return "Raw Top Down";
  return "Full Mapping";
}
