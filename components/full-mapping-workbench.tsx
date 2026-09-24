"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import type { BottomUpVersionMetadata } from "@/lib/bottom-up/types";
import type { TopDownVersionFreshness, TopDownVersionMetadata } from "@/lib/top-down/types";
import {
  activeFullEntry,
  activationConfirmationMessage,
  committedFullArtifacts,
  isActiveFullArtifact,
  publishedSavedVersion,
  resolveFullMappingLineage,
  type FullMappingLineageSource,
} from "@/lib/mapping-artifacts/catalog";
import {
  normalizeArtifactJobResponse,
  normalizeStartedEnrichmentResponse,
} from "@/lib/mapping-artifacts/job-contract";
import {
  enrichmentPollDelay,
  enrichmentProgressLabel,
  isActiveEnrichmentStatus,
} from "@/lib/mapping-artifacts/polling";
import type {
  MappingArtifact,
  MappingArtifactActivationResponse,
  MappingArtifactActiveResponse,
  MappingArtifactActiveState,
  MappingArtifactJob,
  MappingArtifactJobResume,
  MappingArtifactPublicationReceipt,
  MappingArtifactReadiness,
} from "@/lib/mapping-artifacts/types";

type Props = {
  topDownVersions: TopDownVersionMetadata[];
  bottomUpVersions: BottomUpVersionMetadata[];
  topDownVersionFreshness: TopDownVersionFreshness;
  enrichmentResumeJob: MappingArtifactJobResume | null;
  publicationReceipts: MappingArtifactPublicationReceipt[];
};
type CatalogResponse = { artifacts: MappingArtifact[] };

function short(value: string | null | undefined) { return value ? (value.length > 12 ? `${value.slice(0, 12)}…` : value) : "—"; }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }
function enrichmentIsActive(job: MappingArtifactJob | null) { return job ? isActiveEnrichmentStatus(job.status) : false; }
function requestWasAborted(error: unknown) { return error instanceof Error && error.name === "AbortError"; }

function sourceDescription(source: FullMappingLineageSource) {
  if (source.artifact) return `${short(source.artifact.id)} · ${source.artifact.row_count} rows · ${short(source.artifact.checksum_sha256)}`;
  if (source.id) return `${short(source.id)} · ${source.checksum ? short(source.checksum) : "checksum unavailable"} (recorded lineage)`;
  return "Not recorded";
}

export function FullMappingWorkbench({ topDownVersions, bottomUpVersions, topDownVersionFreshness, enrichmentResumeJob, publicationReceipts }: Props) {
  const [readiness, setReadiness] = useState<MappingArtifactReadiness | null>(null);
  const [artifacts, setArtifacts] = useState<MappingArtifact[]>([]);
  const [activeState, setActiveState] = useState<MappingArtifactActiveState | null>(null);
  const [topDownArtifactId, setTopDownArtifactId] = useState("");
  const [bottomUpArtifactId, setBottomUpArtifactId] = useState("");
  const [rawTopDownArtifactId, setRawTopDownArtifactId] = useState(enrichmentResumeJob?.sourceArtifactId ?? "");
  const [enrichmentJob, setEnrichmentJob] = useState<MappingArtifactJob | null>(enrichmentResumeJob?.job ?? null);
  const [enrichmentSourceArtifactId, setEnrichmentSourceArtifactId] = useState(enrichmentResumeJob?.sourceArtifactId ?? "");
  const [enrichedDraft, setEnrichedDraft] = useState<MappingArtifact | null>(null);
  const [enrichmentPollingError, setEnrichmentPollingError] = useState<string | null>(null);
  const [generatedFull, setGeneratedFull] = useState<MappingArtifact | null>(null);
  const [message, setMessage] = useState("Checking Mapping Artifact readiness…");
  const [busy, setBusy] = useState(false);
  const [activatingArtifactId, setActivatingArtifactId] = useState<string | null>(null);
  const loadedEnrichedDraftArtifactId = useRef<string | null>(null);
  const enrichmentJobIdRef = useRef<string | null>(enrichmentResumeJob?.job.id ?? null);

  const enrichedTopDown = useMemo(
    () => artifacts.filter((item) => item.artifact_type === "top_down_with_publisher_ids" && item.status === "committed"),
    [artifacts],
  );
  const committedBottomUp = useMemo(
    () => artifacts.filter((item) => item.artifact_type === "bottom_up" && item.status === "committed"),
    [artifacts],
  );
  const committedRawTopDown = useMemo(
    () => artifacts.filter((item) => item.artifact_type === "top_down_raw" && item.status === "committed"),
    [artifacts],
  );
  const committedFullMappings = useMemo(() => committedFullArtifacts(artifacts), [artifacts]);
  const activeFull = activeFullEntry(activeState);

  async function parse(response: Response) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string }; artifact?: MappingArtifact };
    if (!response.ok) {
      const message = payload.error?.message || "Request failed.";
      throw new Error(payload.error?.code ? `${payload.error.code}: ${message}` : message);
    }
    return payload;
  }

  async function refreshRemote() {
    const readinessResponse = await fetch(appApiPath("/api/mapping-artifacts/readiness"), { cache: "no-store" });
    const nextReadiness = await parse(readinessResponse) as MappingArtifactReadiness;
    setReadiness(nextReadiness);
    setMessage(nextReadiness.message);
    if (!nextReadiness.authenticated) return;

    const [catalogResponse, activeResponse] = await Promise.all([
      fetch(appApiPath("/api/mapping-artifacts/catalog"), { cache: "no-store" }),
      fetch(appApiPath("/api/mapping-artifacts/active"), { cache: "no-store" }),
    ]);
    const catalog = await parse(catalogResponse) as CatalogResponse;
    const active = await parse(activeResponse) as MappingArtifactActiveResponse;
    setArtifacts(catalog.artifacts);
    setActiveState(active.active);
  }

  useEffect(() => { void refreshRemote().catch((error) => setMessage(error instanceof Error ? error.message : "Failed to check readiness.")); }, []);

  useEffect(() => { enrichmentJobIdRef.current = enrichmentJob?.id ?? null; }, [enrichmentJob?.id]);

  async function loadEnrichedDraft(artifactId: string, refreshCatalog = true) {
    const detailResponse = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}`), { cache: "no-store" });
    const detail = await parse(detailResponse) as { artifact?: MappingArtifact };
    if (!detail.artifact) throw new Error("The server returned an invalid generated artifact.");
    setEnrichedDraft(detail.artifact);
    if (refreshCatalog) await refreshRemote();
  }

  async function fetchEnrichmentStatus(jobId: string, signal?: AbortSignal) {
    const response = await fetch(appApiPath(`/api/mapping-artifacts/jobs/${jobId}`), { cache: "no-store", signal });
    const payload = normalizeArtifactJobResponse(await parse(response));
    if (!payload) throw new Error("The server returned an invalid enrichment job status.");
    return payload.job;
  }

  function applyEnrichmentStatus(job: MappingArtifactJob) {
    setEnrichmentJob(job);
    setEnrichmentPollingError(null);
    if (job.status === "success") setMessage("Apps + Publisher IDs draft is ready for review.");
    else if (job.status === "failed" || job.status === "interrupted") {
      setMessage(`Top Down enrichment ${job.status}. Review the job details, then generate again when ready.`);
    }
  }

  useEffect(() => {
    if (!enrichmentJob?.result_artifact_id || enrichmentJob.status !== "success" || loadedEnrichedDraftArtifactId.current === enrichmentJob.result_artifact_id) return;
    let current = true;
    loadedEnrichedDraftArtifactId.current = enrichmentJob.result_artifact_id;
    void loadEnrichedDraft(enrichmentJob.result_artifact_id)
      .then(() => { if (current) setMessage("Apps + Publisher IDs draft is ready for review."); })
      .catch((error) => { if (current) setEnrichmentPollingError(error instanceof Error ? error.message : "Could not load the completed draft."); });
    return () => { current = false; };
  }, [enrichmentJob?.result_artifact_id, enrichmentJob?.status]);

  useEffect(() => {
    if (!enrichmentJob || !enrichmentIsActive(enrichmentJob)) return;

    const jobId = enrichmentJob.id;
    let current = true;
    let timer: number | null = null;
    let request: AbortController | null = null;
    let requestInFlight = false;
    let consecutiveFailures = 0;
    let lastKnownStatus = enrichmentJob.status;

    const schedule = (delay: number) => {
      if (!current) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void poll(); }, delay);
    };

    const poll = async () => {
      if (!current || requestInFlight) return;
      requestInFlight = true;
      request = new AbortController();
      try {
        const nextJob = await fetchEnrichmentStatus(jobId, request.signal);
        if (!current || enrichmentJobIdRef.current !== jobId) return;
        lastKnownStatus = nextJob.status;
        consecutiveFailures = 0;
        applyEnrichmentStatus(nextJob);
        const nextDelay = enrichmentPollDelay(nextJob.status);
        if (nextDelay !== null) schedule(nextDelay);
      } catch (error) {
        if (!current || requestWasAborted(error)) return;
        consecutiveFailures += 1;
        const detail = error instanceof Error ? error.message : "Could not refresh enrichment status.";
        setEnrichmentPollingError(detail);
        setMessage("Status check failed. Reconnecting automatically…");
        const nextDelay = enrichmentPollDelay(lastKnownStatus, consecutiveFailures);
        if (nextDelay !== null) schedule(nextDelay);
      } finally {
        requestInFlight = false;
        request = null;
      }
    };

    const refreshImmediately = () => {
      if (!requestInFlight) schedule(0);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshImmediately();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshImmediately);
    schedule(0);
    return () => {
      current = false;
      if (timer !== null) window.clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshImmediately);
    };
  }, [enrichmentJob?.id, enrichmentJob?.status]);

  async function publish(workflow: "top-down" | "bottom-up", versionId: string) {
    setBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/publish/${workflow}`), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId }),
      });
      const payload = await parse(response);
      setMessage(`Published saved ${workflow} version as artifact ${short(payload.artifact?.id || "")}.`);
      await refreshRemote();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not publish saved version."); }
    finally { setBusy(false); }
  }

  async function generateFull() {
    if (!topDownArtifactId || !bottomUpArtifactId) return;
    setBusy(true);
    try {
      const response = await fetch(appApiPath("/api/mapping-artifacts/generate/full"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topDownArtifactId, bottomUpArtifactId }),
      });
      const payload = await parse(response);
      setGeneratedFull(payload.artifact ?? null);
      setMessage("Generated a Full Mapping draft. Review it before committing.");
      await refreshRemote();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not generate Full Mapping."); }
    finally { setBusy(false); }
  }

  async function startEnrichment(sourceArtifactId = rawTopDownArtifactId) {
    const source = committedRawTopDown.find((item) => item.id === sourceArtifactId);
    if (!source) return;
    setBusy(true);
    try {
      const response = await fetch(appApiPath("/api/mapping-artifacts/generate/top-down-publisher-ids"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceArtifactId: source.id, localTopDownVersionId: source.source_workbench_version_id || "" }),
      });
      const payload = normalizeStartedEnrichmentResponse(await parse(response));
      if (!payload) throw new Error("The server returned an invalid enrichment job response.");
      const createdAt = new Date().toISOString();
      setRawTopDownArtifactId(source.id);
      setEnrichmentSourceArtifactId(source.id);
      setEnrichedDraft(null);
      setEnrichmentPollingError(null);
      loadedEnrichedDraftArtifactId.current = null;
      setEnrichmentJob({ id: payload.job_id, job_type: "top_down_publisher_ids", status: payload.status, result_artifact_id: null, error_code: null, error_summary: null, created_at: createdAt, started_at: null, finished_at: null });
      setMessage("Top Down enrichment was queued. This page will poll its durable job status.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start Top Down enrichment."); }
    finally { setBusy(false); }
  }

  async function commit(artifactId: string) {
    setBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}/commit`), { method: "POST" });
      const payload = await parse(response);
      if (!payload.artifact) throw new Error("The server returned an invalid committed artifact.");
      if (enrichedDraft?.id === artifactId) {
        setEnrichedDraft(payload.artifact);
        setMessage("Committed immutable Apps + Publisher IDs artifact.");
      } else {
        setGeneratedFull(payload.artifact);
        setMessage("Committed immutable Full Mapping artifact.");
      }
      await refreshRemote();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not commit artifact."); }
    finally { setBusy(false); }
  }

  async function activate(artifact: MappingArtifact) {
    const confirmation = activationConfirmationMessage(artifact, activeFull, artifacts);
    if (!window.confirm(confirmation)) return;
    setActivatingArtifactId(artifact.id);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/activate`), { method: "POST" });
      const payload = await parse(response) as MappingArtifactActivationResponse;
      if (!payload.active || typeof payload.status !== "string") throw new Error("The pipeline returned an invalid activation response.");
      await refreshRemote();
      setMessage(`Activated Full Mapping artifact ${short(artifact.id)}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not activate artifact."); }
    finally { setActivatingArtifactId(null); }
  }

  const canPublish = Boolean(readiness?.canPublish && !busy);
  const canCommit = Boolean(readiness?.canCommit && !busy);
  const canActivate = Boolean(readiness?.canActivate);
  const canRead = Boolean(readiness?.authenticated);
  const blocking = generatedFull?.validation.blocking_errors ?? [];

  return <div className="workspace-page">
    <section className="page-banner">
      <div><p className="page-kicker">Mapping Artifact Workflow</p><h1>Full Mapping</h1><p className="page-summary">Combine committed enriched Top Down and Bottom Up mapping versions using the authoritative SensorTower pipeline.</p></div>
      <div className="banner-pill-stack"><span className="metric-pill">{readiness?.uiEnabled ? "UI enabled" : "UI disabled"}</span><span className="metric-pill">{readiness?.mutationsEnabled ? "Mutations enabled" : "Safe mode"}</span></div>
    </section>

    <section className="surface-card"><div className="section-heading"><div><h2>Service readiness</h2><p>{message}</p></div><button type="button" className="button button-secondary" onClick={() => void refreshRemote()} disabled={busy}>Refresh</button></div>
      {!readiness?.authenticated ? <p className="muted-text">Artifact metadata, downloads, publication, commits, and activation remain unavailable until authenticated workbench roles are connected. The editable Operator fields elsewhere in this site do not grant access.</p> : null}
    </section>

    <section className="content-grid">
      <div className="surface-card"><div className="section-heading"><div><h2>1. Publish saved source versions</h2><p>Only immutable saved versions can be sent to SensorTower. Local CSV export alone does not publish anything.</p></div></div>
        {topDownVersionFreshness.hasUnversionedChanges ? <div className="version-freshness-warning" role="status"><div><strong>Top Down has newer working changes</strong><p>The saved versions below do not contain the latest Top Down edits. Save a new version before publishing unless you intentionally need an older snapshot.</p></div><Link className="button button-primary button-inline" href="/">Return to Top Down</Link></div> : null}
        <h3>Top Down saved versions</h3><div className="list-stack">{topDownVersions.slice(0, 6).map((version) => {
          const published = publishedSavedVersion("top_down", version.id, version.checksumSha256, artifacts, publicationReceipts);
          return <div className="list-card" key={version.id}><strong>{version.label}</strong><p>{version.flattenedAppCount} flattened apps · {short(version.checksumSha256)}</p><button className="button button-secondary" type="button" disabled={Boolean(published) || !canPublish} onClick={() => void publish("top-down", version.id)}>{published ? "Published" : "Publish Saved Version"}</button>{published ? <span className="muted-text">Artifact {short(published.artifactId)} · committed</span> : null}</div>;
        })}{topDownVersions.length === 0 ? <p className="muted-text">Save a Top Down version first.</p> : null}</div>
        <h3>Bottom Up saved versions</h3><div className="list-stack">{bottomUpVersions.slice(0, 6).map((version) => {
          const published = publishedSavedVersion("bottom_up", version.id, version.checksumSha256, artifacts, publicationReceipts);
          return <div className="list-card" key={version.id}><strong>{version.label}</strong><p>{version.mappedRowCount} mapped rows · {short(version.checksumSha256)}</p><button className="button button-secondary" type="button" disabled={Boolean(published) || !canPublish} onClick={() => void publish("bottom-up", version.id)}>{published ? "Published" : "Publish Saved Version"}</button>{published ? <span className="muted-text">Artifact {short(published.artifactId)} · committed</span> : null}</div>;
        })}{bottomUpVersions.length === 0 ? <p className="muted-text">Save a Bottom Up version first.</p> : null}</div>
      </div>

      <div className="side-column"><section className="surface-card"><div className="section-heading"><div><h2>Active Full Mapping</h2><p>Scheduled artifact-mode ETL uses this version only.</p></div></div>{activeFull ? <div className="list-card"><strong>{short(activeFull.artifact.id)}</strong><p>{activeFull.artifact.row_count} rows · {short(activeFull.artifact.checksum_sha256)}</p><span>Activated {date(activeFull.activated_at)} by {activeFull.activated_by || "—"}</span></div> : <p className="muted-text">No active Full Mapping is available.</p>}</section></div>
    </section>

    <section className="surface-card">
      <div className="section-heading"><div><h2>2. Generate Apps + Publisher IDs</h2><p>The SensorTower service performs this enrichment asynchronously. Unresolved IDs remain in the downloadable draft and block commit.</p></div></div>
      <div className="settings-grid"><label className="settings-field"><span>Committed raw Top Down</span><select value={rawTopDownArtifactId} onChange={(event) => setRawTopDownArtifactId(event.target.value)} disabled={!readiness?.authenticated || busy || enrichmentIsActive(enrichmentJob)}><option value="">Select committed raw Top Down</option>{committedRawTopDown.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label></div>
      <div className="action-strip"><button className="button button-primary" type="button" disabled={!canPublish || !rawTopDownArtifactId || enrichmentIsActive(enrichmentJob)} onClick={() => void startEnrichment()}>{enrichmentJob?.status === "failed" || enrichmentJob?.status === "interrupted" ? "Generate Again" : "Generate Publisher IDs"}</button></div>
      {enrichmentJob ? <article className={`enrichment-job-card enrichment-job-${enrichmentJob.status}`} aria-live="polite">
        <div className="enrichment-job-heading"><div><p className="field-label">Top Down enrichment job</p><strong>{short(enrichmentJob.id)}</strong></div><span className="enrichment-job-status">{enrichmentJob.status}</span></div>
        <dl className="enrichment-job-details"><div><dt>Source artifact</dt><dd title={enrichmentSourceArtifactId || undefined}>{short(enrichmentSourceArtifactId)}</dd></div><div><dt>Created</dt><dd>{date(enrichmentJob.created_at)}</dd></div><div><dt>Started</dt><dd>{date(enrichmentJob.started_at)}</dd></div><div><dt>Finished</dt><dd>{date(enrichmentJob.finished_at)}</dd></div></dl>
        <div className={`enrichment-progress enrichment-progress-${enrichmentJob.status}`} role="progressbar" aria-label="Apps and Publisher IDs generation progress" aria-valuetext={enrichmentProgressLabel(enrichmentJob.status, enrichmentPollingError ? 1 : 0)} aria-valuemin={enrichmentJob.status === "success" ? 0 : undefined} aria-valuemax={enrichmentJob.status === "success" ? 100 : undefined} aria-valuenow={enrichmentJob.status === "success" ? 100 : undefined} aria-busy={enrichmentIsActive(enrichmentJob)}><span className="enrichment-progress-indicator" /></div>
        {enrichmentJob.error_summary ? <p className="error-text">{enrichmentJob.error_summary}</p> : null}
        {enrichmentPollingError ? <p className="error-text">Status check failed: {enrichmentPollingError}. Reconnecting automatically.</p> : null}
        <div className="action-strip">
          {enrichmentIsActive(enrichmentJob) ? <span className="muted-text">{enrichmentProgressLabel(enrichmentJob.status, enrichmentPollingError ? 1 : 0)}</span> : null}
          {(enrichmentJob.status === "failed" || enrichmentJob.status === "interrupted") ? <button className="button button-primary button-inline" type="button" disabled={!canPublish || !enrichmentSourceArtifactId || enrichmentIsActive(enrichmentJob)} onClick={() => void startEnrichment(enrichmentSourceArtifactId)}>Generate Again</button> : null}
        </div>
      </article> : null}
      {enrichedDraft ? <div className="list-card"><strong>Apps + Publisher IDs {enrichedDraft.status}: {short(enrichedDraft.id)}</strong><p>{enrichedDraft.row_count} rows · unresolved publisher IDs: {enrichedDraft.validation.unresolved_publisher_id_count}</p>{enrichedDraft.validation.blocking_errors.length ? <p className="error-text">Correct the Top Down source, save a new version, publish it, and generate a new draft. {enrichedDraft.validation.blocking_errors.join(" ")}</p> : <p className="muted-text">Validation passed.</p>}<div className="action-strip"><a className="button button-secondary" href={appApiPath(`/api/mapping-artifacts/artifacts/${enrichedDraft.id}/download`)}>Download Draft</a><button className="button button-secondary" type="button" disabled={!canCommit || enrichedDraft.status !== "draft" || enrichedDraft.validation.blocking_errors.length > 0} onClick={() => void commit(enrichedDraft.id)}>Commit Apps + Publisher IDs</button></div></div> : null}
    </section>

    <section className="surface-card"><div className="section-heading"><div><h2>3. Generate and review Full Mapping</h2><p>Select explicit committed inputs. The workbench never chooses the newest artifact automatically.</p></div></div>
      <div className="settings-grid"><label className="settings-field"><span>Committed Apps + Publisher IDs</span><select value={topDownArtifactId} onChange={(event) => setTopDownArtifactId(event.target.value)} disabled={!readiness?.authenticated || busy}><option value="">Select committed enriched Top Down</option>{enrichedTopDown.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label>
      <label className="settings-field"><span>Committed Bottom Up</span><select value={bottomUpArtifactId} onChange={(event) => setBottomUpArtifactId(event.target.value)} disabled={!readiness?.authenticated || busy}><option value="">Select committed Bottom Up</option>{committedBottomUp.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label></div>
      <div className="action-strip"><button className="button button-primary" type="button" disabled={!canPublish || !topDownArtifactId || !bottomUpArtifactId} onClick={() => void generateFull()}>Generate Full Draft</button></div>
      {generatedFull ? <div className="list-card"><strong>Full draft: {short(generatedFull.id)}</strong><p>{generatedFull.row_count} rows · status {generatedFull.status} · checksum {short(generatedFull.checksum_sha256)}</p>{blocking.length ? <p className="error-text">Blocking validation: {blocking.join(" ")}</p> : <p className="muted-text">Validation passed.</p>}<div className="action-strip"><a className="button button-secondary" href={appApiPath(`/api/mapping-artifacts/artifacts/${generatedFull.id}/download`)}>Download Draft</a><button className="button button-secondary" type="button" disabled={!canCommit || generatedFull.status !== "draft" || blocking.length > 0} onClick={() => void commit(generatedFull.id)}>Commit Draft</button><button className="button button-primary" type="button" disabled={!canActivate || generatedFull.status !== "committed" || Boolean(activatingArtifactId)} onClick={() => void activate(generatedFull)}>Activate Full Mapping</button></div></div> : null}
    </section>

    <section className="surface-card">
      <div className="section-heading"><div><h2>4. Committed Full Mapping versions</h2><p>Activate an earlier committed version to roll back future artifact-mode staging runs. Activation never starts a pipeline.</p></div></div>
      {committedFullMappings.length === 0 ? <p className="muted-text">No committed Full Mapping versions are available.</p> : <div className="full-mapping-catalog">{committedFullMappings.map((artifact) => {
        const isActive = isActiveFullArtifact(artifact.id, activeFull);
        const lineage = resolveFullMappingLineage(artifact, artifacts);
        const validationErrors = artifact.validation.blocking_errors;
        const isActivating = activatingArtifactId === artifact.id;
        return <article className={`full-mapping-version-card${isActive ? " full-mapping-version-card-active" : ""}`} key={artifact.id}>
          <div className="full-mapping-version-heading"><div><div className="full-mapping-version-title"><strong>{short(artifact.id)}</strong>{isActive ? <span className="active-artifact-badge">Active</span> : null}{artifact.bootstrap_import ? <span className="bootstrap-artifact-badge">Bootstrap</span> : null}</div><p>{artifact.row_count} rows · checksum {short(artifact.checksum_sha256)}</p></div><div className="action-strip">{canRead ? <a className="button button-secondary button-inline" href={appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/download`)}>Download CSV</a> : null}{isActive ? <span className="active-version-label">Active</span> : <button className="button button-primary button-inline" type="button" disabled={!canActivate || isActivating} onClick={() => void activate(artifact)}>{isActivating ? "Activating…" : "Activate this version"}</button>}</div></div>
          <dl className="full-mapping-metadata"><div><dt>Created</dt><dd>{date(artifact.created_at)} by {artifact.created_by || "—"}</dd></div><div><dt>Committed</dt><dd>{date(artifact.committed_at)} by {artifact.committed_by || "—"}</dd></div><div><dt>Validation</dt><dd>{artifact.validation.valid && validationErrors.length === 0 ? "Passed" : validationErrors.join(" ") || "Validation requires review"}</dd></div><div><dt>Generator</dt><dd>{artifact.generator_version || "—"}{artifact.repository_git_sha ? ` · ${short(artifact.repository_git_sha)}` : ""}</dd></div></dl>
          <div className="full-mapping-lineage"><strong>Source lineage</strong><p><span>Apps + Publisher IDs:</span> {sourceDescription(lineage.enrichedTopDown)}</p><p><span>Bottom Up:</span> {sourceDescription(lineage.bottomUp)}</p></div>
        </article>;
      })}</div>}
    </section>
  </div>;
}
