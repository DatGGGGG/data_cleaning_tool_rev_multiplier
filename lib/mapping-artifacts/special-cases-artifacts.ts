import type {
  MappingArtifact,
  MappingArtifactActiveEntry,
  MappingArtifactActiveState,
  MappingArtifactReadiness,
} from "@/lib/mapping-artifacts/types";
import type { SpecialCaseFinalVersion } from "@/lib/special-cases/types";

export function findArtifactForSpecialCasesVersion(
  version: SpecialCaseFinalVersion,
  artifacts: MappingArtifact[],
) {
  // SensorTower canonicalizes Special Cases CSV before storage, so its recorded
  // checksum can legitimately differ from the locally saved CSV checksum. The
  // immutable workbench version ID is the stable publish identity; the pipeline
  // rejects a second publication of that identity with different canonical bytes.
  return artifacts.find(
    (artifact) =>
      artifact.artifact_type === "special_cases" &&
      artifact.source_workbench_workflow === "special_cases" &&
      artifact.source_workbench_version_id === version.id,
  ) ?? null;
}

export function activeSpecialCasesArtifact(
  active: MappingArtifactActiveState | null,
) {
  return active?.special_cases ?? null;
}

export function isActiveSpecialCasesArtifact(
  artifactId: string,
  active: MappingArtifactActiveEntry | null,
) {
  return active?.artifact.id === artifactId;
}

export function specialCasesPublishDisabledReason(
  readiness: MappingArtifactReadiness | null,
  artifact: MappingArtifact | null,
) {
  if (artifact) return "This saved version is already published to SensorTower.";
  if (!readiness?.canPublish) return "An authenticated analyst or admin can publish Special Cases.";
  return null;
}

export function specialCasesCommitDisabledReason(
  artifact: MappingArtifact | null,
  readiness: MappingArtifactReadiness | null,
) {
  if (!artifact) return "Publish this saved version first.";
  if (artifact.status === "committed") return "This artifact is already committed.";
  if (!artifact.validation.valid || artifact.validation.blocking_errors.length) {
    return "Resolve the pipeline validation errors before committing.";
  }
  if (!readiness?.canCommit) return "An authenticated analyst or admin can commit Special Cases.";
  return null;
}

export function specialCasesActivationDisabledReason(
  artifact: MappingArtifact | null,
  active: MappingArtifactActiveEntry | null,
  readiness: MappingArtifactReadiness | null,
) {
  if (!artifact) return "Publish and commit this saved version first.";
  if (artifact.status !== "committed") return "Commit a valid Special Cases draft before activating it.";
  if (isActiveSpecialCasesArtifact(artifact.id, active)) return "This is already the active Special Cases artifact.";
  if (!readiness?.canActivate) return "Only an authenticated admin can activate Special Cases.";
  return null;
}

export function specialCasesActivationConfirmationMessage(
  candidate: MappingArtifact,
  active: MappingArtifactActiveEntry | null,
) {
  return [
    "Activate this committed Special Cases artifact?",
    `Current active: ${active?.artifact.id ?? "none"}`,
    `Candidate: ${candidate.id}`,
    `Rows: ${candidate.row_count}`,
    `Checksum: ${candidate.checksum_sha256}`,
    `Full Mapping source: ${candidate.source_artifact_ids[0] ?? "not recorded"}`,
    "This affects future artifact-mode staging runs only and does not start ETL.",
  ].join("\n");
}
