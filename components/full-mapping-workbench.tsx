"use client";

import { useEffect, useMemo, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import type { BottomUpVersionMetadata } from "@/lib/bottom-up/types";
import type { TopDownVersionMetadata } from "@/lib/top-down/types";
import type { MappingArtifact, MappingArtifactJob, MappingArtifactReadiness } from "@/lib/mapping-artifacts/types";

type Props = { topDownVersions: TopDownVersionMetadata[]; bottomUpVersions: BottomUpVersionMetadata[] };
type CatalogResponse = { artifacts: MappingArtifact[] };
type ActiveResponse = { active: Record<string, { artifact: MappingArtifact }> };

function short(value: string) { return value.length > 12 ? `${value.slice(0, 12)}…` : value; }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export function FullMappingWorkbench({ topDownVersions, bottomUpVersions }: Props) {
  const [readiness, setReadiness] = useState<MappingArtifactReadiness | null>(null);
  const [artifacts, setArtifacts] = useState<MappingArtifact[]>([]);
  const [activeFull, setActiveFull] = useState<MappingArtifact | null>(null);
  const [topDownArtifactId, setTopDownArtifactId] = useState("");
  const [bottomUpArtifactId, setBottomUpArtifactId] = useState("");
  const [rawTopDownArtifactId, setRawTopDownArtifactId] = useState("");
  const [enrichmentJob, setEnrichmentJob] = useState<MappingArtifactJob | null>(null);
  const [enrichedDraft, setEnrichedDraft] = useState<MappingArtifact | null>(null);
  const [generatedFull, setGeneratedFull] = useState<MappingArtifact | null>(null);
  const [message, setMessage] = useState("Checking Mapping Artifact readiness…");
  const [busy, setBusy] = useState(false);

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

  async function parse(response: Response) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; artifact?: MappingArtifact };
    if (!response.ok) throw new Error(payload.error?.message || "Request failed.");
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
    const active = await parse(activeResponse) as ActiveResponse;
    setArtifacts(catalog.artifacts);
    setActiveFull(active.active.full?.artifact ?? null);
  }

  useEffect(() => { void refreshRemote().catch((error) => setMessage(error instanceof Error ? error.message : "Failed to check readiness.")); }, []);

  useEffect(() => {
    if (!enrichmentJob || (enrichmentJob.status !== "queued" && enrichmentJob.status !== "running")) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(appApiPath(`/api/mapping-artifacts/jobs/${enrichmentJob.id}`), { cache: "no-store" });
        const payload = await parse(response) as { job: MappingArtifactJob };
        setEnrichmentJob(payload.job);
        if (payload.job.status === "success" && payload.job.result_artifact_id) {
          const detailResponse = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${payload.job.result_artifact_id}`), { cache: "no-store" });
          const detail = await parse(detailResponse) as { artifact: MappingArtifact };
          setEnrichedDraft(detail.artifact);
          setMessage("Apps + Publisher IDs draft is ready for review.");
          await refreshRemote();
        }
      } catch (error) { setMessage(error instanceof Error ? error.message : "Could not refresh enrichment status."); }
    }, enrichmentJob.status === "queued" ? 2_000 : 5_000);
    return () => window.clearTimeout(timer);
  }, [enrichmentJob]);

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

  async function startEnrichment() {
    const source = committedRawTopDown.find((item) => item.id === rawTopDownArtifactId);
    if (!source) return;
    setBusy(true);
    try {
      const response = await fetch(appApiPath("/api/mapping-artifacts/generate/top-down-publisher-ids"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceArtifactId: source.id, localTopDownVersionId: source.source_workbench_version_id || "" }),
      });
      const payload = await parse(response) as { job_id: string; status: MappingArtifactJob["status"] };
      setEnrichmentJob({ id: payload.job_id, job_type: "top_down_publisher_ids", status: payload.status, result_artifact_id: null, error_code: null, error_summary: null, created_at: new Date().toISOString(), started_at: null, finished_at: null });
      setMessage("Top Down enrichment was queued. This page will poll its durable job status.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start Top Down enrichment."); }
    finally { setBusy(false); }
  }

  async function commit(artifactId: string) {
    setBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}/commit`), { method: "POST" });
      const payload = await parse(response);
      setGeneratedFull(payload.artifact ?? null);
      setMessage("Committed immutable Full Mapping artifact.");
      await refreshRemote();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not commit artifact."); }
    finally { setBusy(false); }
  }

  async function activate(artifactId: string) {
    if (!window.confirm("Activate this Full Mapping for the next SensorTower artifact-mode staging run?")) return;
    setBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}/activate`), { method: "POST" });
      await parse(response);
      setMessage("Activated Full Mapping artifact.");
      await refreshRemote();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not activate artifact."); }
    finally { setBusy(false); }
  }

  const canPublish = Boolean(readiness?.canPublish && !busy);
  const canCommit = Boolean(readiness?.canCommit && !busy);
  const canActivate = Boolean(readiness?.canActivate && !busy);
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
        <h3>Top Down saved versions</h3><div className="list-stack">{topDownVersions.slice(0, 6).map((version) => <div className="list-card" key={version.id}><strong>{version.label}</strong><p>{version.flattenedAppCount} flattened apps · {short(version.checksumSha256)}</p><button className="button button-secondary" type="button" disabled={!canPublish} onClick={() => void publish("top-down", version.id)}>Publish Saved Version</button></div>)}{topDownVersions.length === 0 ? <p className="muted-text">Save a Top Down version first.</p> : null}</div>
        <h3>Bottom Up saved versions</h3><div className="list-stack">{bottomUpVersions.slice(0, 6).map((version) => <div className="list-card" key={version.id}><strong>{version.label}</strong><p>{version.mappedRowCount} mapped rows · {short(version.checksumSha256)}</p><button className="button button-secondary" type="button" disabled={!canPublish} onClick={() => void publish("bottom-up", version.id)}>Publish Saved Version</button></div>)}{bottomUpVersions.length === 0 ? <p className="muted-text">Save a Bottom Up version first.</p> : null}</div>
      </div>

      <div className="side-column"><section className="surface-card"><div className="section-heading"><div><h2>Active Full Mapping</h2><p>Scheduled artifact-mode ETL uses this version only.</p></div></div>{activeFull ? <div className="list-card"><strong>{short(activeFull.id)}</strong><p>{activeFull.row_count} rows · {short(activeFull.checksum_sha256)}</p><span>Created {date(activeFull.created_at)}</span></div> : <p className="muted-text">No active Full Mapping is available.</p>}</section></div>
    </section>

    <section className="surface-card"><div className="section-heading"><div><h2>2. Generate Apps + Publisher IDs</h2><p>The SensorTower service performs this enrichment asynchronously. Unresolved IDs remain in the downloadable draft and block commit.</p></div></div>
      <div className="settings-grid"><label className="settings-field"><span>Committed raw Top Down</span><select value={rawTopDownArtifactId} onChange={(event) => setRawTopDownArtifactId(event.target.value)} disabled={!readiness?.authenticated || busy}><option value="">Select committed raw Top Down</option>{committedRawTopDown.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label></div>
      <div className="action-strip"><button className="button button-primary" type="button" disabled={!canPublish || !rawTopDownArtifactId || Boolean(enrichmentJob && (enrichmentJob.status === "queued" || enrichmentJob.status === "running"))} onClick={() => void startEnrichment()}>Generate Publisher IDs</button>{enrichmentJob ? <span className="status-inline">Job {short(enrichmentJob.id)}: {enrichmentJob.status}{enrichmentJob.error_summary ? ` — ${enrichmentJob.error_summary}` : ""}</span> : null}</div>
      {enrichedDraft ? <div className="list-card"><strong>Apps + Publisher IDs draft: {short(enrichedDraft.id)}</strong><p>{enrichedDraft.row_count} rows · unresolved publisher IDs: {enrichedDraft.validation.unresolved_publisher_id_count}</p>{enrichedDraft.validation.blocking_errors.length ? <p className="error-text">Correct the Top Down source, save a new version, publish it, and generate a new draft. {enrichedDraft.validation.blocking_errors.join(" ")}</p> : <p className="muted-text">Validation passed.</p>}<div className="action-strip"><a className="button button-secondary" href={appApiPath(`/api/mapping-artifacts/artifacts/${enrichedDraft.id}/download`)}>Download Draft</a><button className="button button-secondary" type="button" disabled={!canCommit || enrichedDraft.status !== "draft" || enrichedDraft.validation.blocking_errors.length > 0} onClick={() => void commit(enrichedDraft.id)}>Commit Apps + Publisher IDs</button></div></div> : null}
    </section>

    <section className="surface-card"><div className="section-heading"><div><h2>3. Generate and review Full Mapping</h2><p>Select explicit committed inputs. The workbench never chooses the newest artifact automatically.</p></div></div>
      <div className="settings-grid"><label className="settings-field"><span>Committed Apps + Publisher IDs</span><select value={topDownArtifactId} onChange={(event) => setTopDownArtifactId(event.target.value)} disabled={!readiness?.authenticated || busy}><option value="">Select committed enriched Top Down</option>{enrichedTopDown.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label>
      <label className="settings-field"><span>Committed Bottom Up</span><select value={bottomUpArtifactId} onChange={(event) => setBottomUpArtifactId(event.target.value)} disabled={!readiness?.authenticated || busy}><option value="">Select committed Bottom Up</option>{committedBottomUp.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label></div>
      <div className="action-strip"><button className="button button-primary" type="button" disabled={!canPublish || !topDownArtifactId || !bottomUpArtifactId} onClick={() => void generateFull()}>Generate Full Draft</button></div>
      {generatedFull ? <div className="list-card"><strong>Full draft: {short(generatedFull.id)}</strong><p>{generatedFull.row_count} rows · status {generatedFull.status} · checksum {short(generatedFull.checksum_sha256)}</p>{blocking.length ? <p className="error-text">Blocking validation: {blocking.join(" ")}</p> : <p className="muted-text">Validation passed.</p>}<div className="action-strip"><a className="button button-secondary" href={appApiPath(`/api/mapping-artifacts/artifacts/${generatedFull.id}/download`)}>Download Draft</a><button className="button button-secondary" type="button" disabled={!canCommit || generatedFull.status !== "draft" || blocking.length > 0} onClick={() => void commit(generatedFull.id)}>Commit Draft</button><button className="button button-primary" type="button" disabled={!canActivate || generatedFull.status !== "committed"} onClick={() => void activate(generatedFull.id)}>Activate Full Mapping</button></div></div> : null}
    </section>
  </div>;
}
