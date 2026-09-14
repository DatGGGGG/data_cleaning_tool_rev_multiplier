"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { appApiPath } from "@/lib/app-path";
import type { PublisherOverviewRow, TopDownOverviewState } from "@/lib/top-down/types";

type PublisherManagementProps = {
  initialState: TopDownOverviewState;
};

type OverviewResponse = {
  state: TopDownOverviewState;
  error?: string;
};

export function PublisherManagement({ initialState }: PublisherManagementProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [operatorName, setOperatorName] = useState(initialState.operatorName);
  const [newPublisherName, setNewPublisherName] = useState("");
  const [newMultiplier, setNewMultiplier] = useState("1");
  const [query, setQuery] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Publisher registry ready.");
  const deferredQuery = useDeferredValue(query);

  const visiblePublishers = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return state.publishers;
    }

    return state.publishers.filter((publisher) => publisher.name.toLowerCase().includes(normalizedQuery));
  }, [deferredQuery, state.publishers]);

  useEffect(() => {
    void reloadRegistry();
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
    let payload = {} as OverviewResponse;
    if (raw) {
      try {
        payload = JSON.parse(raw) as OverviewResponse;
      } catch {
        throw new Error("The server returned an invalid response. Please refresh and try again.");
      }
    }

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    return payload;
  }

  async function reloadRegistry(message = "Publisher registry reloaded.") {
    setIsBusy(true);
    try {
      const response = await fetch(
        appApiPath(`/api/top-down/overview?operatorName=${encodeURIComponent(operatorName)}`),
        { cache: "no-store" },
      );
      const payload = await parseResponse(response);
      applyServerState(payload.state, message);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load publisher registry.");
    } finally {
      setIsBusy(false);
    }
  }

  async function postOverview(body: Record<string, string>, message: string) {
    const response = await fetch(appApiPath("/api/top-down/overview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorName, ...body }),
    });
    const payload = await parseResponse(response);
    applyServerState(payload.state, message);
    return payload;
  }

  async function addPublisher() {
    const trimmedName = newPublisherName.trim();
    if (!trimmedName) {
      setStatusMessage("Enter a publisher name first.");
      return;
    }

    setIsBusy(true);
    try {
      const created = await postOverview(
        { action: "add_publisher", publisherName: trimmedName },
        `Added publisher ${trimmedName}.`,
      );
      const createdPublisher = [...created.state.publishers].reverse().find(
        (publisher) => publisher.name.localeCompare(trimmedName, undefined, { sensitivity: "accent" }) === 0,
      );
      if (createdPublisher && newMultiplier.trim() && newMultiplier.trim() !== "1") {
        await postOverview(
          {
            action: "update_revenue_multiplier",
            publisherId: createdPublisher.id,
            revenueMultiplier: newMultiplier.trim(),
          },
          `Added publisher ${trimmedName} with its revenue multiplier.`,
        );
      }
      setNewPublisherName("");
      setNewMultiplier("1");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to add publisher.");
    } finally {
      setIsBusy(false);
    }
  }

  async function updateMultiplier(publisher: PublisherOverviewRow, value: string) {
    const revenueMultiplier = value.trim() || "1";
    if (revenueMultiplier === publisher.revenueMultiplier) {
      return;
    }

    setState((current) => ({
      ...current,
      publishers: current.publishers.map((item) =>
        item.id === publisher.id ? { ...item, revenueMultiplier } : item,
      ),
    }));
    setIsBusy(true);
    try {
      await postOverview(
        { action: "update_revenue_multiplier", publisherId: publisher.id, revenueMultiplier },
        `Updated the revenue multiplier for ${publisher.name}.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update revenue multiplier.");
      await reloadRegistry("Reloaded the publisher registry after the failed update.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="workspace-page">
      <section className="page-banner compact-banner">
        <div>
          <p className="page-kicker">Publisher Master Data</p>
          <h1>Publisher Management</h1>
          <p className="page-summary">
            Maintain the registered publisher list and revenue multipliers used by Top Down and Bottom Up mapping.
          </p>
        </div>
        <div className="banner-meta">
          <div className="meta-pill">{state.publisherCount} registered publishers</div>
          <div className="meta-pill">{visiblePublishers.length} visible</div>
        </div>
      </section>

      <section className="action-strip">
        <label className="operator-inline">
          <span className="field-label">Operator</span>
          <input
            className="input enterprise-input compact-input"
            value={operatorName}
            onChange={(event) => setOperatorName(event.target.value)}
            placeholder="Local operator"
          />
        </label>
        <button type="button" className="button button-secondary" onClick={() => void reloadRegistry()} disabled={isBusy}>
          Reload
        </button>
        <Link href="/" className="button button-secondary">
          Open Top Down Mapping
        </Link>
        <div className="status-inline">{isBusy ? "Saving..." : statusMessage}</div>
      </section>

      <section className="surface-card publisher-registry-card">
        <div className="section-heading publisher-registry-heading">
          <div>
            <h2>Registered Publishers</h2>
            <p>Revenue multipliers are maintained here and applied read-only in mapping workflows.</p>
          </div>
          <div className="publisher-registry-actions">
            <input
              className="input enterprise-input compact-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search publishers"
              aria-label="Search publishers"
            />
          </div>
        </div>

        <div className="publisher-create-panel">
          <div>
            <span className="field-label">New publisher name</span>
            <input
              className="input enterprise-input"
              value={newPublisherName}
              onChange={(event) => setNewPublisherName(event.target.value)}
              placeholder="e.g. VNG"
            />
          </div>
          <div>
            <span className="field-label">Revenue multiplier</span>
            <input
              className="input enterprise-input"
              value={newMultiplier}
              onChange={(event) => setNewMultiplier(event.target.value)}
              placeholder="1"
            />
          </div>
          <button type="button" className="button button-primary" onClick={() => void addPublisher()} disabled={isBusy}>
            Add Publisher
          </button>
        </div>

        <div className="table-shell">
          <table className="enterprise-table publisher-registry-table">
            <thead>
              <tr>
                <th>Publisher</th>
                <th>Revenue Multiplier</th>
                <th>Top Down Rows</th>
                <th>Flattened Apps</th>
                <th>Needs Review</th>
                <th>SensorTower Issues</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visiblePublishers.length === 0 ? (
                <tr>
                  <td className="empty-table-cell" colSpan={7}>No publishers match this search.</td>
                </tr>
              ) : (
                visiblePublishers.map((publisher) => (
                  <tr key={publisher.id}>
                    <td className="cell-strong">{publisher.name}</td>
                    <td>
                      <input
                        className="input enterprise-input mini-input"
                        value={publisher.revenueMultiplier || "1"}
                        onChange={(event) => {
                          const revenueMultiplier = event.target.value;
                          setState((current) => ({
                            ...current,
                            publishers: current.publishers.map((item) =>
                              item.id === publisher.id ? { ...item, revenueMultiplier } : item,
                            ),
                          }));
                        }}
                        onBlur={(event) => void updateMultiplier(publisher, event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                        aria-label={`Revenue multiplier for ${publisher.name}`}
                      />
                    </td>
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
                        Open Top Down
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
