import type { MappingArtifactJobStatus } from "@/lib/mapping-artifacts/types";

export function isActiveEnrichmentStatus(status: MappingArtifactJobStatus) {
  return status === "queued" || status === "running";
}

/**
 * The pipeline does not currently report row-level completion, so this is a
 * polling cadence rather than a fabricated percentage estimate.
 */
export function enrichmentPollDelay(status: MappingArtifactJobStatus, consecutiveFailures = 0) {
  if (!isActiveEnrichmentStatus(status)) return null;
  if (consecutiveFailures > 0) return Math.min(5_000 * (2 ** (consecutiveFailures - 1)), 15_000);
  return status === "queued" ? 2_000 : 5_000;
}

export function enrichmentProgressLabel(status: MappingArtifactJobStatus, consecutiveFailures = 0) {
  if (consecutiveFailures > 0) return "Status check failed. Reconnecting automatically…";
  if (status === "queued") return "Queued — checking for a worker every 2 seconds.";
  if (status === "running") return "Running — checking progress every 5 seconds.";
  if (status === "success") return "Completed.";
  if (status === "failed") return "Failed.";
  return "Interrupted.";
}
