"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import type { LocalVersionPreview } from "@/lib/version-preview";

type Props = { preview: LocalVersionPreview };

function short(value: string) { return value.length > 12 ? `${value.slice(0, 12)}…` : value; }

export function LocalVersionDetail({ preview }: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const matchedRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return preview.rows;
    return preview.rows.filter((row) => row.some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [preview.rows, search]);
  const pageCount = Math.max(1, Math.ceil(matchedRows.length / pageSize));
  const visibleRows = matchedRows.slice((page - 1) * pageSize, page * pageSize);
  const apiName = preview.workflow === "top_down" ? "top-down" : "bottom-up";
  const backHref = preview.workflow === "top_down" ? "/" : "/bottom-up";

  return <div className="workspace-page">
    <section className="page-banner"><div><p className="page-kicker">Saved Version</p><h1>{preview.title}</h1><p className="page-summary">Read-only preview of an immutable saved snapshot.</p></div></section>
    <section className="surface-card version-detail-summary"><div className="section-heading"><div><h2>{preview.version.label}</h2><p>{new Date(preview.version.createdAt).toLocaleString()} · created by {preview.version.createdBy}</p></div><div className="action-strip"><Link className="button button-secondary button-inline" href={backHref}>Back to {preview.workflow === "top_down" ? "Top Down" : "Bottom Up"}</Link><a className="button button-secondary button-inline" href={appApiPath(`/api/version-browser/${apiName}/${preview.version.id}/download`)}>Download CSV</a></div></div><dl className="full-mapping-metadata"><div><dt>Rows</dt><dd>{preview.version.rowCount}</dd></div><div><dt>Checksum</dt><dd title={preview.version.checksumSha256}>{short(preview.version.checksumSha256)}</dd></div><div><dt>Summary</dt><dd>{preview.version.summary}</dd></div><div><dt>Version ID</dt><dd title={preview.version.id}>{short(preview.version.id)}</dd></div></dl></section>
    <section className="surface-card"><div className="section-heading"><div><h2>Version rows</h2><p>{matchedRows.length} matching rows of {preview.rows.length} saved rows.</p></div><label className="settings-field version-search-field"><span>Search saved rows</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search any field" /></label></div><div className="table-shell"><table className="enterprise-table"><thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={`${page}-${index}-${row.join("|")}`}>{row.map((value, cellIndex) => <td key={`${cellIndex}-${value}`}>{value}</td>)}</tr>) : <tr><td colSpan={preview.columns.length} className="empty-table-cell">No rows match the search.</td></tr>}</tbody></table></div>{matchedRows.length > pageSize ? <div className="pager-cluster source-version-pager"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" className="button button-secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div> : null}</section>
  </div>;
}
