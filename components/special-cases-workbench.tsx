"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { appApiPath } from "@/lib/app-path";
import {
  activeSpecialCasesArtifact,
  findArtifactForSpecialCasesVersion,
  isActiveSpecialCasesArtifact,
  specialCasesActivationConfirmationMessage,
  specialCasesActivationDisabledReason,
  specialCasesCommitDisabledReason,
  specialCasesPublishDisabledReason,
} from "@/lib/mapping-artifacts/special-cases-artifacts";
import type {
  MappingArtifact,
  MappingArtifactActivationHistoryResponse,
  MappingArtifactActivationResponse,
  MappingArtifactActiveResponse,
  MappingArtifactActiveState,
  MappingArtifactReadiness,
} from "@/lib/mapping-artifacts/types";
import {
  filterSpecialCasePublisherGroups,
  sortSpecialCasePublisherGroups,
  type SpecialCasePublisherGroupFilters,
  type SpecialCasePublisherSortDirection,
  type SpecialCasePublisherSortField,
} from "@/lib/special-cases/publisher-groups";
import type {
  SpecialCaseInvestigationRow,
  SpecialCaseJob,
  SpecialCasePublisherGroup,
  SpecialCasesOverview,
} from "@/lib/special-cases/types";

const short = (value: string | null | undefined) =>
  value ? (value.length > 12 ? `${value.slice(0, 12)}…` : value) : "—";
const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "—";
const isComparisonBaseline = (sourceType: string) =>
  sourceType === "uploaded_baseline" || sourceType === "cumulative_baseline";
const isAppFullInfoSource = (sourceType: string) =>
  sourceType === "api" || sourceType === "file";
const pageSizes = [25, 50, 100] as const;
const blankFilters: SpecialCasePublisherGroupFilters = {
  search: "",
  cleanedPublisherName: "",
  revenueMultiplier: "",
  suspected: "all",
  checked: "all",
  newApps: "all",
};
const sortableColumns: {
  field: SpecialCasePublisherSortField;
  label: string;
}[] = [
  { field: "publisherName", label: "Raw publisher name" },
  { field: "cleanedPublisherName", label: "Cleaned publisher" },
  { field: "revenueMultiplier", label: "Multiplier" },
  { field: "appCount", label: "Apps" },
  { field: "newAppCount", label: "New apps" },
  { field: "isSuspected", label: "Suspected" },
  { field: "isChecked", label: "Checked" },
];
type Investigation = { rows: SpecialCaseInvestigationRow[]; total: number };
const sectionLinks = [
  { id: "special-cases-status", step: "Status", label: "Workflow status" },
  { id: "special-cases-source", step: "1", label: "Load App Full Info" },
  { id: "special-cases-versions", step: "2", label: "Source versions" },
  { id: "special-cases-publishers", step: "3", label: "Suspected publishers" },
  { id: "special-cases-apps", step: "4", label: "Investigate apps" },
  { id: "special-cases-final", step: "5", label: "Final versions" },
] as const;

export function SpecialCasesWorkbench() {
  const [overview, setOverview] = useState<SpecialCasesOverview | null>(null);
  const [artifacts, setArtifacts] = useState<MappingArtifact[]>([]);
  const [readiness, setReadiness] = useState<MappingArtifactReadiness | null>(null);
  const [activeArtifactState, setActiveArtifactState] = useState<MappingArtifactActiveState | null>(null);
  const [activationHistory, setActivationHistory] = useState<MappingArtifactActivationHistoryResponse["events"]>([]);
  const [publishingVersionId, setPublishingVersionId] = useState<string | null>(null);
  const [committingArtifactId, setCommittingArtifactId] = useState<string | null>(null);
  const [activatingArtifactId, setActivatingArtifactId] = useState<string | null>(null);
  const [fullArtifactId, setFullArtifactId] = useState("");
  const [job, setJob] = useState<SpecialCaseJob | null>(null);
  const [rows, setRows] = useState<SpecialCaseInvestigationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [adjustmentsOnly, setAdjustmentsOnly] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [publisherFilters, setPublisherFilters] = useState(blankFilters);
  const [publisherSortField, setPublisherSortField] =
    useState<SpecialCasePublisherSortField>("appCount");
  const [publisherSortDirection, setPublisherSortDirection] =
    useState<SpecialCasePublisherSortDirection>("desc");
  const [publisherPage, setPublisherPage] = useState(1);
  const [publisherPageSize, setPublisherPageSize] =
    useState<(typeof pageSizes)[number]>(50);
  const [publisherReviewDirty, setPublisherReviewDirty] = useState(false);
  const [activeSection, setActiveSection] = useState<
    (typeof sectionLinks)[number]["id"]
  >(sectionLinks[0].id);
  const [message, setMessage] = useState("Loading Special Cases workspace…");
  const [busy, setBusy] = useState(false);
  const historicalBaselineInput = useRef<HTMLInputElement>(null);
  const historicalFinalInput = useRef<HTMLInputElement>(null);
  const [selectedBaselineId, setSelectedBaselineId] = useState("");
  const [cumulativeBaseBaselineId, setCumulativeBaseBaselineId] = useState("");
  const [cumulativeAppSourceId, setCumulativeAppSourceId] = useState("");
  const currentId = overview?.currentSourceVersionId ?? "";
  const comparisonId = overview?.comparisonSourceVersionId ?? "";
  const selectedFinalBaselineId = overview?.selectedFinalBaselineVersionId ?? "";
  const canMutate = Boolean(overview?.canMutate && !busy);
  const fullArtifacts = useMemo(
    () =>
      artifacts.filter(
        (item) => item.artifact_type === "full" && item.status === "committed",
      ),
    [artifacts],
  );
  const groups = overview?.publisherGroups ?? [];
  const baselineVersions = useMemo(
    () =>
      (overview?.sourceVersions ?? []).filter((version) =>
        isComparisonBaseline(version.sourceType),
      ),
    [overview?.sourceVersions],
  );
  const appFullInfoVersions = useMemo(
    () =>
      (overview?.sourceVersions ?? []).filter((version) =>
        isAppFullInfoSource(version.sourceType),
      ),
    [overview?.sourceVersions],
  );
  const cleanedPublishers = useMemo(
    () =>
      [
        ...new Set(
          groups.map((group) => group.cleanedPublisherName).filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [groups],
  );
  const multipliers = useMemo(
    () =>
      [
        ...new Set(
          groups.map((group) => group.revenueMultiplier).filter(Boolean),
        ),
      ].sort((a, b) => Number(a) - Number(b)),
    [groups],
  );
  const filteredGroups = useMemo(
    () =>
      sortSpecialCasePublisherGroups(
        filterSpecialCasePublisherGroups(groups, publisherFilters),
        publisherSortField,
        publisherSortDirection,
      ),
    [groups, publisherFilters, publisherSortField, publisherSortDirection],
  );
  const publisherPageCount = Math.max(
    1,
    Math.ceil(filteredGroups.length / publisherPageSize),
  );
  const visiblePublisherPage = Math.min(publisherPage, publisherPageCount);
  const pageGroups = filteredGroups.slice(
    (visiblePublisherPage - 1) * publisherPageSize,
    visiblePublisherPage * publisherPageSize,
  );
  const suspectedCount = groups.filter((group) => group.isSuspected).length;
  const checkedCount = groups.filter((group) => group.isChecked).length;
  const specialCasesArtifacts = useMemo(
    () => artifacts.filter((item) => item.artifact_type === "special_cases"),
    [artifacts],
  );
  const activeSpecialCases = activeSpecialCasesArtifact(activeArtifactState);

  async function json<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message ?? "Request failed.");
    return body as T;
  }
  async function refresh() {
    const [workbench, catalog, nextReadiness, active, history] = await Promise.all([
      json<{ overview: SpecialCasesOverview }>(
        await fetch(appApiPath("/api/special-cases/workbench"), {
          cache: "no-store",
        }),
      ),
      json<{ artifacts: MappingArtifact[] }>(
        await fetch(appApiPath("/api/mapping-artifacts/catalog"), {
          cache: "no-store",
        }),
      ),
      json<MappingArtifactReadiness>(
        await fetch(appApiPath("/api/mapping-artifacts/readiness"), {
          cache: "no-store",
        }),
      ),
      json<MappingArtifactActiveResponse>(
        await fetch(appApiPath("/api/mapping-artifacts/active"), {
          cache: "no-store",
        }),
      ),
      json<MappingArtifactActivationHistoryResponse>(
        await fetch(
          appApiPath(
            "/api/mapping-artifacts/activation-history?type=special_cases",
          ),
          { cache: "no-store" },
        ),
      ),
    ]);
    const nextBaselineVersions = workbench.overview.sourceVersions.filter(
      (version) => isComparisonBaseline(version.sourceType),
    );
    const nextAppFullInfoVersions = workbench.overview.sourceVersions.filter(
      (version) => isAppFullInfoSource(version.sourceType),
    );
    setOverview(workbench.overview);
    setArtifacts(catalog.artifacts);
    setReadiness(nextReadiness);
    setActiveArtifactState(active.active);
    setActivationHistory(history.events);
    setFullArtifactId(
      (current) => current || workbench.overview.activeFullArtifactId || "",
    );
    setSelectedBaselineId(workbench.overview.comparisonSourceVersionId ?? "");
    setCumulativeBaseBaselineId((current) =>
      nextBaselineVersions.some((version) => version.id === current)
        ? current
        : workbench.overview.comparisonSourceVersionId &&
            nextBaselineVersions.some(
              (version) =>
                version.id === workbench.overview.comparisonSourceVersionId,
            )
          ? workbench.overview.comparisonSourceVersionId
          : (nextBaselineVersions[0]?.id ?? ""),
    );
    setCumulativeAppSourceId((current) =>
      nextAppFullInfoVersions.some((version) => version.id === current)
        ? current
        : workbench.overview.currentSourceVersionId &&
            nextAppFullInfoVersions.some(
              (version) =>
                version.id === workbench.overview.currentSourceVersionId,
            )
          ? workbench.overview.currentSourceVersionId
          : (nextAppFullInfoVersions[0]?.id ?? ""),
    );
    setPublisherReviewDirty(false);
    setMessage(
      workbench.overview.currentSourceVersionId
        ? "Special Cases source is ready for investigation."
        : "Choose a committed Full Mapping and load the current App Full Info source.",
    );
  }
  async function loadRows() {
    if (!currentId) {
      setRows([]);
      setTotal(0);
      return;
    }
    const query = new URLSearchParams({
      page: String(page),
      pageSize: "25",
      search,
      newOnly: String(newOnly),
      adjustmentsOnly: String(adjustmentsOnly),
      incompleteOnly: String(incompleteOnly),
    });
    const result = await json<Investigation>(
      await fetch(appApiPath(`/api/special-cases/investigation?${query}`), {
        cache: "no-store",
      }),
    );
    setRows(result.rows);
    setTotal(result.total);
  }
  useEffect(() => {
    void refresh().catch((error) =>
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load Special Cases.",
      ),
    );
  }, []);
  useEffect(() => {
    void loadRows().catch((error) =>
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load investigation rows.",
      ),
    );
  }, [currentId, page, search, newOnly, adjustmentsOnly, incompleteOnly]);
  useEffect(() => {
    if (selectedFinalBaselineId) setNewOnly(true);
  }, [selectedFinalBaselineId]);
  useEffect(() => {
    if (!job || job.status === "success" || job.status === "failed") return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await json<{ job: SpecialCaseJob }>(
          await fetch(appApiPath(`/api/special-cases/source-jobs/${job.id}`), {
            cache: "no-store",
          }),
        );
        setJob(next.job);
        if (next.job.status === "success") {
          await refresh();
          setMessage(next.job.message);
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not refresh source load.",
        );
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [job]);
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".special-cases-workflow-content > .surface-card",
      ),
    );
    sections.forEach((section, index) => {
      if (sectionLinks[index]) section.id = sectionLinks[index].id;
      section.classList.add("special-cases-anchor-section");
    });
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (left, right) =>
              left.boundingClientRect.top - right.boundingClientRect.top,
          );
        if (visible[0])
          setActiveSection(
            visible[0].target.id as (typeof sectionLinks)[number]["id"],
          );
      },
      { rootMargin: "-112px 0px -68% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  async function startLoad() {
    if (!fullArtifactId) return;
    setBusy(true);
    try {
      const next = await json<{ job: SpecialCaseJob }>(
        await fetch(appApiPath("/api/special-cases/source-jobs"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullArtifactId }),
        }),
      );
      setJob(next.job);
      setMessage("Source load started. Progress refreshes automatically.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not start source load.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function uploadHistoricalBaseline(file: File) {
    setBusy(true);
    setMessage(`Uploading ${file.name} as a historical comparison baseline…`);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await json<{
        overview: SpecialCasesOverview;
        importSummary: {
          filename: string;
          uniqueAppCount: number;
          duplicateAppIdCount: number;
          alreadyExisted: boolean;
        };
      }>(
        await fetch(appApiPath("/api/special-cases/source-versions/import"), {
          method: "POST",
          body: formData,
        }),
      );
      setOverview(result.overview);
      const nextBaselineVersions = result.overview.sourceVersions.filter(
        (version) => isComparisonBaseline(version.sourceType),
      );
      const nextAppFullInfoVersions = result.overview.sourceVersions.filter(
        (version) => isAppFullInfoSource(version.sourceType),
      );
      setSelectedBaselineId(result.overview.comparisonSourceVersionId ?? "");
      setCumulativeBaseBaselineId((current) =>
        nextBaselineVersions.some((version) => version.id === current)
          ? current
          : (result.overview.comparisonSourceVersionId ??
            nextBaselineVersions[0]?.id ?? ""),
      );
      setCumulativeAppSourceId((current) =>
        nextAppFullInfoVersions.some((version) => version.id === current)
          ? current
          : (result.overview.currentSourceVersionId ??
            nextAppFullInfoVersions[0]?.id ?? ""),
      );
      setPublisherReviewDirty(false);
      await loadRows();
      const summary = result.importSummary;
      setMessage(
        summary.alreadyExisted
          ? `${summary.filename} was already imported and is now the comparison baseline.`
          : `Imported ${summary.filename}: ${summary.uniqueAppCount.toLocaleString()} unique apps${summary.duplicateAppIdCount ? `; ${summary.duplicateAppIdCount.toLocaleString()} duplicate app ID${summary.duplicateAppIdCount === 1 ? " was" : "s were"} ignored` : ""}. It is now the comparison baseline.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not import the historical baseline CSV.",
      );
    } finally {
      if (historicalBaselineInput.current)
        historicalBaselineInput.current.value = "";
      setBusy(false);
    }
  }
  async function useSelectedBaseline() {
    if (!selectedBaselineId) return;
    if (
      await action({
        action: "set_comparison",
        sourceVersionId: selectedBaselineId,
      })
    ) {
      setSelectedBaselineId(selectedBaselineId);
      setMessage(
        "Comparison baseline updated. New-app counts were recalculated.",
      );
    }
  }
  async function uploadHistoricalFinal(file: File) {
    setBusy(true);
    setMessage(`Uploading ${file.name} as a Historical Final Special Cases baseline…`);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await json<{
        overview: SpecialCasesOverview;
        importSummary: { filename: string; inputRowCount: number; alreadyExisted: boolean };
      }>(await fetch(appApiPath("/api/special-cases/final-versions/import"), { method: "POST", body: formData }));
      setOverview(result.overview);
      setPage(1);
      setNewOnly(true);
      await loadRows();
      setMessage(result.importSummary.alreadyExisted
        ? `${result.importSummary.filename} was already imported and is selected as the historical final baseline.`
        : `Imported ${result.importSummary.filename} with ${result.importSummary.inputRowCount.toLocaleString()} historical final rows.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import the historical final CSV.");
    } finally {
      if (historicalFinalInput.current) historicalFinalInput.current.value = "";
      setBusy(false);
    }
  }
  async function createCumulativeBaseline() {
    if (!cumulativeBaseBaselineId || !cumulativeAppSourceId) return;
    setBusy(true);
    try {
      const result = await json<{
        overview: SpecialCasesOverview;
        result: {
          sourceVersion: {
            rowCount: number;
            addedAppCount: number | null;
            overlappingAppCount: number | null;
          };
          alreadyExisted: boolean;
        };
      }>(
        await fetch(appApiPath("/api/special-cases/workbench"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_cumulative_baseline",
            baseBaselineSourceVersionId: cumulativeBaseBaselineId,
            appFullInfoSourceVersionId: cumulativeAppSourceId,
          }),
        }),
      );
      setOverview(result.overview);
      const version = result.result.sourceVersion;
      setMessage(
        result.result.alreadyExisted
          ? "This cumulative baseline already exists. Select it whenever you want to use it for a later attempt."
          : `Created a cumulative baseline with ${version.rowCount.toLocaleString()} apps: ${(version.addedAppCount ?? 0).toLocaleString()} added and ${(version.overlappingAppCount ?? 0).toLocaleString()} already known. It has not changed this attempt's comparison.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create the cumulative baseline.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function action(body: unknown) {
    setBusy(true);
    try {
      const result = await json<{
        overview?: SpecialCasesOverview;
        version?: { id: string };
      }>(
        await fetch(appApiPath("/api/special-cases/workbench"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      if (result.overview) setOverview(result.overview);
      if (result.version) await refresh();
      setMessage(
        result.version
          ? `Saved immutable Special Cases version ${short(result.version.id)}.`
          : "Saved Special Cases changes.",
      );
      await loadRows();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save Special Cases changes.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function publishSpecialCases(versionId: string) {
    setPublishingVersionId(versionId);
    try {
      const result = await json<{ artifact: MappingArtifact }>(
        await fetch(appApiPath("/api/mapping-artifacts/publish/special-cases"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        }),
      );
      await refresh();
      setMessage(
        `Published Special Cases draft ${short(result.artifact.id)}. Review validation before committing.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not publish the Special Cases version.",
      );
    } finally {
      setPublishingVersionId(null);
    }
  }
  async function commitSpecialCases(artifactId: string) {
    setCommittingArtifactId(artifactId);
    try {
      const result = await json<{ artifact: MappingArtifact }>(
        await fetch(
          appApiPath(`/api/mapping-artifacts/artifacts/${artifactId}/commit`),
          { method: "POST" },
        ),
      );
      await refresh();
      setMessage(`Committed Special Cases artifact ${short(result.artifact.id)}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not commit the Special Cases draft.",
      );
    } finally {
      setCommittingArtifactId(null);
    }
  }
  async function activateSpecialCases(artifact: MappingArtifact) {
    if (
      !window.confirm(
        specialCasesActivationConfirmationMessage(artifact, activeSpecialCases),
      )
    ) {
      return;
    }
    setActivatingArtifactId(artifact.id);
    try {
      const result = await json<MappingArtifactActivationResponse>(
        await fetch(
          appApiPath(`/api/mapping-artifacts/artifacts/${artifact.id}/activate`),
          { method: "POST" },
        ),
      );
      setActiveArtifactState(result.active);
      await refresh();
      setMessage(`Activated Special Cases artifact ${short(artifact.id)}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not activate the Special Cases artifact.",
      );
    } finally {
      setActivatingArtifactId(null);
    }
  }
  function updateGroup(
    publisherName: string,
    change: Partial<SpecialCasePublisherGroup>,
  ) {
    setOverview((current) =>
      current
        ? {
            ...current,
            publisherGroups: current.publisherGroups.map((group) =>
              group.publisherName === publisherName
                ? { ...group, ...change }
                : group,
            ),
          }
        : current,
    );
    setPublisherReviewDirty(true);
  }
  function updateRow(
    appId: string,
    change: Partial<SpecialCaseInvestigationRow>,
  ) {
    setRows((current) =>
      current.map((row) => (row.appId === appId ? { ...row, ...change } : row)),
    );
  }
  const updateFilters = (change: Partial<SpecialCasePublisherGroupFilters>) => {
    setPublisherFilters((current) => ({ ...current, ...change }));
    setPublisherPage(1);
  };
  function toggleSort(field: SpecialCasePublisherSortField) {
    if (field === publisherSortField)
      setPublisherSortDirection((current) =>
        current === "asc" ? "desc" : "asc",
      );
    else {
      setPublisherSortField(field);
      setPublisherSortDirection(
        field === "publisherName" || field === "cleanedPublisherName"
          ? "asc"
          : "desc",
      );
    }
    setPublisherPage(1);
  }
  const marker = (field: SpecialCasePublisherSortField) =>
    publisherSortField === field
      ? publisherSortDirection === "asc"
        ? " ↑"
        : " ↓"
      : "";
  async function saveRows() {
    if (currentId)
      await action({
        action: "save_reviews",
        sourceVersionId: currentId,
        finalVersionId: selectedFinalBaselineId || null,
        entries: rows.map((row) => ({
          appId: row.appId,
          needReadjustment: row.needReadjustment,
          adjustmentMode: row.adjustmentMode,
          adjustedCleanedPublisherName: row.adjustedCleanedPublisherName,
          adjustedRevenueMultiplier: row.adjustedRevenueMultiplier,
          notes: row.notes,
        })),
      });
  }
  async function savePublisherReviews() {
    if (await action({ action: "save_publishers", entries: groups }))
      setPublisherReviewDirty(false);
  }

  return (
    <div className="workspace-page special-cases-page">
      <section className="page-banner">
        <div>
          <p className="page-kicker">Mapping App to Revenue Multiplier</p>
          <h1>Special Cases</h1>
          <p className="page-summary">
            Investigate apps belonging to suspected SensorTower publisher
            accounts, then save explicit per-app overrides.
          </p>
        </div>
      </section>
      <div className="special-cases-workflow-layout">
        <aside
          className="special-cases-section-sidebar"
          aria-label="Special Cases sections"
        >
          <p>On this page</p>
          <nav>
            {sectionLinks.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={activeSection === item.id ? "active" : undefined}
                aria-current={
                  activeSection === item.id ? "location" : undefined
                }
                onClick={() => setActiveSection(item.id)}
              >
                <span>{item.step}</span>
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="special-cases-workflow-content">
          <section
            id="special-cases-status"
            className="surface-card special-cases-anchor-section"
          >
            <div className="section-heading">
              <div>
                <h2>Workflow status</h2>
                <p>{message}</p>
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void refresh()}
                disabled={busy}
              >
                Refresh
              </button>
            </div>
          </section>
          <section
            id="special-cases-source"
            className="surface-card special-cases-anchor-section"
          >
            <div className="section-heading">
              <div>
                <h2>1. Load current App Full Info</h2>
                <p>
                  The source is joined to one explicitly selected committed Full
                  Mapping artifact by publisher ID.
                </p>
              </div>
            </div>
            <div className="special-cases-controls">
              <label className="settings-field">
                <span>Committed Full Mapping</span>
                <select
                  value={fullArtifactId}
                  onChange={(event) => setFullArtifactId(event.target.value)}
                  disabled={
                    !canMutate ||
                    Boolean(job && ["queued", "running"].includes(job.status))
                  }
                >
                  <option value="">Select committed Full Mapping</option>
                  {fullArtifacts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {short(item.id)} · {item.row_count} rows ·{" "}
                      {short(item.checksum_sha256)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button-primary"
                disabled={
                  !canMutate ||
                  !fullArtifactId ||
                  Boolean(job && ["queued", "running"].includes(job.status))
                }
                onClick={() => void startLoad()}
              >
                Load from Production
              </button>
            </div>
            {job ? (
              <article
                className={`enrichment-job-card enrichment-job-${job.status}`}
              >
                <div className="enrichment-job-heading">
                  <div>
                    <p className="field-label">Special Cases source job</p>
                    <strong>{short(job.id)}</strong>
                  </div>
                  <span className="enrichment-job-status">{job.status}</span>
                </div>
                <dl className="enrichment-job-details">
                  <div>
                    <dt>Stage</dt>
                    <dd>{job.stage}</dd>
                  </div>
                  <div>
                    <dt>Scanned apps</dt>
                    <dd>{job.scannedRecords.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Matched apps</dt>
                    <dd>{job.matchedRecords.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Pages</dt>
                    <dd>{job.pagesRead}</dd>
                  </div>
                </dl>
                <div
                  className={`enrichment-progress enrichment-progress-${job.status}`}
                >
                  <span className="enrichment-progress-indicator" />
                </div>
                <p className="muted-text">{job.message}</p>
                {job.error ? <p className="error-text">{job.error}</p> : null}
              </article>
            ) : null}
          </section>
          <section
            id="special-cases-versions"
            className="surface-card special-cases-anchor-section"
          >
            <div className="section-heading">
              <div>
                <h2>2. Source versions</h2>
                <p>
                  Production loads and historical baselines are immutable.
                  Select a baseline explicitly; loading production data never
                  changes your selection.
                </p>
              </div>
              <div>
                <input
                  ref={historicalBaselineInput}
                  className="visually-hidden"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadHistoricalBaseline(file);
                  }}
                />
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!canMutate}
                  onClick={() => historicalBaselineInput.current?.click()}
                >
                  {busy ? "Uploading…" : "Upload historical baseline CSV"}
                </button>
              </div>
            </div>
            <div className="special-cases-controls">
              <label className="settings-field">
                <span>Baseline used for Steps 3 and 4</span>
                <select
                  value={selectedBaselineId}
                  disabled={!canMutate || !baselineVersions.length}
                  onChange={(event) =>
                    setSelectedBaselineId(event.target.value)
                  }
                >
                  <option value="">
                    Select an uploaded or cumulative baseline
                  </option>
                  {baselineVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label} · {version.rowCount.toLocaleString()} apps
                      · {short(version.checksum)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button-secondary"
                disabled={
                  !canMutate ||
                  !selectedBaselineId ||
                  selectedBaselineId === comparisonId
                }
                onClick={() => void useSelectedBaseline()}
              >
                Use selected baseline
              </button>
            </div>
            <div className="special-cases-controls">
              <label className="settings-field">
                <span>Baseline to extend</span>
                <select
                  value={cumulativeBaseBaselineId}
                  disabled={!canMutate || !baselineVersions.length}
                  onChange={(event) =>
                    setCumulativeBaseBaselineId(event.target.value)
                  }
                >
                  <option value="">Select a historical or cumulative baseline</option>
                  {baselineVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label} · {version.rowCount.toLocaleString()} apps · {short(version.checksum)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>App Full Info source to merge</span>
                <select
                  value={cumulativeAppSourceId}
                  disabled={!canMutate || !appFullInfoVersions.length}
                  onChange={(event) =>
                    setCumulativeAppSourceId(event.target.value)
                  }
                >
                  <option value="">Select an App Full Info source</option>
                  {appFullInfoVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label} · {version.rowCount.toLocaleString()} apps · {short(version.fullArtifactChecksum)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button-primary"
                disabled={
                  !canMutate ||
                  !cumulativeBaseBaselineId ||
                  !cumulativeAppSourceId
                }
                onClick={() => void createCumulativeBaseline()}
              >
                Create cumulative baseline
              </button>
            </div>
            <p className="muted-text">
              Creating a cumulative baseline merges the two versions selected above for a future attempt. It does not change the current App Full Info source or the Steps 3 and 4 comparison.
            </p>
            <div className="special-cases-version-list">
              {overview?.sourceVersions.length ? (
                overview.sourceVersions.map((version) => (
                  <article
                    key={version.id}
                    className={
                      version.id === currentId
                        ? "special-cases-version selected"
                        : "special-cases-version"
                    }
                  >
                    <strong>{version.label}</strong>
                    <p>
                      {version.rowCount.toLocaleString()} apps ·{" "}
                      {version.sourceType === "uploaded_baseline"
                        ? "historical baseline"
                        : version.sourceType === "cumulative_baseline"
                          ? "cumulative baseline"
                          : version.sourceType}
                    </p>
                    {version.sourceType === "uploaded_baseline" ? (
                      <p className="muted-text">
                        {version.originalFilename || "Uploaded CSV"} · checksum{" "}
                        {short(version.checksum)}
                        {version.duplicateAppIdCount
                          ? ` · ${version.duplicateAppIdCount.toLocaleString()} duplicate app ID${version.duplicateAppIdCount === 1 ? " ignored" : "s ignored"}`
                          : ""}
                      </p>
                    ) : version.sourceType === "cumulative_baseline" ? (
                      <p className="muted-text">
                        Base {short(version.baseBaselineSourceVersionId)} +
                        merged App Full Info{" "}
                        {short(version.mergedCurrentSourceVersionId)} ·{" "}
                        {(version.addedAppCount ?? 0).toLocaleString()} added ·{" "}
                        {(version.overlappingAppCount ?? 0).toLocaleString()}{" "}
                        already known
                      </p>
                    ) : (
                      <p className="muted-text">
                        Full Mapping {short(version.fullArtifactId)}
                      </p>
                    )}
                    <p className="muted-text">
                      Created {date(version.createdAt)} by {version.createdBy}
                    </p>
                    <a
                      className="button button-secondary button-inline"
                      href={appApiPath(
                        `/api/special-cases/source-versions/${version.id}/download`,
                      )}
                    >
                      Download source CSV
                    </a>
                    {version.id === currentId ? (
                      <span className="active-version-label">Current</span>
                    ) : version.id === comparisonId ? (
                      <span className="active-version-label">Comparison</span>
                    ) : isComparisonBaseline(version.sourceType) ? (
                      <button
                        className="button button-secondary button-inline"
                        disabled={!canMutate}
                        onClick={() => {
                          setSelectedBaselineId(version.id);
                          void action({
                            action: "set_comparison",
                            sourceVersionId: version.id,
                          });
                        }}
                      >
                        Use as comparison
                      </button>
                    ) : (
                      <span className="muted-text">Production source</span>
                    )}
                  </article>
                ))
              ) : (
                <p className="muted-text">
                  No Special Cases source has been loaded yet. You can upload a
                  historical baseline before loading production data.
                </p>
              )}
            </div>
          </section>
          <section className="surface-card">
            <div className="section-heading">
              <div>
                <h2>3. Identify suspected publisher names</h2>
                <p>
                  Search, sort, or filter the review queue. Edits remain in the
                  full list even when a row is hidden by a filter.
                </p>
              </div>
              <button
                type="button"
                className="button button-primary"
                disabled={!canMutate || !publisherReviewDirty}
                onClick={() => void savePublisherReviews()}
              >
                {busy
                  ? "Saving…"
                  : publisherReviewDirty
                    ? "Save publisher review"
                    : "Publisher review saved"}
              </button>
            </div>
            <div className="special-cases-review-summary">
              <span>
                <strong>{groups.length.toLocaleString()}</strong> publisher
                names
              </span>
              <span>
                <strong>{suspectedCount.toLocaleString()}</strong> suspected
              </span>
              <span>
                <strong>{checkedCount.toLocaleString()}</strong> checked
              </span>
              <span>
                <strong>{filteredGroups.length.toLocaleString()}</strong>{" "}
                matching filters
              </span>
            </div>
            <div className="special-cases-publisher-toolbar">
              <input
                type="search"
                value={publisherFilters.search}
                placeholder="Search raw name, cleaned publisher, multiplier, or notes"
                onChange={(event) =>
                  updateFilters({ search: event.target.value })
                }
              />
              <select
                aria-label="Filter by cleaned publisher"
                value={publisherFilters.cleanedPublisherName}
                onChange={(event) =>
                  updateFilters({ cleanedPublisherName: event.target.value })
                }
              >
                <option value="">All cleaned publishers</option>
                {cleanedPublishers.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              <select
                aria-label="Filter by revenue multiplier"
                value={publisherFilters.revenueMultiplier}
                onChange={(event) =>
                  updateFilters({ revenueMultiplier: event.target.value })
                }
              >
                <option value="">All multipliers</option>
                {multipliers.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <select
                aria-label="Filter suspected status"
                value={publisherFilters.suspected}
                onChange={(event) =>
                  updateFilters({
                    suspected: event.target
                      .value as SpecialCasePublisherGroupFilters["suspected"],
                  })
                }
              >
                <option value="all">Suspected: all</option>
                <option value="yes">Suspected: yes</option>
                <option value="no">Suspected: no</option>
              </select>
              <select
                aria-label="Filter checked status"
                value={publisherFilters.checked}
                onChange={(event) =>
                  updateFilters({
                    checked: event.target
                      .value as SpecialCasePublisherGroupFilters["checked"],
                  })
                }
              >
                <option value="all">Checked: all</option>
                <option value="yes">Checked: yes</option>
                <option value="no">Checked: no</option>
              </select>
              <select
                aria-label="Filter new apps"
                value={publisherFilters.newApps}
                onChange={(event) =>
                  updateFilters({
                    newApps: event.target
                      .value as SpecialCasePublisherGroupFilters["newApps"],
                  })
                }
              >
                <option value="all">New apps: all</option>
                <option value="has_new">Has new apps</option>
                <option value="none">No new apps</option>
              </select>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPublisherFilters(blankFilters);
                  setPublisherPage(1);
                }}
              >
                Clear filters
              </button>
            </div>
            <div className="special-cases-quick-filters">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPublisherFilters((current) => ({
                    ...blankFilters,
                    ...current,
                    suspected: "no",
                    checked: "no",
                  }));
                  setPublisherPage(1);
                }}
              >
                Unreviewed
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPublisherFilters((current) => ({
                    ...blankFilters,
                    ...current,
                    suspected: "yes",
                  }));
                  setPublisherPage(1);
                }}
              >
                Suspected
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPublisherFilters((current) => ({
                    ...blankFilters,
                    ...current,
                    suspected: "yes",
                    checked: "no",
                  }));
                  setPublisherPage(1);
                }}
              >
                Suspected + unchecked
              </button>
            </div>
            <div className="table-shell">
              <table className="enterprise-table special-cases-publisher-table">
                <thead>
                  <tr>
                    {sortableColumns.map((column) => (
                      <th
                        key={column.field}
                        aria-sort={
                          publisherSortField === column.field
                            ? publisherSortDirection === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          className="special-cases-sort-button"
                          onClick={() => toggleSort(column.field)}
                        >
                          {column.label}
                          <span className="special-cases-sort-indicator">
                            {marker(column.field)}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {pageGroups.map((group) => (
                    <tr
                      key={group.publisherName}
                      className={
                        group.isSuspected
                          ? "special-cases-publisher-row-suspected"
                          : !group.isChecked
                            ? "special-cases-publisher-row-unchecked"
                            : undefined
                      }
                    >
                      <td>{group.publisherName}</td>
                      <td>{group.cleanedPublisherName || "—"}</td>
                      <td>{group.revenueMultiplier}</td>
                      <td>{group.appCount.toLocaleString()}</td>
                      <td>{group.newAppCount.toLocaleString()}</td>
                      <td>
                        <input
                          aria-label={`Mark ${group.publisherName} suspected`}
                          type="checkbox"
                          checked={group.isSuspected}
                          disabled={!canMutate}
                          onChange={(event) =>
                            updateGroup(group.publisherName, {
                              isSuspected: event.target.checked,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Mark ${group.publisherName} checked`}
                          type="checkbox"
                          checked={group.isChecked}
                          disabled={!canMutate}
                          onChange={(event) =>
                            updateGroup(group.publisherName, {
                              isChecked: event.target.checked,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Notes for ${group.publisherName}`}
                          value={group.notes}
                          disabled={!canMutate}
                          onChange={(event) =>
                            updateGroup(group.publisherName, {
                              notes: event.target.value,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                  {pageGroups.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty-table-cell">
                        No publisher names match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="pagination-controls">
              <span>
                Showing{" "}
                {filteredGroups.length
                  ? (visiblePublisherPage - 1) * publisherPageSize + 1
                  : 0}
                –
                {Math.min(
                  visiblePublisherPage * publisherPageSize,
                  filteredGroups.length,
                )}{" "}
                of {filteredGroups.length.toLocaleString()}
              </span>
              <label className="special-cases-page-size">
                Rows{" "}
                <select
                  value={publisherPageSize}
                  onChange={(event) => {
                    setPublisherPageSize(
                      Number(event.target.value) as (typeof pageSizes)[number],
                    );
                    setPublisherPage(1);
                  }}
                >
                  {pageSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button-secondary"
                disabled={visiblePublisherPage <= 1}
                onClick={() =>
                  setPublisherPage((current) => Math.max(1, current - 1))
                }
              >
                Previous
              </button>
              <span>
                Page {visiblePublisherPage} of {publisherPageCount}
              </span>
              <button
                className="button button-secondary"
                disabled={visiblePublisherPage >= publisherPageCount}
                onClick={() =>
                  setPublisherPage((current) =>
                    Math.min(publisherPageCount, current + 1),
                  )
                }
              >
                Next
              </button>
            </div>
          </section>
          <section className="surface-card">
            <div className="section-heading">
              <div>
                <h2>4. Investigate affected apps</h2>
                <p>
                  Review new suspected apps and the selected historical final
                  entries in one editable working set. Leave a final revenue
                  multiplier blank when the Full Mapping value should remain unchanged.
                </p>
              </div>
              <button
                className="button button-primary"
                type="button"
                disabled={!canMutate || !rows.length}
                onClick={() => void saveRows()}
              >
                Save app reviews
              </button>
            </div>
            <div className="special-cases-controls">
              <label className="settings-field">
                <span>Historical Final Special Cases baseline</span>
                <select
                  value={selectedFinalBaselineId}
                  disabled={!canMutate}
                  onChange={(event) =>
                    void action({
                      action: "set_final_baseline",
                      finalVersionId: event.target.value || null,
                    })
                  }
                >
                  <option value="">No historical final baseline</option>
                  {overview?.finalVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label} · {version.rowCount.toLocaleString()} rows
                    </option>
                  ))}
                </select>
              </label>
              <input
                ref={historicalFinalInput}
                className="visually-hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadHistoricalFinal(file);
                }}
              />
              <button
                type="button"
                className="button button-secondary"
                disabled={!canMutate}
                onClick={() => historicalFinalInput.current?.click()}
              >
                Upload historical final CSV
              </button>
              {selectedFinalBaselineId ? <span className="active-version-label">Baseline selected</span> : null}
            </div>
            <div className="special-cases-filters">
              <input
                value={search}
                placeholder="Search app, publisher, or ID"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
              <label>
                <input
                  type="checkbox"
                  checked={newOnly}
                  onChange={(event) => {
                    setNewOnly(event.target.checked);
                    setPage(1);
                  }}
                  disabled={!selectedFinalBaselineId}
                />{" "}
                New Special Cases only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={adjustmentsOnly}
                  onChange={(event) => {
                    setAdjustmentsOnly(event.target.checked);
                    setPage(1);
                  }}
                />{" "}
                Adjustments only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={incompleteOnly}
                  onChange={(event) => {
                    setIncompleteOnly(event.target.checked);
                    setPage(1);
                  }}
                />{" "}
                Incomplete only
              </label>
            </div>
            <div className="table-shell">
              <table className="enterprise-table special-cases-table">
                <thead>
                  <tr>
                    <th>app_id</th>
                    <th>name</th>
                    <th>url</th>
                    <th>publisher_id</th>
                    <th>publisher_name</th>
                    <th>cleaned_publisher_name</th>
                    <th>revenue_multiplier</th>
                    <th>Historical final</th>
                    <th>Include in final</th>
                    <th>Final cleaned_publisher_name</th>
                    <th>Final revenue_multiplier</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.appId}>
                      <td>
                        {row.appId}
                        {row.isNewSpecialCase ? (
                          <span className="bootstrap-artifact-badge">New special case</span>
                        ) : row.isHistoricalFinal ? (
                          <span className="active-version-label">Historical</span>
                        ) : null}
                      </td>
                      <td>{row.name}</td>
                      <td>
                        {row.url ? (
                          <a href={row.url} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{row.publisherId}</td>
                      <td>{row.publisherName}</td>
                      <td>{row.cleanedPublisherName || "—"}</td>
                      <td>{row.revenueMultiplier}</td>
                      <td>
                        {row.isHistoricalFinal ? (
                          <div className="special-cases-historical-final">
                            <span>{`${row.historicalCleanedPublisherName || "blank"} · ${row.historicalRevenueMultiplier}`}</span>
                            <button
                              type="button"
                              className="small-button"
                              disabled={!canMutate}
                              onClick={() =>
                                updateRow(row.appId, {
                                  needReadjustment: true,
                                  adjustmentMode:
                                    row.historicalCleanedPublisherName
                                      ? "set"
                                      : "clear",
                                  adjustedCleanedPublisherName:
                                    row.historicalCleanedPublisherName,
                                  adjustedRevenueMultiplier:
                                    row.historicalRevenueMultiplier,
                                })
                              }
                            >
                              Restore
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          disabled={!canMutate}
                          checked={row.needReadjustment}
                          onChange={(event) =>
                            updateRow(row.appId, {
                              needReadjustment: event.target.checked,
                              adjustmentMode: event.target.checked
                                ? row.adjustmentMode
                                : "",
                              adjustedCleanedPublisherName: event.target.checked
                                ? row.adjustedCleanedPublisherName
                                : "",
                              adjustedRevenueMultiplier: event.target.checked
                                ? row.adjustedRevenueMultiplier
                                : "",
                            })
                          }
                        />
                      </td>
                      <td>
                        {row.needReadjustment ? (
                          <div className="special-cases-adjustment">
                            <select
                              disabled={!canMutate}
                              value={row.adjustmentMode}
                              onChange={(event) =>
                                updateRow(row.appId, {
                                  adjustmentMode: event.target.value as
                                    "clear" | "set" | "",
                                  adjustedCleanedPublisherName:
                                    event.target.value === "clear"
                                      ? ""
                                      : row.adjustedCleanedPublisherName,
                                })
                              }
                            >
                              <option value="">Select action</option>
                              <option value="clear">
                                Clear cleaned publisher
                              </option>
                              <option value="set">Set cleaned publisher</option>
                            </select>
                            {row.adjustmentMode === "set" ? (
                              <select
                                disabled={!canMutate}
                                value={row.adjustedCleanedPublisherName}
                                onChange={(event) =>
                                  updateRow(row.appId, {
                                    adjustedCleanedPublisherName:
                                      event.target.value,
                                  })
                                }
                              >
                                <option value="">Select publisher</option>
                                {overview?.knownCleanedPublishers.map(
                                  (name) => (
                                    <option key={name}>{name}</option>
                                  ),
                                )}
                              </select>
                            ) : row.adjustmentMode === "clear" ? (
                              <span className="muted-text">Will be blank</span>
                            ) : null}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {row.needReadjustment ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            disabled={!canMutate}
                            value={row.adjustedRevenueMultiplier}
                            onChange={(event) =>
                              updateRow(row.appId, {
                                adjustedRevenueMultiplier: event.target.value,
                              })
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-controls">
              <span>{total.toLocaleString()} affected apps</span>
              <button
                className="button button-secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.max(1, Math.ceil(total / 25))}
              </span>
              <button
                className="button button-secondary"
                disabled={page >= Math.ceil(total / 25)}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </section>
          <section className="surface-card">
            <div className="section-heading">
              <div>
                <h2>5. Final Special Cases versions</h2>
                <p>
                  Save the reviewed working set, then publish, validate, commit,
                  and activate the immutable pipeline artifact.
                </p>
              </div>
            </div>
            <div className="special-cases-active-artifact">
              <div>
                <h3>Active Special Cases</h3>
                <p className="muted-text">
                  Artifact-mode ETL uses this committed override artifact alongside
                  the independently active Full Mapping.
                </p>
              </div>
              {activeSpecialCases ? (
                <div className="list-card">
                  <strong>{short(activeSpecialCases.artifact.id)}</strong>
                  <p>
                    {activeSpecialCases.artifact.row_count} rows · checksum{" "}
                    {short(activeSpecialCases.artifact.checksum_sha256)}
                  </p>
                  <span>
                    Activated {date(activeSpecialCases.activated_at)} by{" "}
                    {activeSpecialCases.activated_by || "—"}
                  </span>
                </div>
              ) : (
                <p className="muted-text">
                  No active Special Cases artifact. Artifact-mode ETL cannot use
                  Special Cases until an admin activates a committed version.
                </p>
              )}
            </div>
            <div className="special-cases-controls">
              <p className="muted-text">
                {selectedFinalBaselineId
                  ? `Using the selected historical final baseline. Edit or exclude its rows in Step 4 before saving.`
                  : overview?.finalVersions.length
                    ? "Select a Historical Final Special Cases baseline in Step 4 before saving."
                    : "No historical final exists yet. This will create the first Final Special Cases snapshot."}
              </p>
              <button
                className="button button-primary"
                disabled={!canMutate || !currentId || Boolean(overview?.finalVersions.length && !selectedFinalBaselineId)}
                onClick={() => void action({ action: "create_final" })}
              >
                Save Final Special Cases
              </button>
            </div>
            <div className="special-cases-version-list">
              {overview?.finalVersions.map((version) => {
                const artifact = findArtifactForSpecialCasesVersion(
                  version,
                  specialCasesArtifacts,
                );
                const isActive = artifact
                  ? isActiveSpecialCasesArtifact(artifact.id, activeSpecialCases)
                  : false;
                const publishReason = specialCasesPublishDisabledReason(
                  readiness,
                  artifact,
                );
                const commitReason = specialCasesCommitDisabledReason(
                  artifact,
                  readiness,
                );
                const activateReason = specialCasesActivationDisabledReason(
                  artifact,
                  activeSpecialCases,
                  readiness,
                );
                return (
                  <article
                    key={version.id}
                    className={`special-cases-version${isActive ? " special-cases-version-active" : ""}`}
                  >
                    <div className="special-cases-version-heading">
                      <div>
                        <strong>{version.label}</strong>
                        <p>
                          {version.rowCount} rows · local checksum{" "}
                          {short(version.checksum)} · Full Mapping{" "}
                          {short(version.fullArtifactId)}
                        </p>
                        <p className="muted-text">
                          Created {date(version.createdAt)} by {version.createdBy}
                        </p>
                      </div>
                      <div className="action-strip">
                        <a
                          className="button button-secondary button-inline"
                          href={appApiPath(
                            `/api/special-cases/versions/${version.id}/download`,
                          )}
                        >
                          Download local CSV
                        </a>
                        {artifact ? (
                          <>
                            <a
                              className="button button-secondary button-inline"
                              href={`/artifact-registry/${artifact.id}`}
                            >
                              View artifact
                            </a>
                            <a
                              className="button button-secondary button-inline"
                              href={appApiPath(
                                `/api/mapping-artifacts/artifacts/${artifact.id}/download`,
                              )}
                            >
                              Download pipeline CSV
                            </a>
                          </>
                        ) : null}
                        <button
                          className="button button-secondary button-inline"
                          type="button"
                          title={publishReason ?? undefined}
                          disabled={Boolean(publishReason) || publishingVersionId === version.id}
                          onClick={() => void publishSpecialCases(version.id)}
                        >
                          {publishingVersionId === version.id
                            ? "Publishing…"
                            : "Publish draft"}
                        </button>
                        {artifact ? (
                          <button
                            className="button button-secondary button-inline"
                            type="button"
                            title={commitReason ?? undefined}
                            disabled={Boolean(commitReason) || committingArtifactId === artifact.id}
                            onClick={() => void commitSpecialCases(artifact.id)}
                          >
                            {artifact.status === "committed"
                              ? "Committed"
                              : committingArtifactId === artifact.id
                                ? "Committing…"
                                : "Commit draft"}
                          </button>
                        ) : null}
                        {artifact && isActive ? (
                          <span className="active-version-label">Active</span>
                        ) : artifact ? (
                          <button
                            className="button button-primary button-inline"
                            type="button"
                            title={activateReason ?? undefined}
                            disabled={Boolean(activateReason) || activatingArtifactId === artifact.id}
                            onClick={() => void activateSpecialCases(artifact)}
                          >
                            {activatingArtifactId === artifact.id
                              ? "Activating…"
                              : "Activate"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {artifact ? (
                      <div className="special-cases-artifact-state">
                        <p>
                          Pipeline artifact {short(artifact.id)} · {artifact.status}
                          {isActive ? " · active" : ""}
                        </p>
                        <p>
                          Validation: {artifact.validation.valid
                            ? "Passed"
                            : "Requires review"}
                        </p>
                        {artifact.validation.blocking_errors.length ? (
                          <ul className="error-text">
                            {artifact.validation.blocking_errors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        ) : null}
                        {artifact.validation.warnings?.length ? (
                          <ul className="warning-text">
                            {artifact.validation.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <p className="muted-text">
                        Not published to the SensorTower artifact registry yet.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="special-cases-activation-history">
              <h3>Special Cases activation history</h3>
              {activationHistory.length ? (
                <div className="table-shell">
                  <table className="enterprise-table">
                    <thead>
                      <tr>
                        <th>Activated</th>
                        <th>Actor</th>
                        <th>New artifact</th>
                        <th>Previous artifact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activationHistory.map((event) => (
                        <tr key={String(event.id)}>
                          <td>{date(event.activated_at)}</td>
                          <td>{event.activated_by || "—"}</td>
                          <td>{short(event.artifact_id)}</td>
                          <td>
                            {event.previous_artifact_id
                              ? short(event.previous_artifact_id)
                              : "Initial activation"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-text">
                  No Special Cases activation has been recorded yet.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
