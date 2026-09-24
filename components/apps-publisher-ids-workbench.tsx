"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import { normalizeArtifactJobResponse, normalizeStartedEnrichmentResponse } from "@/lib/mapping-artifacts/job-contract";
import { enrichmentPollDelay, enrichmentProgressLabel, isActiveEnrichmentStatus } from "@/lib/mapping-artifacts/polling";
import type { MappingArtifact, MappingArtifactJob, MappingArtifactJobResume, MappingArtifactReadiness } from "@/lib/mapping-artifacts/types";

type Props = { enrichmentResumeJob: MappingArtifactJobResume | null };
type CatalogResponse = { artifacts: MappingArtifact[] };

function short(value: string | null | undefined) { return value ? (value.length > 12 ? `${value.slice(0, 12)}…` : value) : "—"; }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }
function active(job: MappingArtifactJob | null) { return Boolean(job && isActiveEnrichmentStatus(job.status)); }

export function AppsPublisherIdsWorkbench({ enrichmentResumeJob }: Props) {
  const [readiness, setReadiness] = useState<MappingArtifactReadiness | null>(null);
  const [artifacts, setArtifacts] = useState<MappingArtifact[]>([]);
  const [sourceArtifactId, setSourceArtifactId] = useState(enrichmentResumeJob?.sourceArtifactId ?? "");
  const [job, setJob] = useState<MappingArtifactJob | null>(enrichmentResumeJob?.job ?? null);
  const [message, setMessage] = useState("Checking Apps + Publisher IDs readiness…");
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const currentJobId = useRef<string | null>(enrichmentResumeJob?.job.id ?? null);

  const rawTopDown = useMemo(() => artifacts.filter((item) => item.artifact_type === "top_down_raw" && item.status === "committed"), [artifacts]);
  const generatedVersions = useMemo(() => artifacts.filter((item) => item.artifact_type === "top_down_with_publisher_ids").sort((left, right) => right.created_at.localeCompare(left.created_at)), [artifacts]);
  const canGenerate = Boolean(readiness?.canPublish && !busy);
  const canCommit = Boolean(readiness?.canCommit && !busy);

  async function parse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new Error(payload.error?.code ? `${payload.error.code}: ${payload.error.message || "Request failed."}` : payload.error?.message || "Request failed.");
    return payload;
  }

  async function refresh() {
    const readinessResponse = await fetch(appApiPath("/api/mapping-artifacts/readiness"), { cache: "no-store" });
    const nextReadiness = await parse<MappingArtifactReadiness>(readinessResponse);
    setReadiness(nextReadiness);
    if (!nextReadiness.authenticated) {
      setMessage(nextReadiness.message);
      return;
    }
    const catalogResponse = await fetch(appApiPath("/api/mapping-artifacts/catalog"), { cache: "no-store" });
    const catalog = await parse<CatalogResponse>(catalogResponse);
    setArtifacts(catalog.artifacts);
    setMessage(nextReadiness.message);
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load mapping artifacts.")); }, []);
  useEffect(() => { currentJobId.current = job?.id ?? null; }, [job?.id]);

  useEffect(() => {
    if (!job || !active(job)) return;
    const jobId = job.id;
    let cancelled = false;
    let timer: number | null = null;
    let failures = 0;
    const poll = async () => {
      try {
        const response = await fetch(appApiPath(`/api/mapping-artifacts/jobs/${jobId}`), { cache: "no-store" });
        const payload = normalizeArtifactJobResponse(await parse<unknown>(response));
        if (!payload) throw new Error("The server returned an invalid enrichment status.");
        if (cancelled || currentJobId.current !== jobId) return;
        failures = 0;
        setPollError(null);
        setJob(payload.job);
        if (payload.job.status === "success") {
          setMessage("Apps + Publisher IDs draft is ready for review.");
          await refresh();
        } else if (payload.job.status === "failed" || payload.job.status === "interrupted") {
          setMessage(`Apps + Publisher IDs generation ${payload.job.status}.`);
        }
        const delay = enrichmentPollDelay(payload.job.status);
        if (delay !== null && !cancelled) timer = window.setTimeout(() => void poll(), delay);
      } catch (error) {
        if (cancelled) return;
        failures += 1;
        setPollError(error instanceof Error ? error.message : "Could not refresh job status.");
        const delay = enrichmentPollDelay(job.status, failures);
        if (delay !== null) timer = window.setTimeout(() => void poll(), delay);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer); };
  }, [job?.id, job?.status]);

  async function start(sourceId = sourceArtifactId) {
    if (!sourceId) return;
    setBusy(true);
    try {
      const response = await fetch(appApiPath("/api/mapping-artifacts/generate/top-down-publisher-ids"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceArtifactId: sourceId }),
      });
      const payload = normalizeStartedEnrichmentResponse(await parse<unknown>(response));
      if (!payload) throw new Error("The server returned an invalid enrichment job.");
      const createdAt = new Date().toISOString();
      setSourceArtifactId(sourceId);
      setPollError(null);
      setJob({ id: payload.job_id, job_type: "top_down_publisher_ids", status: payload.status, result_artifact_id: null, error_code: null, error_summary: null, created_at: createdAt, started_at: null, finished_at: null });
      setMessage("Apps + Publisher IDs generation was queued. Progress refreshes automatically.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start Apps + Publisher IDs generation.");
    } finally { setBusy(false); }
  }

  async function commit(artifactId: string) {
    setBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}/commit`), { method: "POST" });
      const payload = await parse<{ artifact: MappingArtifact }>(response);
      setArtifacts((current) => current.map((item) => item.id === artifactId ? payload.artifact : item));
      setMessage(`Committed Apps + Publisher IDs artifact ${short(artifactId)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not commit Apps + Publisher IDs artifact.");
    } finally { setBusy(false); }
  }

  return <div className="workspace-page">
    <section className="page-banner"><div><p className="page-kicker">Mapping Artifact Workflow</p><h1>Apps + Publisher IDs</h1><p className="page-summary">Enrich a committed Top Down source with SensorTower publisher IDs, then review and commit the immutable output.</p></div></section>
    <section className="surface-card"><div className="section-heading"><div><h2>Service readiness</h2><p>{message}</p></div><button type="button" className="button button-secondary" disabled={busy} onClick={() => void refresh()}>Refresh</button></div></section>
    <section className="surface-card"><div className="section-heading"><div><h2>1. Generate Apps + Publisher IDs</h2><p>Select an explicitly committed raw Top Down artifact. The workbench never selects a source automatically.</p></div></div><label className="settings-field"><span>Committed raw Top Down</span><select value={sourceArtifactId} onChange={(event) => setSourceArtifactId(event.target.value)} disabled={!readiness?.authenticated || busy || active(job)}><option value="">Select committed raw Top Down</option>{rawTopDown.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label><div className="action-strip"><button className="button button-primary" type="button" disabled={!canGenerate || !sourceArtifactId || active(job)} onClick={() => void start()}>{job?.status === "failed" || job?.status === "interrupted" ? "Generate Again" : "Generate Publisher IDs"}</button></div>{job ? <article className={`enrichment-job-card enrichment-job-${job.status}`} aria-live="polite"><div className="enrichment-job-heading"><div><p className="field-label">Top Down enrichment job</p><strong>{short(job.id)}</strong></div><span className="enrichment-job-status">{job.status}</span></div><dl className="enrichment-job-details"><div><dt>Source artifact</dt><dd>{short(sourceArtifactId)}</dd></div><div><dt>Created</dt><dd>{date(job.created_at)}</dd></div><div><dt>Started</dt><dd>{date(job.started_at)}</dd></div><div><dt>Finished</dt><dd>{date(job.finished_at)}</dd></div></dl><div className={`enrichment-progress enrichment-progress-${job.status}`} role="progressbar" aria-label="Apps and Publisher IDs generation progress" aria-valuetext={enrichmentProgressLabel(job.status, pollError ? 1 : 0)} aria-busy={active(job)}><span className="enrichment-progress-indicator" /></div>{pollError ? <p className="error-text">Status check failed: {pollError}. Reconnecting automatically.</p> : null}{job.error_summary ? <p className="error-text">{job.error_summary}</p> : null}</article> : null}</section>
    <section className="surface-card"><div className="section-heading"><div><h2>2. Apps + Publisher IDs versions</h2><p>Drafts remain reviewable and downloadable. Only valid drafts can be committed.</p></div></div>{generatedVersions.length === 0 ? <p className="muted-text">No Apps + Publisher IDs versions are available yet.</p> : <div className="full-mapping-catalog">{generatedVersions.map((artifact) => <article className="full-mapping-version-card" key={artifact.id}><div className="full-mapping-version-heading"><div><div className="full-mapping-version-title"><strong>{short(artifact.id)}</strong><span className={artifact.status === "committed" ? "active-version-label" : "bootstrap-artifact-badge"}>{artifact.status}</span></div><p>{artifact.row_count} rows · unresolved publisher IDs: {artifact.validation.unresolved_publisher_id_count} · checksum {short(artifact.checksum_sha256)}</p></div><div className="action-strip"><Link className="button button-secondary button-inline" href={`/artifact-registry/${artifact.id}`}>View</Link><a className="button button-secondary button-inline" href={appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/download`)}>Download CSV</a><button className="button button-primary button-inline" type="button" disabled={!canCommit || artifact.status !== "draft" || artifact.validation.blocking_errors.length > 0} onClick={() => void commit(artifact.id)}>{artifact.status === "committed" ? "Committed" : "Commit Draft"}</button></div></div><dl className="full-mapping-metadata"><div><dt>Created</dt><dd>{date(artifact.created_at)} by {artifact.created_by || "—"}</dd></div><div><dt>Committed</dt><dd>{date(artifact.committed_at)} by {artifact.committed_by || "—"}</dd></div><div><dt>Validation</dt><dd>{artifact.validation.valid ? "Passed" : artifact.validation.blocking_errors.join(" ") || "Requires review"}</dd></div><div><dt>Source raw Top Down</dt><dd>{artifact.source_artifact_ids.length ? short(artifact.source_artifact_ids[0]) : "—"}</dd></div></dl></article>)}</div>}</section>
  </div>;
}
