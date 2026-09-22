"use client";

import { useEffect, useMemo, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import {
  MAPPING_ARTIFACT_TYPES,
  activationConfirmationMessage,
  activeFullEntry,
  artifactCounts,
  artifactTypeLabel,
  artifactValidationLabel,
  canActivateCommittedFull,
  filterCommittedArtifacts,
  isActiveFullArtifact,
  publicArtifactDetails,
  resolveArtifactLineage,
} from "@/lib/mapping-artifacts/catalog";
import type {
  CatalogArtifactType,
} from "@/lib/mapping-artifacts/catalog";
import type {
  MappingArtifact,
  MappingArtifactActivationResponse,
  MappingArtifactActiveResponse,
  MappingArtifactActiveState,
  MappingArtifactReadiness,
} from "@/lib/mapping-artifacts/types";

type CatalogResponse = { artifacts: MappingArtifact[] };

function short(value: string) { return value.length > 12 ? `${value.slice(0, 12)}…` : value; }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export function MappingArtifactRegistry() {
  const [readiness, setReadiness] = useState<MappingArtifactReadiness | null>(null);
  const [artifacts, setArtifacts] = useState<MappingArtifact[]>([]);
  const [activeState, setActiveState] = useState<MappingArtifactActiveState | null>(null);
  const [typeFilter, setTypeFilter] = useState<CatalogArtifactType | "all">("all");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Loading committed Mapping Artifacts…");
  const [activatingArtifactId, setActivatingArtifactId] = useState<string | null>(null);
  const [expandedArtifactIds, setExpandedArtifactIds] = useState<Set<string>>(() => new Set());

  const activeFull = activeFullEntry(activeState);
  const counts = useMemo(() => artifactCounts(artifacts), [artifacts]);
  const visibleArtifacts = useMemo(() => filterCommittedArtifacts(artifacts, { type: typeFilter, search }), [artifacts, search, typeFilter]);
  const canRead = Boolean(readiness?.authenticated);
  const canActivate = Boolean(readiness?.canActivate);

  async function parse(response: Response) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      const message = payload.error?.message || "Request failed.";
      throw new Error(payload.error?.code ? `${payload.error.code}: ${message}` : message);
    }
    return payload;
  }

  async function refresh() {
    const readinessResponse = await fetch(appApiPath("/api/mapping-artifacts/readiness"), { cache: "no-store" });
    const nextReadiness = await parse(readinessResponse) as MappingArtifactReadiness;
    setReadiness(nextReadiness);
    if (!nextReadiness.authenticated) {
      setMessage(nextReadiness.message);
      return;
    }
    const [catalogResponse, activeResponse] = await Promise.all([
      fetch(appApiPath("/api/mapping-artifacts/catalog?status=committed"), { cache: "no-store" }),
      fetch(appApiPath("/api/mapping-artifacts/active"), { cache: "no-store" }),
    ]);
    const catalog = await parse(catalogResponse) as CatalogResponse;
    const active = await parse(activeResponse) as MappingArtifactActiveResponse;
    setArtifacts(catalog.artifacts);
    setActiveState(active.active);
    setMessage("Committed Mapping Artifact registry is up to date.");
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load the Artifact Registry.")); }, []);

  function toggleDetails(artifactId: string, open: boolean) {
    setExpandedArtifactIds((current) => {
      const next = new Set(current);
      if (open) next.add(artifactId);
      else next.delete(artifactId);
      return next;
    });
  }

  function openArtifactDetails(artifactId: string) {
    setExpandedArtifactIds((current) => new Set(current).add(artifactId));
    window.setTimeout(() => document.getElementById(`mapping-artifact-${artifactId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }

  async function activate(artifact: MappingArtifact) {
    if (!canActivateCommittedFull(artifact, activeFull, canActivate)) return;
    if (!window.confirm(activationConfirmationMessage(artifact, activeFull, artifacts))) return;
    setActivatingArtifactId(artifact.id);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/activate`), { method: "POST" });
      const payload = await parse(response) as MappingArtifactActivationResponse;
      if (typeof payload.status !== "string" || !payload.active) throw new Error("The pipeline returned an invalid activation response.");
      await refresh();
      setMessage(`Activated Full Mapping artifact ${short(artifact.id)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not activate Full Mapping artifact.");
    } finally {
      setActivatingArtifactId(null);
    }
  }

  return <div className="workspace-page">
    <section className="page-banner">
      <div><p className="page-kicker">Mapping Artifact Registry</p><h1>Committed Mapping Artifacts</h1><p className="page-summary">Browse immutable committed mapping inputs and outputs. Files remain in the SensorTower pipeline; this registry never exposes internal storage paths.</p></div>
      <div className="banner-pill-stack"><span className="metric-pill">{visibleArtifacts.length} shown</span><span className="metric-pill">{activeFull ? "Full Mapping active" : "No active Full Mapping"}</span></div>
    </section>

    <section className="surface-card"><div className="section-heading"><div><h2>Registry status</h2><p>{message}</p></div><button type="button" className="button button-secondary" onClick={() => void refresh()} disabled={Boolean(activatingArtifactId)}>Refresh</button></div>
      {!readiness?.authenticated ? <p className="muted-text">A verified workbench session is required to view artifact metadata or downloads.</p> : null}
    </section>

    <section className="artifact-summary-grid" aria-label="Committed artifact counts">
      {MAPPING_ARTIFACT_TYPES.map((type) => <div className="metric-card" key={type}><span>{artifactTypeLabel(type)}</span><strong>{counts[type]}</strong></div>)}
      <div className="metric-card artifact-active-summary"><span>Active Full Mapping</span><strong>{activeFull ? short(activeFull.artifact.id) : "None"}</strong><small>{activeFull ? `${activeFull.artifact.row_count} rows · activated ${date(activeFull.activated_at)}` : "Activate a committed Full Mapping as an admin."}</small></div>
    </section>

    <section className="surface-card">
      <div className="registry-filter-bar"><label className="settings-field"><span>Artifact type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as CatalogArtifactType | "all")}><option value="all">All committed types</option>{MAPPING_ARTIFACT_TYPES.map((type) => <option value={type} key={type}>{artifactTypeLabel(type)}</option>)}</select></label><label className="settings-field registry-search-field"><span>Search committed artifacts</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ID, filename, checksum, actor, source, lineage…" /></label></div>
      <p className="muted-text">Search includes artifact IDs, filenames, checksums, creators/committers, workbench source/version, and recorded lineage IDs.</p>
    </section>

    <section className="surface-card">
      <div className="section-heading"><div><h2>Committed artifacts</h2><p>Newest committed artifacts appear first. Drafts and internal filesystem paths are intentionally excluded.</p></div></div>
      {visibleArtifacts.length === 0 ? <p className="muted-text">No committed artifacts match the current filters.</p> : <div className="artifact-registry-list">{visibleArtifacts.map((artifact) => {
        const active = artifact.artifact_type === "full" && isActiveFullArtifact(artifact.id, activeFull);
        const lineage = resolveArtifactLineage(artifact, artifacts);
        const details = publicArtifactDetails(artifact);
        const canActivateThis = canActivateCommittedFull(artifact, activeFull, canActivate);
        const isActivating = activatingArtifactId === artifact.id;
        return <article className={`artifact-registry-card${active ? " artifact-registry-card-active" : ""}`} id={`mapping-artifact-${artifact.id}`} key={artifact.id}>
          <div className="artifact-registry-card-heading"><div><div className="artifact-registry-title"><span className="artifact-type-pill">{artifactTypeLabel(artifact.artifact_type)}</span>{active ? <span className="active-artifact-badge">Active</span> : null}{artifact.bootstrap_import ? <span className="bootstrap-artifact-badge">Bootstrap</span> : null}</div><strong>{artifact.id}</strong><p>{artifact.status} · {artifact.row_count} rows · checksum {short(artifact.checksum_sha256)}</p></div><div className="action-strip">{canRead ? <a className="button button-secondary button-inline" href={appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/download`)}>Download CSV</a> : null}{active ? <span className="active-version-label">Active</span> : canActivateThis ? <button className="button button-primary button-inline" type="button" disabled={isActivating} onClick={() => void activate(artifact)}>{isActivating ? "Activating…" : "Activate Full Mapping"}</button> : null}</div></div>
          <dl className="artifact-registry-metadata"><div><dt>Created</dt><dd>{date(details.createdAt)} by {details.createdBy || "—"}</dd></div><div><dt>Committed</dt><dd>{date(details.committedAt)} by {details.committedBy || "—"}</dd></div><div><dt>Validation</dt><dd>{artifactValidationLabel(artifact)}</dd></div><div><dt>Source</dt><dd>{details.sourceWorkflow || "—"}{details.sourceVersionLabel ? ` · ${details.sourceVersionLabel}` : ""}</dd></div></dl>
          <div className="artifact-registry-lineage"><strong>Source lineage</strong>{lineage.length ? <ul>{lineage.map((source) => <li key={source.id}>{source.artifact ? <button type="button" className="artifact-lineage-link" onClick={() => openArtifactDetails(source.id)}>{source.id}</button> : <code>{source.id}</code>}{source.checksum ? <span> · {short(source.checksum)}</span> : null}{source.artifact ? <span> · {artifactTypeLabel(source.artifact.artifact_type)}</span> : <span> · recorded lineage</span>}</li>)}</ul> : <p>No source artifacts recorded.</p>}</div>
          <details className="artifact-registry-details" open={expandedArtifactIds.has(artifact.id)} onToggle={(event) => toggleDetails(artifact.id, event.currentTarget.open)}><summary>Show metadata and validation details</summary><dl><div><dt>Canonical filename</dt><dd>{details.canonicalFilename}</dd></div><div><dt>Schema version</dt><dd>{details.schemaVersion}</dd></div><div><dt>Checksum</dt><dd>{details.checksum}</dd></div><div><dt>Workbench source version</dt><dd>{details.sourceVersionId || "—"}</dd></div><div><dt>Generator / repository</dt><dd>{details.generatorVersion || "—"}{details.repositoryGitSha ? ` · ${details.repositoryGitSha}` : ""}</dd></div><div><dt>Bootstrap import</dt><dd>{details.bootstrapImport ? "Yes" : "No"}</dd></div><div><dt>Required columns</dt><dd>{details.validation.required_columns.join(", ") || "—"}</dd></div><div><dt>Missing values</dt><dd>{Object.keys(details.validation.missing_value_counts).length ? Object.entries(details.validation.missing_value_counts).map(([field, count]) => `${field}: ${count}`).join(", ") : "None"}</dd></div><div><dt>Blocking errors</dt><dd>{details.validation.blocking_errors.join(" ") || "None"}</dd></div><div><dt>Recorded source checksums</dt><dd>{Object.entries(details.sourceArtifactChecksums).map(([id, checksum]) => `${id}: ${checksum}`).join("; ") || "—"}</dd></div></dl></details>
        </article>;
      })}</div>}
    </section>
  </div>;
}
