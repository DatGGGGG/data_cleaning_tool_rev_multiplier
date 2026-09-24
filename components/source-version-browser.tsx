"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import { publishedSavedVersion } from "@/lib/mapping-artifacts/catalog";
import type { MappingArtifact, MappingArtifactReadiness } from "@/lib/mapping-artifacts/types";
import type { SourceVersionBrowserItem, SourceWorkflow } from "@/lib/version-browser";

type Props = { workflow: SourceWorkflow; refreshKey?: number };
type CatalogResponse = { artifacts: MappingArtifact[] };
type VersionResponse = { versions: SourceVersionBrowserItem[] };

function short(value: string) { return value.length > 12 ? `${value.slice(0, 12)}…` : value; }
function workflowLabel(workflow: SourceWorkflow) { return workflow === "top_down" ? "Top Down" : "Bottom Up"; }
function workflowApiName(workflow: SourceWorkflow) { return workflow === "top_down" ? "top-down" : "bottom-up"; }

export function SourceVersionBrowser({ workflow, refreshKey = 0 }: Props) {
  const [versions, setVersions] = useState<SourceVersionBrowserItem[]>([]);
  const [artifacts, setArtifacts] = useState<MappingArtifact[]>([]);
  const [readiness, setReadiness] = useState<MappingArtifactReadiness | null>(null);
  const [message, setMessage] = useState("Loading saved versions…");
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const pageCount = Math.max(1, Math.ceil(versions.length / pageSize));
  const visibleVersions = useMemo(() => versions.slice((page - 1) * pageSize, page * pageSize), [page, versions]);

  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);

  async function parse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "Request failed.");
    return payload;
  }

  async function refresh() {
    const [versionsResponse, readinessResponse] = await Promise.all([
      fetch(appApiPath(`/api/version-browser/${workflowApiName(workflow)}`), { cache: "no-store" }),
      fetch(appApiPath("/api/mapping-artifacts/readiness"), { cache: "no-store" }),
    ]);
    const versionPayload = await parse<VersionResponse>(versionsResponse);
    const nextReadiness = await parse<MappingArtifactReadiness>(readinessResponse);
    setVersions(versionPayload.versions);
    setReadiness(nextReadiness);
    setMessage(versionPayload.versions.length ? `${versionPayload.versions.length} saved ${workflowLabel(workflow)} versions.` : `No ${workflowLabel(workflow)} versions saved yet.`);

    if (!nextReadiness.authenticated || !nextReadiness.upstreamConfigured) return;
    const catalogResponse = await fetch(appApiPath("/api/mapping-artifacts/catalog?status=committed"), { cache: "no-store" });
    const catalog = await parse<CatalogResponse>(catalogResponse);
    setArtifacts(catalog.artifacts);
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load saved versions.")); }, [workflow, refreshKey]);

  async function publish(version: SourceVersionBrowserItem) {
    setBusyVersionId(version.id);
    try {
      const response = await fetch(appApiPath(`/api/mapping-artifacts/publish/${workflowApiName(workflow)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });
      const payload = await parse<{ artifact: MappingArtifact }>(response);
      setArtifacts((current) => [payload.artifact, ...current.filter((item) => item.id !== payload.artifact.id)]);
      setMessage(`Published ${version.label} as artifact ${short(payload.artifact.id)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not publish this saved version.");
    } finally {
      setBusyVersionId(null);
    }
  }

  const title = `Saved ${workflowLabel(workflow)} Versions`;
  return <section className="surface-card source-version-browser" id={`${workflowApiName(workflow)}-versions`}>
    <div className="section-heading">
      <div><h2>{title}</h2><p>Immutable snapshots used for publishing and traceability.</p></div>
      <button type="button" className="button button-secondary button-inline" onClick={() => void refresh()} disabled={Boolean(busyVersionId)}>Refresh</button>
    </div>
    <p className="muted-text">{message}</p>
    {visibleVersions.length === 0 ? <p className="muted-text">Save a version from this workflow to browse it here.</p> : <div className="source-version-list">
      {visibleVersions.map((version) => {
        const published = publishedSavedVersion(workflow, version.id, version.checksumSha256, artifacts);
        const canPublish = Boolean(readiness?.canPublish) && !busyVersionId;
        const apiName = workflowApiName(workflow);
        return <article className="source-version-card" key={version.id}>
          <div className="source-version-card-heading"><div><strong>{version.label}</strong><p>{new Date(version.createdAt).toLocaleString()} · {version.createdBy}</p></div>{published ? <span className="active-version-label">Published</span> : null}</div>
          <p>{version.rowCount} {version.rowLabel} · {version.secondarySummary} · checksum {short(version.checksumSha256)}</p>
          <div className="action-strip">
            <Link className="button button-secondary button-inline" href={`/${apiName}/versions/${version.id}`}>View</Link>
            <a className="button button-secondary button-inline" href={appApiPath(`/api/version-browser/${apiName}/${version.id}/download`)}>Download CSV</a>
            <button className="button button-secondary button-inline" type="button" disabled={Boolean(published) || !canPublish} onClick={() => void publish(version)}>{published ? "Published" : busyVersionId === version.id ? "Publishing…" : "Publish Saved Version"}</button>
            {published ? <span className="muted-text">Artifact {short(published.artifactId)} · committed</span> : null}
          </div>
        </article>;
      })}
    </div>}
    {versions.length > pageSize ? <div className="pager-cluster source-version-pager"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" className="button button-secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div> : null}
  </section>;
}
