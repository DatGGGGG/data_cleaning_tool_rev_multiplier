"use client";

import { useState } from "react";
import { appApiPath } from "@/lib/app-path";
import type { BottomUpProductionSource, PublicAppSettings } from "@/lib/app-settings/server";

type SettingsEditorProps = {
  initialSettings: PublicAppSettings;
};

type SettingsResponse = {
  settings?: PublicAppSettings;
  message?: string;
  error?: string;
};

type ConnectionTestResponse = {
  baseUrl?: string;
  sampleApp?: {
    appId: string;
    name: string;
    publisherName: string;
    publisherId: string;
  };
  message?: string;
  error?: string;
};

async function parseSettingsResponse(response: Response) {
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as SettingsResponse) : {};
  if (!response.ok) {
    throw new Error(payload.error || "Settings request failed.");
  }
  return payload;
}

export function SettingsEditor({ initialSettings }: SettingsEditorProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [operatorName, setOperatorName] = useState("Local operator");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Settings ready.");

  async function saveSettings() {
    setIsSaving(true);
    try {
      const response = await fetch(appApiPath("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          strategyDataApiKey: apiKeyInput,
          clearStrategyDataApiKey: clearApiKey,
          operatorName,
        }),
      });
      const payload = await parseSettingsResponse(response);
      if (payload.settings) {
        setSettings(payload.settings);
      }
      setApiKeyInput("");
      setClearApiKey(false);
      setStatusMessage(payload.message || "Saved settings.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function testConnection() {
    setIsTestingConnection(true);
    try {
      const response = await fetch(appApiPath("/api/settings/strategy-data/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyDataApiBaseUrl: settings.strategyDataApiBaseUrl,
          strategyDataApiKey: clearApiKey ? "" : apiKeyInput,
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as ConnectionTestResponse) : {};
      if (!response.ok) {
        throw new Error(payload.error || "Could not connect to App Full Info.");
      }

      const sample = payload.sampleApp;
      setStatusMessage(
        sample
          ? `Connected. App Full Info is available; sample: ${sample.name || sample.appId}.`
          : payload.message || "Connected to App Full Info.",
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not connect to App Full Info.");
    } finally {
      setIsTestingConnection(false);
    }
  }

  return (
    <div className="workspace-page">
      <section className="page-banner">
        <div>
          <p className="page-kicker">Admin Settings</p>
          <h1>Data Source Configuration</h1>
          <p className="page-summary">
            Configure how the cleaning workbench reads production data from the VN Strategy Data System.
          </p>
        </div>
        <div className="banner-pill-stack">
          <span className="metric-pill">
            API key {settings.strategyDataApiKeyPresent ? "configured" : "missing"}
          </span>
          <span className="metric-pill">Source: {settings.bottomUpProductionSource}</span>
        </div>
      </section>

      <section className="surface-card settings-panel">
        <div className="section-heading">
          <div>
            <h2>Bottom Up Step 0 Source</h2>
            <p>Use API for production. Local file remains available as a dev fallback.</p>
          </div>
          <span className="status-inline">{isSaving ? "Saving..." : statusMessage}</span>
        </div>

        <div className="settings-grid">
          <label className="settings-field">
            <span className="field-label">Production source</span>
            <select
              className="input select-input"
              value={settings.bottomUpProductionSource}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  bottomUpProductionSource: event.target.value as BottomUpProductionSource,
                }))
              }
            >
              <option value="auto">Auto: API if configured, otherwise file</option>
              <option value="api">API only</option>
              <option value="file">Local file only</option>
            </select>
          </label>

          <label className="settings-field">
            <span className="field-label">Strategy Data API base URL</span>
            <input
              className="input enterprise-input"
              value={settings.strategyDataApiBaseUrl}
              onChange={(event) =>
                setSettings((current) => ({ ...current, strategyDataApiBaseUrl: event.target.value }))
              }
              placeholder="http://host.docker.internal:8001"
            />
            <span className="field-help">
              On the deployed workbench VM, use <code>http://host.docker.internal:8001</code>. For local development, use <code>http://localhost:8001</code>.
            </span>
          </label>

          <label className="settings-field">
            <span className="field-label">Strategy Data API key</span>
            <input
              className="input enterprise-input"
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder={settings.strategyDataApiKeyPresent ? "Stored. Enter a new key to replace it." : "Paste API key"}
              disabled={clearApiKey}
            />
          </label>

          <label className="settings-field">
            <span className="field-label">API fetch batch size</span>
            <input
              className="input enterprise-input"
              type="number"
              min={1}
              max={500}
              value={settings.strategyDataApiPageSize}
              onChange={(event) =>
                setSettings((current) => ({ ...current, strategyDataApiPageSize: Number(event.target.value) }))
              }
            />
            <span className="field-help">Rows requested per Strategy Data API call. Keep 500 because the production /query endpoint caps each request at 500 rows.</span>
          </label>

          <label className="settings-field settings-field-wide">
            <span className="field-label">Local fallback App Full Info NDJSON</span>
            <input
              className="input enterprise-input"
              value={settings.appFullInfoCurrentNdjson}
              onChange={(event) =>
                setSettings((current) => ({ ...current, appFullInfoCurrentNdjson: event.target.value }))
              }
            />
          </label>

          <label className="settings-field settings-field-wide">
            <span className="field-label">Local fallback Bottom Up seed CSV</span>
            <input
              className="input enterprise-input"
              value={settings.bottomUpSeedCsv}
              onChange={(event) => setSettings((current) => ({ ...current, bottomUpSeedCsv: event.target.value }))}
            />
          </label>

          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
            />
            <span>Clear stored Strategy Data API key on save</span>
          </label>

          <label className="settings-field">
            <span className="field-label">Operator</span>
            <input
              className="input enterprise-input"
              value={operatorName}
              onChange={(event) => setOperatorName(event.target.value)}
            />
          </label>
        </div>

        <div className="settings-actions">
          <button type="button" className="button button-primary" onClick={() => void saveSettings()} disabled={isSaving}>
            Save Settings
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void testConnection()}
            disabled={isSaving || isTestingConnection}
          >
            {isTestingConnection ? "Testing Connection..." : "Test App Full Info Connection"}
          </button>
          <span className="muted-text">
            Last updated by {settings.updatedBy} at {new Date(settings.updatedAt).toLocaleString()}
          </span>
        </div>
      </section>
    </div>
  );
}
