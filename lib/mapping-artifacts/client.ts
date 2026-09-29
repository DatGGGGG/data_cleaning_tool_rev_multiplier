import { MappingArtifactWorkbenchError } from "@/lib/mapping-artifacts/errors";
import {
  normalizeArtifactJobResponse,
  normalizeStartedEnrichmentResponse,
} from "@/lib/mapping-artifacts/job-contract";
import type {
  MappingArtifact,
  MappingArtifactActivationHistoryResponse,
  MappingArtifactActivationResponse,
  MappingArtifactActiveResponse,
  MappingArtifactJob,
  MappingArtifactType,
} from "@/lib/mapping-artifacts/types";

type ApiErrorBody = { error?: { code?: unknown; message?: unknown; request_id?: unknown } | string; message?: unknown };

function pipelineConfig() {
  const baseUrl = process.env.SENSORTOWER_PIPELINE_API_BASE_URL?.trim().replace(/\/$/, "");
  const token = process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new MappingArtifactWorkbenchError(
      "service_not_configured",
      "The SensorTower Mapping Artifact service is not configured.",
      503,
    );
  }
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new MappingArtifactWorkbenchError("service_not_configured", "The configured mapping API URL is invalid.", 503);
  }
  return { baseUrl, token, timeoutMs: Math.max(1_000, Number(process.env.SENSORTOWER_PIPELINE_API_TIMEOUT_MS) || 30_000) };
}

function artifactIdPathPart(value: string) {
  if (!/^[0-9a-f-]{16,}$/i.test(value)) {
    throw new MappingArtifactWorkbenchError("invalid_request", "Malformed mapping artifact ID.", 400);
  }
  return encodeURIComponent(value);
}

async function requestPipeline<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = pipelineConfig();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new MappingArtifactWorkbenchError("upstream_timeout", "The SensorTower Mapping Artifact service timed out.", 504);
    }
    throw new MappingArtifactWorkbenchError("upstream_unreachable", "Could not reach the SensorTower Mapping Artifact service.", 502);
  }

  const raw = await response.text();
  let payload: ApiErrorBody & T = {} as ApiErrorBody & T;
  if (raw) {
    try {
      payload = JSON.parse(raw) as ApiErrorBody & T;
    } catch {
      if (!response.ok) {
        throw new MappingArtifactWorkbenchError("upstream_invalid_response", "The SensorTower Mapping Artifact service returned an invalid response.", 502);
      }
      throw new MappingArtifactWorkbenchError("upstream_invalid_response", "The SensorTower Mapping Artifact service returned invalid JSON.", 502);
    }
  }
  if (!response.ok) {
    const nested = typeof payload.error === "object" && payload.error ? payload.error : undefined;
    const code = String(nested?.code ?? "upstream_error");
    const message = String(nested?.message ?? payload.message ?? (typeof payload.error === "string" ? payload.error : "The SensorTower Mapping Artifact service rejected the request."));
    throw new MappingArtifactWorkbenchError(code, message, response.status);
  }
  return payload as T;
}

export async function listRemoteArtifacts(filters: { type?: MappingArtifactType; status?: string } = {}) {
  const search = new URLSearchParams();
  if (filters.type) search.set("type", filters.type);
  if (filters.status) search.set("status", filters.status);
  const suffix = search.size ? `?${search}` : "";
  return requestPipeline<{ artifacts: MappingArtifact[] }>(`/mapping-artifacts${suffix}`);
}

export function getRemoteArtifact(artifactId: string) {
  return requestPipeline<{ artifact: MappingArtifact }>(`/mapping-artifacts/${artifactIdPathPart(artifactId)}`);
}

export function getRemoteActiveArtifacts() {
  return requestPipeline<MappingArtifactActiveResponse>("/mapping-artifacts/active");
}

export function publishRemoteArtifact(input: {
  artifactType: "top_down_raw" | "bottom_up" | "special_cases";
  csvContent: string;
  checksumSha256: string;
  workflow: "top_down" | "bottom_up" | "special_cases";
  versionId: string;
  versionLabel: string;
  actor: string;
  sourceArtifactIds?: string[];
  sourceArtifactChecksums?: Record<string, string>;
  provenance?: Record<string, unknown>;
}) {
  return requestPipeline<{ artifact: MappingArtifact }>("/mapping-artifacts/publish", {
    method: "POST",
    body: JSON.stringify({
      artifact_type: input.artifactType,
      csv_content: input.csvContent,
      checksum_sha256: input.checksumSha256,
      source_workbench_workflow: input.workflow,
      source_workbench_version_id: input.versionId,
      source_workbench_version_label: input.versionLabel,
      created_by: input.actor,
      source_artifact_ids: input.sourceArtifactIds ?? [],
      source_artifact_checksums: input.sourceArtifactChecksums ?? {},
      provenance: input.provenance ?? {},
    }),
  });
}

export async function startRemoteTopDownEnrichment(sourceArtifactId: string, actor: string) {
  const payload = await requestPipeline<unknown>("/mapping-artifacts/generate/top-down-publisher-ids", {
    method: "POST",
    body: JSON.stringify({ source_artifact_id: sourceArtifactId, created_by: actor }),
  });
  const job = normalizeStartedEnrichmentResponse(payload);
  if (!job) {
    throw new MappingArtifactWorkbenchError("upstream_invalid_response", "The SensorTower service returned an invalid enrichment job response.", 502);
  }
  return job;
}

export async function getRemoteArtifactJob(jobId: string) {
  const payload = await requestPipeline<unknown>(`/mapping-artifacts/jobs/${artifactIdPathPart(jobId)}`);
  const job = normalizeArtifactJobResponse(payload);
  if (!job) {
    throw new MappingArtifactWorkbenchError("upstream_invalid_response", "The SensorTower service returned an invalid enrichment job status.", 502);
  }
  return job;
}

export function generateRemoteFull(input: { topDownArtifactId: string; bottomUpArtifactId: string; actor: string }) {
  return requestPipeline<{ artifact: MappingArtifact }>("/mapping-artifacts/generate/full", {
    method: "POST",
    body: JSON.stringify({
      top_down_artifact_id: input.topDownArtifactId,
      bottom_up_artifact_id: input.bottomUpArtifactId,
      created_by: input.actor,
    }),
  });
}

export function commitRemoteArtifact(artifactId: string, actor: string) {
  return requestPipeline<{ artifact: MappingArtifact }>(`/mapping-artifacts/${artifactIdPathPart(artifactId)}/commit`, {
    method: "POST",
    body: JSON.stringify({ committed_by: actor }),
  });
}

export function activateRemoteArtifact(artifactId: string, actor: string) {
  return requestPipeline<MappingArtifactActivationResponse>(`/mapping-artifacts/${artifactIdPathPart(artifactId)}/activate`, {
    method: "POST",
    body: JSON.stringify({ activated_by: actor }),
  });
}

export function getRemoteActivationHistory(type: "full" | "special_cases") {
  return requestPipeline<MappingArtifactActivationHistoryResponse>(
    `/mapping-artifacts/activation-history?type=${type}`,
  );
}

export async function downloadRemoteArtifact(artifactId: string) {
  const config = pipelineConfig();
  const response = await fetch(`${config.baseUrl}/mapping-artifacts/${artifactIdPathPart(artifactId)}/download`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new MappingArtifactWorkbenchError("upstream_error", "Could not download the mapping artifact.", response.status);
  }
  return { body: await response.arrayBuffer(), headers: response.headers };
}
