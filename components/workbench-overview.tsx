"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { appApiPath } from "@/lib/app-path";
import type {
  ActivityLogEntry,
  PublisherOverviewRow,
  TopDownOverviewState,
  TopDownVersionSnapshot,
} from "@/lib/top-down/types";

type WorkbenchOverviewProps = {
  initialState: TopDownOverviewState;
};

type WorkbenchResponse = {
  state: TopDownOverviewState;
  message?: string;
  error?: string;
};

export function WorkbenchOverview({ initialState }: WorkbenchOverviewProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [operatorName, setOperatorName] = useState(initialState.operatorName);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Overview ready.");

  const latestLogs: ActivityLogEntry[] = state.logs.slice(0, 8);
  const latestVersions: TopDownVersionSnapshot[] = state.versions.slice(0, 6);
  const requiresNewVersion = state.versionFreshness.hasUnversionedChanges;

  useEffect(() => {
    void reloadOverview();
  }, []);

  function applyServerState(nextState: TopDownOverviewState, message: string) {
    setState(nextState);
    setStatusMessage(message);
    startTransition(() => {
      router.refresh();
    });
  }

  async function parseResponse(response: Response) {
    const raw = await response.text();
    let payload = {} as WorkbenchResponse;
    if (raw) {
      try {
        payload = JSON.parse(raw) as WorkbenchResponse;
      } catch {
        throw new Error("The server returned an invalid response. Please refresh and try again.");
      }
    }
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }
    return payload;
  }

  async function postOverview(body: Record<string, string>, message: string) {
    const response = await fetch(appApiPath("/api/top-down/overview"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operatorName, ...body }),
    });
    const payload = await parseResponse(response);
    applyServerState(payload.state, message);
  }

  async function reloadOverview(message = "Reloaded workbench overview.") {
    setIsBusy(true);
    try {
      const response = await fetch(
        appApiPath(`/api/top-down/overview?operatorName=${encodeURIComponent(operatorName)}`),
        { cache: "no-store" },
      );
      const payload = await parseResponse(response);
      applyServerState(payload.state, message);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to reload overview.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveVersion() {
    setIsBusy(true);
    try {
      const response = await fetch(appApiPath("/api/top-down/versions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operatorName }),
      });
      await parseResponse(response);
      await reloadOverview("Saved a dataset version.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save a version.");
    } finally {
      setIsBusy(false);
    }
  }

  async function exportFlattenedCsv() {
    setIsBusy(true);
    try {
      const response = await fetch(
        appApiPath(`/api/top-down/export?operatorName=${encodeURIComponent(operatorName)}`),
        { cache: "no-store" },
      );

      if (!response.ok) {
        throw new Error("Failed to export flattened CSV.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const fileName =
        response.headers.get("Content-Disposition")?.match(/filename=\"([^\"]+)\"/)?.[1] ??
        "mapping_publisher_to_apps_top_down.csv";
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);

      await reloadOverview(`Exported ${fileName}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to export flattened CSV.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="workspace-page">
      <section className="page-banner">
        <div>
          <p className="page-kicker">Top Down Preparation</p>
          <h1>Mapping Publisher to Apps</h1>
          <p className="page-summary">
            Use the overview to control exports, versions, and publisher queues. Open a publisher to work on its
            dedicated game-list editing page.
          </p>
        </div>
        <div className="operator-chip">
          <label className="field-label" htmlFor="operator-name">
            Operator
          </label>
          <input
            id="operator-name"
            className="input enterprise-input"
            value={operatorName}
            onChange={(event) => setOperatorName(event.target.value)}
            placeholder="Local operator"
          />
        </div>
      </section>

      <section className="action-strip">
        <button type="button" className="button button-primary" onClick={() => void saveVersion()} disabled={isBusy}>
          {requiresNewVersion ? "Save New Version" : "Save Version"}
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void exportFlattenedCsv()}
          disabled={isBusy}
        >
          Export CSV
        </button>
        <button type="button" className="button button-secondary" onClick={() => void reloadOverview()} disabled={isBusy}>
          Reload
        </button>
        <Link href="/bottom-up" className="button button-secondary">
          Open Bottom Up Mapping
        </Link>
        <Link href="/full-mapping" className="button button-secondary">
          Open Full Mapping
        </Link>
        <Link href="/publisher-management" className="button button-secondary">
          Manage Publishers
        </Link>
        <div className="status-inline">{isBusy ? "Working..." : statusMessage}</div>
      </section>

      {requiresNewVersion ? (
        <section className="version-freshness-warning" role="status">
          <div>
            <strong>Top Down version update required</strong>
            <p>
              The working mapping has changes that are not included in a saved version. Full Mapping only sees saved Top Down versions.
            </p>
          </div>
          <button type="button" className="button button-primary button-inline" onClick={() => void saveVersion()} disabled={isBusy}>
            Save New Version
          </button>
        </section>
      ) : (
        <p className="version-freshness-current" role="status">Latest saved Top Down version matches the working mapping.</p>
      )}

      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">Publishers</span>
          <strong>{state.publisherCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Flattened Rows</span>
          <strong>{state.flattenedRowCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Needs Review</span>
          <strong>{state.needsReviewCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Saved Versions</span>
          <strong>{state.versions.length}</strong>
        </article>
      </section>

      <section className="content-grid">
        <div className="surface-card">
          <div className="section-heading">
            <div>
              <h2>Publisher Queue</h2>
              <p>Each publisher opens into a dedicated game-list editor.</p>
            </div>
            <Link href="/publisher-management" className="button button-secondary button-inline">
              Maintain Publisher Data
            </Link>
          </div>

          <div className="table-shell">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Publisher</th>
                  <th>Revenue Multiplier</th>
                  <th>Rows</th>
                  <th>Flattened Apps</th>
                  <th>Needs Review</th>
                  <th>SensorTower Issues</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {state.publishers.map((publisher) => (
                    <tr key={publisher.id}>
                      <td className="cell-strong">{publisher.name}</td>
                      <td>{publisher.revenueMultiplier || "1"}</td>
                      <td>{publisher.rowCount}</td>
                      <td>{publisher.flattenedAppCount}</td>
                      <td>{publisher.needsReviewCount}</td>
                      <td>
                        {publisher.sensorTowerIssueCount > 0 ? (
                          <span className="overview-issue-badge">{publisher.sensorTowerIssueCount}</span>
                        ) : (
                          <span className="overview-issue-clear">0</span>
                        )}
                      </td>
                      <td>
                        <Link className="button button-link" href={`/publishers/${publisher.key}`}>
                          Open Mapping
                        </Link>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-column">
          <section className="surface-card">
            <div className="section-heading">
              <div>
                <h2>Recent Versions</h2>
                <p>Latest snapshots for rollback and traceability.</p>
              </div>
            </div>
            <div className="list-stack">
              {latestVersions.length === 0 ? (
                <div className="list-card muted-text">No versions saved yet.</div>
              ) : (
                latestVersions.map((version) => (
                  <div key={version.id} className="list-card">
                    <strong>{version.label}</strong>
                    <p>{new Date(version.createdAt).toLocaleString()}</p>
                    <span>{version.publisherCount} publishers captured</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="surface-card">
            <div className="section-heading">
              <div>
                <h2>Activity Log</h2>
                <p>Meaningful operator actions only.</p>
              </div>
              <Link href="/audit-trail" className="button button-secondary button-inline">
                View All Activity
              </Link>
            </div>
            <div className="list-stack">
              {latestLogs.map((entry) => (
                <div key={entry.id} className="list-card">
                  <strong>{entry.action}</strong>
                  <p>{entry.actor}</p>
                  <span>{entry.detail}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
