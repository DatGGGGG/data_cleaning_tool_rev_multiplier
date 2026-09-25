"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import { activeFullEntry, activationConfirmationMessage, isActiveFullArtifact, resolveFullMappingLineage } from "@/lib/mapping-artifacts/catalog";
import type { MappingArtifact, MappingArtifactActivationResponse, MappingArtifactActiveResponse, MappingArtifactActiveState, MappingArtifactReadiness } from "@/lib/mapping-artifacts/types";

type CatalogResponse = { artifacts: MappingArtifact[] };

function short(value: string | null | undefined) { return value ? (value.length > 12 ? `${value.slice(0, 12)}…` : value) : "—"; }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

function commitDisabledReason(artifact: MappingArtifact, readiness: MappingArtifactReadiness | null, busy: boolean) {
  if (artifact.status !== "draft") return "This Full Mapping version is already committed.";
  if (artifact.validation.blocking_errors.length) return artifact.validation.blocking_errors.join(" ");
  if (!readiness?.canCommit) return "Your workbench role cannot commit Full Mapping drafts, or the artifact service is not ready.";
  if (busy) return "Another Full Mapping action is in progress.";
  return null;
}

function activationDisabledReason(
  artifact: MappingArtifact,
  readiness: MappingArtifactReadiness | null,
  isActive: boolean,
  activating: boolean,
) {
  if (isActive) return "This is already the active Full Mapping.";
  if (artifact.status !== "committed") return "Commit a valid Full Mapping draft before activating it.";
  if (!readiness?.canActivate) return "Only an authenticated admin can activate a Full Mapping.";
  if (activating) return "Another Full Mapping activation is in progress.";
  return null;
}

export function FullMappingOnlyWorkbench() {
  const [readiness, setReadiness] = useState<MappingArtifactReadiness | null>(null);
  const [artifacts, setArtifacts] = useState<MappingArtifact[]>([]);
  const [activeState, setActiveState] = useState<MappingArtifactActiveState | null>(null);
  const [enrichedTopDownId, setEnrichedTopDownId] = useState("");
  const [bottomUpId, setBottomUpId] = useState("");
  const [message, setMessage] = useState("Checking Full Mapping readiness…");
  const [busy, setBusy] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const enrichedTopDown = useMemo(() => artifacts.filter((item) => item.artifact_type === "top_down_with_publisher_ids" && item.status === "committed"), [artifacts]);
  const committedBottomUp = useMemo(() => artifacts.filter((item) => item.artifact_type === "bottom_up" && item.status === "committed"), [artifacts]);
  const fullVersions = useMemo(() => artifacts.filter((item) => item.artifact_type === "full").sort((left, right) => right.created_at.localeCompare(left.created_at)), [artifacts]);
  const activeFull = activeFullEntry(activeState);
  const selectedTopDown = enrichedTopDown.find((item) => item.id === enrichedTopDownId) ?? null;
  const selectedBottomUp = committedBottomUp.find((item) => item.id === bottomUpId) ?? null;
  const canGenerate = Boolean(readiness?.canPublish && !busy);
  const canCommit = Boolean(readiness?.canCommit && !busy);
  const canActivate = Boolean(readiness?.canActivate);

  async function parse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new Error(payload.error?.code ? `${payload.error.code}: ${payload.error.message || "Request failed."}` : payload.error?.message || "Request failed.");
    return payload;
  }

  async function refresh() {
    const readinessResponse = await fetch(appApiPath("/api/mapping-artifacts/readiness"), { cache: "no-store" });
    const nextReadiness = await parse<MappingArtifactReadiness>(readinessResponse);
    setReadiness(nextReadiness);
    setMessage(nextReadiness.message);
    if (!nextReadiness.authenticated) return;
    const [catalogResponse, activeResponse] = await Promise.all([
      fetch(appApiPath("/api/mapping-artifacts/catalog"), { cache: "no-store" }),
      fetch(appApiPath("/api/mapping-artifacts/active"), { cache: "no-store" }),
    ]);
    const catalog = await parse<CatalogResponse>(catalogResponse);
    const active = await parse<MappingArtifactActiveResponse>(activeResponse);
    setArtifacts(catalog.artifacts);
    setActiveState(active.active);
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load Full Mapping artifacts.")); }, []);

  async function generate() {
    if (!enrichedTopDownId || !bottomUpId) return;
    setBusy(true);
    try {
      const response = await fetch(appApiPath("/api/mapping-artifacts/generate/full"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topDownArtifactId: enrichedTopDownId, bottomUpArtifactId: bottomUpId }),
      });
      const payload = await parse<{ artifact: MappingArtifact }>(response);
      setArtifacts((current) => [payload.artifact, ...current.filter((item) => item.id !== payload.artifact.id)]);
      setMessage(`Generated Full Mapping draft ${short(payload.artifact.id)}. Review it below before committing.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate Full Mapping.");
    } finally { setBusy(false); }
  }

  async function commit(artifactId: string) {
    setBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}/commit`), { method: "POST" });
      const payload = await parse<{ artifact: MappingArtifact }>(response);
      setArtifacts((current) => current.map((item) => item.id === artifactId ? payload.artifact : item));
      setMessage(`Committed Full Mapping artifact ${short(artifactId)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not commit Full Mapping artifact.");
    } finally { setBusy(false); }
  }

  async function activate(artifact: MappingArtifact) {
    if (!window.confirm(activationConfirmationMessage(artifact, activeFull, artifacts))) return;
    setActivatingId(artifact.id);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/activate`), { method: "POST" });
      const payload = await parse<MappingArtifactActivationResponse>(response);
      setActiveState(payload.active);
      setMessage(`Activated Full Mapping artifact ${short(artifact.id)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not activate Full Mapping artifact.");
    } finally { setActivatingId(null); }
  }

  return <div className="workspace-page">
    <section className="page-banner"><div><p className="page-kicker">Mapping Artifact Workflow</p><h1>Full Mapping</h1><p className="page-summary">Combine explicit committed Apps + Publisher IDs and Bottom Up inputs, then review, commit and activate the final mapping.</p></div></section>
    <section className="surface-card"><div className="section-heading"><div><h2>Service readiness</h2><p>{message}</p></div><button type="button" className="button button-secondary" disabled={busy} onClick={() => void refresh()}>Refresh</button></div></section>
    <section className="surface-card"><div className="section-heading"><div><h2>Active Full Mapping</h2><p>Scheduled artifact-mode ETL uses this committed version only.</p></div></div>{activeFull ? <div className="list-card"><strong>{short(activeFull.artifact.id)}</strong><p>{activeFull.artifact.row_count} rows · checksum {short(activeFull.artifact.checksum_sha256)}</p><span>Activated {date(activeFull.activated_at)} by {activeFull.activated_by || "—"}</span></div> : <p className="muted-text">No active Full Mapping is available.</p>}</section>
    <section className="surface-card"><div className="section-heading"><div><h2>1. Generate Full Mapping</h2><p>Select explicit committed inputs. The workbench never automatically chooses the newest version.</p></div></div><div className="settings-grid"><label className="settings-field"><span>Committed Apps + Publisher IDs</span><select value={enrichedTopDownId} onChange={(event) => setEnrichedTopDownId(event.target.value)} disabled={!readiness?.authenticated || busy}><option value="">Select committed Apps + Publisher IDs</option>{enrichedTopDown.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label><label className="settings-field"><span>Committed Bottom Up</span><select value={bottomUpId} onChange={(event) => setBottomUpId(event.target.value)} disabled={!readiness?.authenticated || busy}><option value="">Select committed Bottom Up</option>{committedBottomUp.map((item) => <option key={item.id} value={item.id}>{short(item.id)} · {item.row_count} rows · {short(item.checksum_sha256)}</option>)}</select></label></div>{selectedTopDown || selectedBottomUp ? <div className="selected-input-summary"><span>Apps + Publisher IDs: {selectedTopDown ? <Link href={`/artifact-registry/${selectedTopDown.id}`}>{short(selectedTopDown.id)} · {selectedTopDown.row_count} rows</Link> : "not selected"}</span><span>Bottom Up: {selectedBottomUp ? <Link href={`/artifact-registry/${selectedBottomUp.id}`}>{short(selectedBottomUp.id)} · {selectedBottomUp.row_count} rows</Link> : "not selected"}</span></div> : null}<div className="action-strip"><button className="button button-primary" type="button" disabled={!canGenerate || !enrichedTopDownId || !bottomUpId} onClick={() => void generate()}>Generate Full Draft</button></div></section>
    <section className="surface-card"><div className="section-heading"><div><h2>2. Full Mapping versions</h2><p>Review every draft and committed output here. Activation affects future staging runs only.</p></div></div>{fullVersions.length === 0 ? <p className="muted-text">No Full Mapping versions are available yet.</p> : <div className="full-mapping-catalog">{fullVersions.map((artifact) => { const isActive = isActiveFullArtifact(artifact.id, activeFull); const lineage = resolveFullMappingLineage(artifact, artifacts); const commitReason = commitDisabledReason(artifact, readiness, busy); const activateReason = activationDisabledReason(artifact, readiness, isActive, Boolean(activatingId)); return <article className={`full-mapping-version-card${isActive ? " full-mapping-version-card-active" : ""}`} key={artifact.id}><div className="full-mapping-version-heading"><div><div className="full-mapping-version-title"><strong>{short(artifact.id)}</strong><span className={artifact.status === "committed" ? "active-version-label" : "bootstrap-artifact-badge"}>{artifact.status}</span>{isActive ? <span className="active-artifact-badge">Active</span> : null}</div><p>{artifact.row_count} rows · checksum {short(artifact.checksum_sha256)}</p></div><div className="action-strip"><Link className="button button-secondary button-inline" href={`/artifact-registry/${artifact.id}`}>View</Link><a className="button button-secondary button-inline" href={appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/download`)}>Download CSV</a><button className="button button-secondary button-inline" type="button" title={commitReason ?? undefined} disabled={Boolean(commitReason)} onClick={() => void commit(artifact.id)}>{artifact.status === "committed" ? "Committed" : "Commit Draft"}</button>{isActive ? <span className="active-version-label">Active</span> : <button className="button button-primary button-inline" type="button" title={activateReason ?? undefined} disabled={Boolean(activateReason)} onClick={() => void activate(artifact)}>{activatingId === artifact.id ? "Activating…" : "Activate"}</button>}</div></div>{commitReason && artifact.status === "draft" ? <p className="error-text full-mapping-action-reason">Commit blocked: {commitReason}</p> : null}{activateReason && !isActive ? <p className="muted-text full-mapping-action-reason">Activation: {activateReason}</p> : null}<dl className="full-mapping-metadata"><div><dt>Created</dt><dd>{date(artifact.created_at)} by {artifact.created_by || "—"}</dd></div><div><dt>Committed</dt><dd>{date(artifact.committed_at)} by {artifact.committed_by || "—"}</dd></div><div><dt>Validation</dt><dd>{artifact.validation.valid ? "Passed" : artifact.validation.blocking_errors.join(" ") || "Requires review"}</dd></div><div><dt>Lineage</dt><dd>Apps + Publisher IDs {short(lineage.enrichedTopDown.id)} · Bottom Up {short(lineage.bottomUp.id)}</dd></div></dl></article>; })}</div>}</section>
  </div>;
}
