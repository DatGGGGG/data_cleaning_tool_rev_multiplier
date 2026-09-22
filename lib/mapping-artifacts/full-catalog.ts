// Compatibility re-export for callers that previously used the Full Mapping-only helper.
// New code should import shared behavior from `catalog.ts`.
export {
  activeFullEntry,
  activeStateAfterFailedActivation,
  artifactTypeLabel,
  committedFullArtifacts,
  isActiveFullArtifact,
  resolveFullMappingLineage,
} from "@/lib/mapping-artifacts/catalog";
export type { FullMappingLineage, FullMappingLineageSource } from "@/lib/mapping-artifacts/catalog";
