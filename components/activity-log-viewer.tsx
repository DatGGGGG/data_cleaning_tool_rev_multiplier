"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { ActivityLogEntry } from "@/lib/top-down/types";

type ActivityLogViewerProps = {
  logs: ActivityLogEntry[];
};

function getFilterableLogText(entry: ActivityLogEntry) {
  return [
    entry.action,
    entry.actor,
    entry.targetType,
    entry.targetId,
    entry.detail,
    entry.createdAt,
  ]
    .join(" ")
    .toLowerCase();
}

export function ActivityLogViewer({ logs }: ActivityLogViewerProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filteredLogs = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return logs;
    }

    return logs.filter((entry) => getFilterableLogText(entry).includes(normalizedQuery));
  }, [deferredQuery, logs]);

  return (
    <div className="workspace-page">
      <section className="page-banner compact-banner">
        <div>
          <p className="page-kicker">Audit Trail</p>
          <h1>Activity Log</h1>
          <p className="page-summary">
            Full operator history for top-down preparation actions, imports, exports, saves, restores, and SensorTower updates.
          </p>
        </div>
        <div className="banner-meta">
          <div className="meta-pill">{logs.length} total logs</div>
          <div className="meta-pill">{filteredLogs.length} visible</div>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-heading">
          <div>
            <h2>Inspect Logs</h2>
            <p>Search across action, actor, target, detail, and timestamp.</p>
          </div>
          <div className="audit-search">
            <input
              className="input enterprise-input audit-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search logs"
            />
          </div>
        </div>

        <div className="table-shell">
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target Type</th>
                <th>Target ID</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((entry) => (
                <tr key={entry.id}>
                  <td className="audit-time-cell">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="cell-strong">{entry.action}</td>
                  <td>{entry.actor}</td>
                  <td>{entry.targetType}</td>
                  <td className="audit-target-cell">{entry.targetId}</td>
                  <td>{entry.detail || "-"}</td>
                </tr>
              ))}
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No log entries matched the current search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
