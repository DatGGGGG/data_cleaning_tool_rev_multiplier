import type { MappingArtifactJob, MappingArtifactJobStatus } from "@/lib/mapping-artifacts/types";

const JOB_STATUSES = new Set<MappingArtifactJobStatus>([
  "queued",
  "running",
  "success",
  "failed",
  "interrupted",
]);

export function isActiveEnrichmentJobStatus(status: MappingArtifactJobStatus) {
  return status === "queued" || status === "running";
}

export function isTerminalEnrichmentJobStatus(status: MappingArtifactJobStatus) {
  return !isActiveEnrichmentJobStatus(status);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return nonemptyString(value);
}

function jobStatus(value: unknown): MappingArtifactJobStatus | null {
  return typeof value === "string" && JOB_STATUSES.has(value as MappingArtifactJobStatus)
    ? value as MappingArtifactJobStatus
    : null;
}

function timestamp(value: unknown, required = false): string | null | undefined {
  if (value === null || value === undefined || value === "") return required ? undefined : null;
  const normalized = nonemptyString(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) return undefined;
  return normalized;
}

function jobCandidate(payload: unknown) {
  const outer = record(payload);
  if (!outer) return null;
  return record(outer.job) ?? outer;
}

export function normalizeStartedEnrichmentResponse(payload: unknown): {
  job_id: string;
  status: MappingArtifactJobStatus;
} | null {
  const outer = record(payload);
  const candidate = jobCandidate(payload);
  if (!outer || !candidate) return null;
  const id = nonemptyString(outer.job_id) ?? nonemptyString(candidate.id) ?? nonemptyString(candidate.job_id);
  const status = jobStatus(outer.status) ?? jobStatus(candidate.status);
  return id && status ? { job_id: id, status } : null;
}

/**
 * Status reads must contain a complete durable-job record. No timestamps are
 * fabricated by the workbench because that would corrupt the operator audit
 * trail.
 */
export function normalizeArtifactJobResponse(payload: unknown): { job: MappingArtifactJob } | null {
  const candidate = jobCandidate(payload);
  if (!candidate) return null;
  const id = nonemptyString(candidate.id) ?? nonemptyString(candidate.job_id);
  const status = jobStatus(candidate.status);
  const createdAt = timestamp(candidate.created_at, true);
  const startedAt = timestamp(candidate.started_at);
  const finishedAt = timestamp(candidate.finished_at);
  if (!id || !status || typeof createdAt !== "string" || startedAt === undefined || finishedAt === undefined) return null;
  const resultArtifactId = nullableString(candidate.result_artifact_id);
  if (status === "success" && !resultArtifactId) return null;
  return {
    job: {
      id,
      job_type: nonemptyString(candidate.job_type) ?? "top_down_publisher_ids",
      status,
      result_artifact_id: resultArtifactId,
      error_code: nullableString(candidate.error_code),
      error_summary: nullableString(candidate.error_summary),
      created_at: createdAt,
      started_at: startedAt,
      finished_at: finishedAt,
    },
  };
}
