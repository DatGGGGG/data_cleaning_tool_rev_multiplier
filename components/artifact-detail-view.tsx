"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import { artifactTypeLabel, publicArtifactDetails, resolveArtifactLineage } from "@/lib/mapping-artifacts/catalog";
import type { MappingArtifact, MappingArtifactCsvPreview } from "@/lib/mapping-artifacts/types";

function short(value: string | null | undefined) { return value ? (value.length > 12 ? `${value.slice(0, 12)}…` : value) : "—"; }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }

export function ArtifactDetailView({ artifactId }: { artifactId: string }) {
  const [preview, setPreview] = useState<MappingArtifactCsvPreview | null>(null);
  const [catalog, setCatalog] = useState<MappingArtifact[]>([]);
  const [message, setMessage] = useState("Loading artifact version…");
  const [search, setSearch] = useState("");

  async function parse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "Request failed.");
    return payload;
  }

  async function refresh(page = 1, nextSearch = search) {
    const [previewResponse, catalogResponse] = await Promise.all([
      fetch(appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}/preview?page=${page}&pageSize=50&search=${encodeURIComponent(nextSearch)}`), { cache: "no-store" }),
      fetch(appApiPath("/api/mapping-artifacts/catalog"), { cache: "no-store" }),
    ]);
    const nextPreview = await parse<MappingArtifactCsvPreview>(previewResponse);
    const nextCatalog = await parse<{ artifacts: MappingArtifact[] }>(catalogResponse);
    setPreview(nextPreview);
    setCatalog(nextCatalog.artifacts);
    setMessage("Artifact version loaded.");
  }

  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load this artifact.")); }, [artifactId]);
  const artifact = preview?.artifact;
  const details = artifact ? publicArtifactDetails(artifact) : null;
  const lineage = artifact ? resolveArtifactLineage(artifact, catalog) : [];

  return <div className="workspace-page"><section className="page-banner"><div><p className="page-kicker">Mapping Artifact Version</p><h1>{artifact ? artifactTypeLabel(artifact.artifact_type) : "Artifact"}</h1><p className="page-summary">Read-only preview of an immutable pipeline artifact.</p></div></section>{!artifact || !details ? <section className="surface-card"><p>{message}</p></section> : <><section className="surface-card version-detail-summary"><div className="section-heading"><div><h2>{short(artifact.id)}</h2><p>{artifact.status} · {artifact.row_count} rows · checksum {short(artifact.checksum_sha256)}</p></div><div className="action-strip"><Link className="button button-secondary button-inline" href="/artifact-registry">Back to Artifact Registry</Link><a className="button button-secondary button-inline" href={appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/download`)}>Download CSV</a></div></div><dl className="full-mapping-metadata"><div><dt>Created</dt><dd>{date(details.createdAt)} by {details.createdBy || "—"}</dd></div><div><dt>Committed</dt><dd>{date(details.committedAt)} by {details.committedBy || "—"}</dd></div><div><dt>Source version</dt><dd>{details.sourceVersionLabel || details.sourceVersionId || "—"}</dd></div><div><dt>Validation</dt><dd>{artifact.validation.valid ? "Passed" : artifact.validation.blocking_errors.join(" ") || "Requires review"}</dd></div></dl>{lineage.length ? <div className="full-mapping-lineage"><strong>Source lineage</strong>{lineage.map((source) => <p key={source.id}><Link href={`/artifact-registry/${source.id}`}>{short(source.id)}</Link>{source.checksum ? ` · ${short(source.checksum)}` : ""}</p>)}</div> : null}</section><section className="surface-card"><div className="section-heading"><div><h2>CSV preview</h2><p>{preview.totalRows} matching rows.</p></div><label className="settings-field version-search-field"><span>Search CSV</span><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void refresh(1, search); }} placeholder="Search any field, then press Enter" /></label></div><div className="table-shell"><table className="enterprise-table"><thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.rows.length ? preview.rows.map((row, rowIndex) => <tr key={`${preview.page}-${rowIndex}-${row.join("|")}`}>{row.map((value, columnIndex) => <td key={`${columnIndex}-${value}`}>{value}</td>)}</tr>) : <tr><td colSpan={preview.columns.length || 1} className="empty-table-cell">No rows match the search.</td></tr>}</tbody></table></div>{preview.pageCount > 1 ? <div className="pager-cluster source-version-pager"><button className="button button-secondary" type="button" disabled={preview.page <= 1} onClick={() => void refresh(preview.page - 1)}>Previous</button><span>Page {preview.page} of {preview.pageCount}</span><button className="button button-secondary" type="button" disabled={preview.page >= preview.pageCount} onClick={() => void refresh(preview.page + 1)}>Next</button></div> : null}</section></>}</div>;
}
