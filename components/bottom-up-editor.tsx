"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  BottomUpActivityLogEntry,
  BottomUpAppCandidate,
  BottomUpProductionSyncState,
  BottomUpReviewStatus,
  BottomUpRowDraft,
  BottomUpStep1PublisherRow,
  BottomUpVersionSnapshot,
  BottomUpWorkbenchState,
} from "@/lib/bottom-up/types";
import { createEmptyBottomUpRow, formatAuditDate } from "@/lib/bottom-up/workbench";
import { appApiPath } from "@/lib/app-path";

type BottomUpEditorProps = {
  initialState: BottomUpWorkbenchState;
  registeredPublisherNames: string[];
  registeredPublisherRevenueMultipliers: Record<string, string>;
};

type WorkbenchResponse = {
  state: BottomUpWorkbenchState;
  message?: string;
  error?: string;
  summary?: {
    sourceType?: "api" | "file";
    scannedRecords: number;
    relatedAppRecords: number;
    candidateRows: number;
    replacedCount: number;
    insertedCount: number;
    needsReviewCount: number;
  };
};

type ProductionSyncResponse = {
  syncStatus?: BottomUpProductionSyncState;
  started?: boolean;
  message?: string;
  error?: string;
};

type Step1PublishersResponse = {
  rows: Step1PublisherRow[];
  totalCount: number;
  totalPublisherCount: number;
  checkedPublisherCount: number;
  error?: string;
};

type RegistryResponse = {
  registry?: Array<{
    publisherName: string;
    revenueMultiplier: string;
  }>;
  error?: string;
};

type FilterField =
  | "all"
  | "cleanedPublisherName"
  | "publisherId"
  | "publisherName"
  | "revenueMultiplier"
  | "reviewStatus"
  | "notes"
  | "adder"
  | "addingDate";

type FilterRule = {
  id: string;
  field: FilterField;
  value: string;
};

type SortField = Exclude<FilterField, "all"> | "ordinal";
type SortDirection = "asc" | "desc";
type BatchAction = "update_status" | "delete_rows";
type WorkflowStep = "guide" | "step0" | "step1" | "step2" | "step3";

type Step1PublisherRow = BottomUpStep1PublisherRow;

type Step1FilterField =
  | "all"
  | "publisherName"
  | "cleanedPublisherName"
  | "isInVnPublisherList"
  | "isInLatestMapping"
  | "isChecked"
  | "publisherIds"
  | "appCount";

type Step1FilterRule = {
  id: string;
  field: Step1FilterField;
  value: string;
};

type Step1SortField = Exclude<Step1FilterField, "all">;

const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  all: "All Fields",
  cleanedPublisherName: "Cleaned Publisher",
  publisherId: "Publisher ID",
  publisherName: "Publisher Name",
  revenueMultiplier: "Revenue Multiplier",
  reviewStatus: "Status",
  notes: "Notes",
  adder: "Added By",
  addingDate: "Added At",
};

const SORTABLE_COLUMNS: Array<{ field: SortField; label: string }> = [
  { field: "ordinal", label: "ID" },
  { field: "cleanedPublisherName", label: "Cleaned Publisher" },
  { field: "publisherId", label: "Publisher ID" },
  { field: "publisherName", label: "Publisher Name" },
  { field: "revenueMultiplier", label: "Revenue Multiplier" },
  { field: "reviewStatus", label: "Status" },
  { field: "adder", label: "Added By" },
  { field: "addingDate", label: "Added At" },
  { field: "notes", label: "Notes" },
];

const STEP1_FILTER_FIELD_LABELS: Record<Step1FilterField, string> = {
  all: "All Fields",
  publisherName: "publisher_name",
  cleanedPublisherName: "cleaned_publisher_name",
  isInVnPublisherList: "is in VN Publisher list?",
  isInLatestMapping: "is in latest mapping?",
  isChecked: "Is Checked",
  publisherIds: "Publisher IDs",
  appCount: "Source App Rows",
};

const STEP1_SORTABLE_COLUMNS: Array<{ field: Step1SortField; label: string }> = [
  { field: "publisherName", label: "publisher_name" },
  { field: "cleanedPublisherName", label: "cleaned_publisher_name" },
  { field: "isInVnPublisherList", label: "is in VN Publisher list?" },
  { field: "isInLatestMapping", label: "is in latest mapping?" },
  { field: "isChecked", label: "Is Checked" },
  { field: "publisherIds", label: "publisher IDs" },
  { field: "appCount", label: "source app rows" },
];

const WORKFLOW_STEPS: Array<{ id: WorkflowStep; label: string; summary: string }> = [
  { id: "guide", label: "Guide", summary: "Understand the Bottom Up cleaning workflow." },
  { id: "step0", label: "Step 0", summary: "Load App Full Info and flag VN-related app rows." },
  { id: "step1", label: "Step 1", summary: "Map raw publisher names to cleaned VN publishers." },
  { id: "step2", label: "Step 2", summary: "Map publisher IDs to cleaned publishers and multipliers." },
  { id: "step3", label: "Step 3", summary: "Review and export the final staging-ready CSV." },
];

function normalizeSearchText(value: string) {
  return value.toLowerCase().trim();
}

function createFilterRule(): FilterRule {
  return {
    id: `filter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    field: "all",
    value: "",
  };
}

function createStep1FilterRule(): Step1FilterRule {
  return {
    id: `step1_filter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    field: "all",
    value: "",
  };
}

function createClientRowId() {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  return `bottom_up_row_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getRowFieldValue(row: BottomUpRowDraft, field: FilterField | SortField) {
  if (field === "all") {
    return [
      row.cleanedPublisherName,
      row.publisherId,
      row.publisherName,
      row.revenueMultiplier,
      row.reviewStatus,
      row.notes,
      row.adder,
      row.addingDate,
    ].join(" ");
  }

  if (field === "ordinal") {
    return String(row.ordinal);
  }

  return String(row[field] ?? "");
}

function rowMatchesFilters(row: BottomUpRowDraft, filters: FilterRule[]) {
  return filters.every((filter) => {
    const needle = normalizeSearchText(filter.value);
    if (!needle) {
      return true;
    }

    return normalizeSearchText(getRowFieldValue(row, filter.field)).includes(needle);
  });
}

function sortRows(rows: BottomUpRowDraft[], sortField: SortField | "", sortDirection: SortDirection) {
  if (!sortField) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftValue = getRowFieldValue(left, sortField);
    const rightValue = getRowFieldValue(right, sortField);
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const comparison =
      Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
        ? leftNumber - rightNumber
        : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });

    return sortDirection === "asc" ? comparison : -comparison;
  });
}

function getStep1FieldValue(row: Step1PublisherRow, field: Step1FilterField | Step1SortField) {
  const publisherIds = [...row.publisherIds].join(" ");
  if (field === "all") {
    return [
      row.publisherName,
      row.cleanedPublisherName,
      row.isInVnPublisherList ? "TRUE" : "FALSE",
      row.isInLatestMapping ? "TRUE" : "FALSE",
      row.isChecked ? "TRUE" : "FALSE",
      publisherIds,
      String(row.appCount),
    ].join(" ");
  }

  if (field === "publisherIds") {
    return publisherIds;
  }

  if (field === "appCount") {
    return String(row.appCount);
  }

  if (field === "isInVnPublisherList" || field === "isInLatestMapping" || field === "isChecked") {
    return row[field] ? "TRUE" : "FALSE";
  }

  return row[field];
}

function step1RowMatchesFilters(row: Step1PublisherRow, filters: Step1FilterRule[]) {
  return filters.every((filter) => {
    const needle = normalizeSearchText(filter.value);
    if (!needle) {
      return true;
    }

    return normalizeSearchText(getStep1FieldValue(row, filter.field)).includes(needle);
  });
}

function sortStep1Rows(rows: Step1PublisherRow[], sortField: Step1SortField | "", sortDirection: SortDirection) {
  if (!sortField) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftValue = getStep1FieldValue(left, sortField);
    const rightValue = getStep1FieldValue(right, sortField);
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const comparison =
      Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
        ? leftNumber - rightNumber
        : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });

    return sortDirection === "asc" ? comparison : -comparison;
  });
}

function getStoreUrl(appId: string) {
  const trimmed = appId.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d+$/.test(trimmed)) {
    return `https://apps.apple.com/app/id${trimmed}`;
  }

  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(trimmed)}`;
}

function PublisherNameWithApps({ publisher }: { publisher: Step1PublisherRow }) {
  const visibleApps = publisher.apps.slice(0, 30);
  return (
    <div className="publisher-hover-root">
      <span className="publisher-hover-name">{publisher.publisherName}</span>
      <div className="publisher-hover-card" role="tooltip">
        <strong>Associated apps</strong>
        {visibleApps.length === 0 ? (
          <p>No app names cached yet. Run Step 0 production load to refresh this hover data.</p>
        ) : (
          <ul>
            {visibleApps.map((app) => {
              const storeUrl = getStoreUrl(app.appId);
              return (
                <li key={`${app.appId}_${app.name}`}>
                  {storeUrl ? (
                    <a href={storeUrl} target="_blank" rel="noreferrer">
                      {app.name || app.appId}
                    </a>
                  ) : (
                    <span>{app.name || "Unnamed app"}</span>
                  )}
                  <small>{app.appId || "No app ID"}</small>
                </li>
              );
            })}
          </ul>
        )}
        {publisher.appCount > visibleApps.length ? (
          <span className="publisher-hover-more">
            +{formatCount(publisher.appCount - visibleApps.length)} more source app rows
          </span>
        ) : null}
      </div>
    </div>
  );
}

function cloneRows(rows: BottomUpRowDraft[]) {
  return structuredClone(rows);
}

function BooleanBadge({ value }: { value: boolean }) {
  return <span className={`boolean-badge ${value ? "boolean-true" : "boolean-false"}`}>{value ? "TRUE" : "FALSE"}</span>;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function BottomUpEditor({
  initialState,
  registeredPublisherNames,
  registeredPublisherRevenueMultipliers,
}: BottomUpEditorProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [publisherNameRegistry, setPublisherNameRegistry] = useState(registeredPublisherNames);
  const [publisherRevenueMultiplierRegistry, setPublisherRevenueMultiplierRegistry] = useState(
    registeredPublisherRevenueMultipliers,
  );
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("guide");
  const [operatorName, setOperatorName] = useState(initialState.operatorName);
  const [draftFilters, setDraftFilters] = useState<FilterRule[]>([createFilterRule()]);
  const [appliedFilters, setAppliedFilters] = useState<FilterRule[]>([]);
  const [sortField, setSortField] = useState<SortField | "">("");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [step1DraftFilters, setStep1DraftFilters] = useState<Step1FilterRule[]>([createStep1FilterRule()]);
  const [step1AppliedFilters, setStep1AppliedFilters] = useState<Step1FilterRule[]>([]);
  const [step1SortField, setStep1SortField] = useState<Step1SortField | "">("");
  const [step1SortDirection, setStep1SortDirection] = useState<SortDirection>("asc");
  const [step1RowsPerPage, setStep1RowsPerPage] = useState(50);
  const [step1Page, setStep1Page] = useState(1);
  const [step1Rows, setStep1Rows] = useState<Step1PublisherRow[]>([]);
  const [step1TotalCount, setStep1TotalCount] = useState(0);
  const [step1TotalPublisherCount, setStep1TotalPublisherCount] = useState(initialState.publisherCandidateCount);
  const [step1CheckedPublisherCount, setStep1CheckedPublisherCount] = useState(initialState.checkedPublisherCount);
  const [step1LoadState, setStep1LoadState] = useState<"idle" | "loading">("idle");
  const [step1SelectAllFiltered, setStep1SelectAllFiltered] = useState(false);
  const [selectedStep1PublisherNames, setSelectedStep1PublisherNames] = useState<Set<string>>(new Set());
  const [step1BatchCheckedValue, setStep1BatchCheckedValue] = useState<"checked" | "unchecked">("checked");
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [page, setPage] = useState(1);
  const [batchAction, setBatchAction] = useState<BatchAction>("update_status");
  const [batchStatus, setBatchStatus] = useState<BottomUpReviewStatus>("needs_review");
  const [isBusy, setIsBusy] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [statusMessage, setStatusMessage] = useState("Bottom-up editor ready.");
  const [hasLoadedWorkbench, setHasLoadedWorkbench] = useState(initialState.rows.length > 0);
  const isFirstRenderRef = useRef(true);
  const latestRowsRef = useRef(state.rows);
  const suppressNextAutoSaveRef = useRef(false);
  const completedProductionSyncRef = useRef("");

  const latestLogs: BottomUpActivityLogEntry[] = state.logs.slice(0, 6);
  const latestVersions: BottomUpVersionSnapshot[] = state.versions.slice(0, 4);
  const productionSync = state.productionSync;
  const productionSyncIsRunning = productionSync.status === "queued" || productionSync.status === "running";
  const lastProductionLoadLabel =
    productionSync.lastSuccessfulLoad?.completedAt
      ? new Date(productionSync.lastSuccessfulLoad.completedAt).toLocaleString()
      : "Never loaded";
  const productionSyncProgress =
    productionSync.expectedRecordCount > 0
      ? Math.min(99, Math.round((productionSync.scannedRecords / productionSync.expectedRecordCount) * 100))
      : 0;
  const registeredPublisherNameOptions = useMemo(
    () => [...new Set(publisherNameRegistry.map((name) => name.trim()).filter(Boolean))],
    [publisherNameRegistry],
  );
  const normalizedRevenueMultiplierByPublisher = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [publisherName, revenueMultiplier] of Object.entries(publisherRevenueMultiplierRegistry)) {
      const normalizedName = publisherName.trim().toLowerCase();
      if (normalizedName) {
        mapping.set(normalizedName, revenueMultiplier.trim() || "1");
      }
    }
    return mapping;
  }, [publisherRevenueMultiplierRegistry]);
  const getRegisteredRevenueMultiplier = (cleanedPublisherName: string) =>
    normalizedRevenueMultiplierByPublisher.get(cleanedPublisherName.trim().toLowerCase()) ?? "1";
  const needsReviewCount = state.rows.filter((row) => row.reviewStatus === "needs_review").length;
  const uniqueCleanedPublishers = new Set(state.rows.map((row) => row.cleanedPublisherName).filter(Boolean)).size;
  const finalRows = useMemo(
    () =>
      state.rows
        .filter((row) => row.cleanedPublisherName && row.publisherId && row.publisherName)
        .map((row) => ({
          ...row,
          revenueMultiplier: getRegisteredRevenueMultiplier(row.cleanedPublisherName),
        })),
    [normalizedRevenueMultiplierByPublisher, state.rows],
  );
  const effectiveRows = useMemo(
    () =>
      state.rows.map((row) => ({
        ...row,
        revenueMultiplier: getRegisteredRevenueMultiplier(row.cleanedPublisherName),
      })),
    [normalizedRevenueMultiplierByPublisher, state.rows],
  );
  const step0PreviewRows = state.appCandidates.slice(0, 250);
  const step1TotalPages = Math.max(1, Math.ceil(step1TotalCount / step1RowsPerPage));
  const pagedStep1PublisherRows = step1Rows;
  const selectedStep1Count = step1SelectAllFiltered ? step1TotalCount : selectedStep1PublisherNames.size;
  const allPagedStep1Selected =
    pagedStep1PublisherRows.length > 0 &&
    (step1SelectAllFiltered ||
      pagedStep1PublisherRows.every((publisher) => selectedStep1PublisherNames.has(publisher.publisherName)));
  const duplicatePublisherIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of state.rows) {
      if (!row.publisherId) {
        continue;
      }
      counts.set(row.publisherId, (counts.get(row.publisherId) ?? 0) + 1);
    }
    return [...counts.values()].filter((count) => count > 1).length;
  }, [state.rows]);
  const filteredRows = useMemo(
    () => sortRows(effectiveRows.filter((row) => rowMatchesFilters(row, appliedFilters)), sortField, sortDirection),
    [appliedFilters, effectiveRows, sortDirection, sortField],
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const pagedRows = filteredRows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const selectedCount = selectedRowIds.size;

  useEffect(() => {
    latestRowsRef.current = state.rows;
  }, [state.rows]);

  useEffect(() => {
    void reloadWorkbench();
    void loadPublisherRegistry();
  }, []);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setStep1Page((current) => Math.min(current, step1TotalPages));
  }, [step1TotalPages]);

  useEffect(() => {
    if (workflowStep !== "step1") {
      return;
    }

    void fetchStep1PublisherPage();
  }, [step1AppliedFilters, step1Page, step1RowsPerPage, step1SortDirection, step1SortField, workflowStep]);

  useEffect(() => {
    if (!hasLoadedWorkbench) {
      return;
    }

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    if (suppressNextAutoSaveRef.current) {
      suppressNextAutoSaveRef.current = false;
      return;
    }

    setSaveState("dirty");
    const handle = window.setTimeout(() => {
      void saveRows(
        latestRowsRef.current,
        "All changes saved automatically.",
        true,
      );
    }, 900);

    return () => window.clearTimeout(handle);
  }, [hasLoadedWorkbench, state.rows]);

  useEffect(() => {
    if (saveState === "saved") {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveState]);

  useEffect(() => {
    if (!productionSyncIsRunning) {
      return;
    }

    let cancelled = false;
    const refreshSyncStatus = async () => {
      try {
        const response = await fetch(appApiPath("/api/bottom-up/production-sync"), { cache: "no-store" });
        const payload = (await response.json()) as ProductionSyncResponse;
        if (!response.ok || !payload.syncStatus || cancelled) {
          return;
        }

        setState((current) => ({ ...current, productionSync: payload.syncStatus as BottomUpProductionSyncState }));
        if (payload.syncStatus.status !== "queued" && payload.syncStatus.status !== "running" && completedProductionSyncRef.current !== payload.syncStatus.updatedAt) {
          completedProductionSyncRef.current = payload.syncStatus.updatedAt;
          setStatusMessage(payload.syncStatus.message);
          void reloadWorkbench();
        }
      } catch {
        // Keep the last persisted status visible; the next poll can recover from a transient network issue.
      }
    };

    void refreshSyncStatus();
    const handle = window.setInterval(() => void refreshSyncStatus(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [productionSyncIsRunning]);

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

  function applyServerState(
    nextState: BottomUpWorkbenchState,
    message: string,
    options: { refresh?: boolean } = {},
  ) {
    suppressNextAutoSaveRef.current = true;
    setState(nextState);
    latestRowsRef.current = nextState.rows;
    setStep1CheckedPublisherCount(nextState.checkedPublisherCount);
    setHasLoadedWorkbench(true);
    setSaveState("saved");
    setStatusMessage(message);
    if (options.refresh) {
      startTransition(() => router.refresh());
    }
  }

  async function saveRows(
    rows: BottomUpRowDraft[],
    message = "Saved bottom-up rows.",
    quiet = false,
  ) {
    if (!hasLoadedWorkbench) {
      return;
    }

    if (!quiet) {
      setIsBusy(true);
    }
    setSaveState("saving");
    try {
      const response = await fetch(appApiPath("/api/bottom-up/workbench"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName, rows }),
      });
      const payload = await parseResponse(response);
      applyServerState(payload.state, message, { refresh: !quiet });
    } catch (error) {
      setSaveState("dirty");
      setStatusMessage(error instanceof Error ? error.message : "Failed to save bottom-up rows.");
    } finally {
      if (!quiet) {
        setIsBusy(false);
      }
    }
  }

  async function reloadWorkbench() {
    setIsBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/bottom-up/workbench?operatorName=${encodeURIComponent(operatorName)}`), {
        cache: "no-store",
      });
      const payload = await parseResponse(response);
      applyServerState(payload.state, "Reloaded bottom-up workbench.", { refresh: true });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to reload bottom-up workbench.");
    } finally {
      setIsBusy(false);
    }
  }

  async function loadPublisherRegistry() {
    try {
      const response = await fetch(appApiPath("/api/top-down/registry"), { cache: "no-store" });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as RegistryResponse) : ({} as RegistryResponse);
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load registered publishers.");
      }
      const registry = payload.registry ?? [];
      setPublisherNameRegistry(
        registry
          .map((publisher) => publisher.publisherName.trim())
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
      );
      setPublisherRevenueMultiplierRegistry(
        Object.fromEntries(
          registry
            .map((publisher) => [publisher.publisherName.trim(), publisher.revenueMultiplier.trim() || "1"] as const)
            .filter(([publisherName]) => Boolean(publisherName)),
        ),
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load registered publishers.");
    }
  }

  function stampRow(row: BottomUpRowDraft) {
    return {
      ...row,
      id: row.id || createClientRowId(),
      adder: row.adder || operatorName,
      addingDate: row.addingDate || formatAuditDate(),
    };
  }

  function setRows(nextRows: BottomUpRowDraft[]) {
    const normalized = nextRows.map((row, index) => ({ ...row, ordinal: index + 1 }));
    latestRowsRef.current = normalized;
    setState((current) => ({ ...current, rows: normalized }));
  }

  async function fetchStep1PublisherPage(options: { quiet?: boolean; pageOverride?: number } = {}) {
    if (!options.quiet) {
      setStep1LoadState("loading");
    }
    try {
      const query = new URLSearchParams({
        page: String(options.pageOverride ?? step1Page),
        pageSize: String(step1RowsPerPage),
        sortField: step1SortField,
        sortDirection: step1SortDirection,
        filters: JSON.stringify(step1AppliedFilters),
      });
      const response = await fetch(appApiPath(`/api/bottom-up/step1-publishers?${query.toString()}`), {
        cache: "no-store",
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Step1PublishersResponse) : ({} as Step1PublishersResponse);
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load Step 1 publisher names.");
      }
      setStep1Rows(payload.rows ?? []);
      setStep1TotalCount(payload.totalCount ?? 0);
      setStep1TotalPublisherCount(payload.totalPublisherCount ?? 0);
      setStep1CheckedPublisherCount(payload.checkedPublisherCount ?? 0);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load Step 1 publisher names.");
    } finally {
      setStep1LoadState("idle");
    }
  }

  async function toggleStep1CheckedPublisherName(publisherName: string, checked: boolean) {
    try {
      const response = await fetch(appApiPath("/api/bottom-up/step1-publishers/check"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorName,
          checked,
          mode: "selected",
          publisherNames: [publisherName],
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Step1PublishersResponse) : ({} as Step1PublishersResponse);
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update Step 1 checked state.");
      }
      setStep1Rows((current) =>
        current.map((publisher) => (publisher.publisherName === publisherName ? { ...publisher, isChecked: checked } : publisher)),
      );
      setStep1CheckedPublisherCount(payload.checkedPublisherCount ?? step1CheckedPublisherCount);
      setStatusMessage(`${checked ? "Marked" : "Unmarked"} ${publisherName} as checked in Step 1.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update Step 1 checked state.");
    }
  }

  function toggleSelectedStep1PublisherName(publisherName: string) {
    setStep1SelectAllFiltered(false);
    setSelectedStep1PublisherNames((current) => {
      const next = new Set(current);
      if (next.has(publisherName)) {
        next.delete(publisherName);
      } else {
        next.add(publisherName);
      }
      return next;
    });
  }

  function toggleAllPagedStep1PublisherNames(checked: boolean) {
    setStep1SelectAllFiltered(false);
    setSelectedStep1PublisherNames((current) => {
      const next = new Set(current);
      for (const publisher of pagedStep1PublisherRows) {
        if (checked) {
          next.add(publisher.publisherName);
        } else {
          next.delete(publisher.publisherName);
        }
      }
      return next;
    });
  }

  function selectAllFilteredStep1PublisherNames() {
    setStep1SelectAllFiltered(true);
    setSelectedStep1PublisherNames(new Set());
    setStatusMessage(`Selected all ${formatCount(step1TotalCount)} Step 1 publisher names matching the applied filter.`);
  }

  function clearSelectedStep1PublisherNames() {
    setStep1SelectAllFiltered(false);
    setSelectedStep1PublisherNames(new Set());
    setStatusMessage("Cleared Step 1 publisher-name selection.");
  }

  async function runStep1BatchCheckedAction() {
    if (selectedStep1Count === 0) {
      setStatusMessage("Select Step 1 publisher names before running the batch check action.");
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch(appApiPath("/api/bottom-up/step1-publishers/check"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorName,
          checked: step1BatchCheckedValue === "checked",
          mode: step1SelectAllFiltered ? "filtered" : "selected",
          publisherNames: [...selectedStep1PublisherNames],
          filters: step1AppliedFilters,
          sortField: step1SortField,
          sortDirection: step1SortDirection,
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Step1PublishersResponse) : ({} as Step1PublishersResponse);
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update Step 1 checked names.");
      }
      setStep1CheckedPublisherCount(payload.checkedPublisherCount ?? step1CheckedPublisherCount);
      setStep1SelectAllFiltered(false);
      setSelectedStep1PublisherNames(new Set());
      await fetchStep1PublisherPage({ quiet: true });
      setStatusMessage(`Marked ${formatCount(selectedStep1Count)} Step 1 publisher names as ${step1BatchCheckedValue}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update Step 1 checked names.");
    } finally {
      setIsBusy(false);
    }
  }

  function updateRow(rowId: string, patch: Partial<BottomUpRowDraft>) {
    setRows(state.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function updateCleanedPublisherName(rawPublisherName: string, cleanedPublisherName: string, publisherIds: string[] = []) {
    const normalizedRawPublisherName = rawPublisherName.trim();
    const normalizedCleanedPublisherName = cleanedPublisherName.trim();
    const existingPublisherIds = new Set(
      state.rows
        .filter((row) => row.publisherName === rawPublisherName)
        .map((row) => row.publisherId)
        .filter(Boolean),
    );
    const nextRows = state.rows.map((row) =>
        row.publisherName === rawPublisherName
          ? {
              ...row,
              cleanedPublisherName,
              reviewStatus: cleanedPublisherName.trim() ? row.reviewStatus : "needs_review",
            }
          : row,
    );

    if (normalizedCleanedPublisherName) {
      for (const publisherId of publisherIds) {
        if (!publisherId || existingPublisherIds.has(publisherId)) {
          continue;
        }

        nextRows.push(
          stampRow({
            ...createEmptyBottomUpRow(nextRows.length + 1),
            publisherName: rawPublisherName,
            publisherId,
            cleanedPublisherName,
            revenueMultiplier: getRegisteredRevenueMultiplier(cleanedPublisherName),
            reviewStatus: "needs_review",
          }),
        );
        existingPublisherIds.add(publisherId);
      }
    }

    setRows(nextRows);
    setStep1Rows((current) =>
      current.map((publisher) =>
        publisher.publisherName === normalizedRawPublisherName
          ? {
              ...publisher,
              cleanedPublisherName,
              isInLatestMapping: Boolean(normalizedCleanedPublisherName),
              isInVnPublisherList:
                Boolean(normalizedCleanedPublisherName) &&
                registeredPublisherNameOptions.some(
                  (publisherName) =>
                    publisherName.trim().toLowerCase() === normalizedCleanedPublisherName.toLowerCase(),
                ),
            }
          : publisher,
      ),
    );
    setStatusMessage(`Updated cleaned publisher mapping for ${rawPublisherName}.`);
  }

  function addRow() {
    const nextRows = [...state.rows, stampRow(createEmptyBottomUpRow(state.rows.length + 1))];
    setRows(nextRows);
    setPage(Math.max(1, Math.ceil(nextRows.length / rowsPerPage)));
    setStatusMessage("Added a new bottom-up row.");
  }

  function insertBelow(rowId: string) {
    const index = state.rows.findIndex((row) => row.id === rowId);
    if (index < 0) {
      return;
    }

    const nextRows = [...state.rows];
    nextRows.splice(index + 1, 0, stampRow(createEmptyBottomUpRow(index + 2)));
    setRows(nextRows);
    setStatusMessage(`Inserted a row below row ${index + 1}.`);
  }

  function deleteRow(rowId: string) {
    if (!window.confirm("Are you sure you want to delete this publisher mapping row?")) {
      return;
    }

    setRows(state.rows.filter((row) => row.id !== rowId));
    setSelectedRowIds((current) => {
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
    setStatusMessage("Deleted one bottom-up row.");
  }

  function toggleSort(field: SortField) {
    if (sortField !== field) {
      setSortField(field);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    setSortField("");
    setSortDirection("asc");
  }

  function toggleStep1Sort(field: Step1SortField) {
    setStep1SelectAllFiltered(false);
    setSelectedStep1PublisherNames(new Set());
    if (step1SortField !== field) {
      setStep1SortField(field);
      setStep1SortDirection("asc");
      return;
    }

    if (step1SortDirection === "asc") {
      setStep1SortDirection("desc");
      return;
    }

    setStep1SortField("");
    setStep1SortDirection("asc");
  }

  function toggleSelected(rowId: string) {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  function toggleAllPagedRows(checked: boolean) {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      for (const row of pagedRows) {
        if (checked) {
          next.add(row.id);
        } else {
          next.delete(row.id);
        }
      }
      return next;
    });
  }

  function updateDraftFilter(filterId: string, patch: Partial<FilterRule>) {
    setDraftFilters((current) =>
      current.map((filter) => (filter.id === filterId ? { ...filter, ...patch } : filter)),
    );
  }

  function removeDraftFilter(filterId: string) {
    setDraftFilters((current) => {
      const next = current.filter((filter) => filter.id !== filterId);
      return next.length > 0 ? next : [createFilterRule()];
    });
  }

  function applyFilters() {
    setAppliedFilters(draftFilters.filter((filter) => filter.value.trim()));
    setPage(1);
    setSelectedRowIds(new Set());
    setStatusMessage("Applied bottom-up filters.");
  }

  function clearFilters() {
    const next = [createFilterRule()];
    setDraftFilters(next);
    setAppliedFilters([]);
    setPage(1);
    setStatusMessage("Cleared bottom-up filters.");
  }

  function updateStep1DraftFilter(filterId: string, patch: Partial<Step1FilterRule>) {
    setStep1DraftFilters((current) =>
      current.map((filter) => (filter.id === filterId ? { ...filter, ...patch } : filter)),
    );
  }

  function removeStep1DraftFilter(filterId: string) {
    setStep1DraftFilters((current) => {
      const next = current.filter((filter) => filter.id !== filterId);
      return next.length > 0 ? next : [createStep1FilterRule()];
    });
  }

  function applyStep1Filters() {
    setStep1AppliedFilters(step1DraftFilters.filter((filter) => filter.value.trim()));
    setStep1Page(1);
    setStep1SelectAllFiltered(false);
    setSelectedStep1PublisherNames(new Set());
    setStatusMessage("Applied Step 1 publisher-name filters.");
  }

  function clearStep1Filters() {
    const next = [createStep1FilterRule()];
    setStep1DraftFilters(next);
    setStep1AppliedFilters([]);
    setStep1Page(1);
    setStep1SelectAllFiltered(false);
    setSelectedStep1PublisherNames(new Set());
    setStatusMessage("Cleared Step 1 publisher-name filters.");
  }

  function runBatchAction() {
    if (selectedCount === 0) {
      setStatusMessage("Select rows before running a batch action.");
      return;
    }

    if (batchAction === "delete_rows" && !window.confirm(`Are you sure you want to delete ${selectedCount} selected rows?`)) {
      return;
    }

    const selected = selectedRowIds;
    const nextRows =
      batchAction === "delete_rows"
        ? state.rows.filter((row) => !selected.has(row.id))
        : state.rows.map((row) => {
            if (!selected.has(row.id)) {
              return row;
            }

            return { ...row, reviewStatus: batchStatus };
          });

    setRows(nextRows);
    setSelectedRowIds(new Set());
    setStatusMessage(`Applied ${batchAction.replaceAll("_", " ")} to ${selectedCount} rows.`);
  }

  async function importCsv(file: File | null) {
    if (!file) {
      return;
    }

    setIsBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("operatorName", operatorName);
      const response = await fetch(appApiPath("/api/bottom-up/import"), {
        method: "POST",
        body: formData,
      });
      const payload = await parseResponse(response);
      applyServerState(payload.state, payload.message ?? `Imported ${file.name}.`, { refresh: true });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to import CSV.");
    } finally {
      setIsBusy(false);
    }
  }

  async function syncFromProduction() {
    setIsBusy(true);
    try {
      const response = await fetch(appApiPath("/api/bottom-up/production-sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName }),
      });
      const payload = (await response.json()) as ProductionSyncResponse;
      if (!response.ok || !payload.syncStatus) {
        throw new Error(payload.error || "Failed to start production App Full Info load.");
      }
      setState((current) => ({ ...current, productionSync: payload.syncStatus as BottomUpProductionSyncState }));
      setStatusMessage(payload.message || payload.syncStatus.message);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load production App Full Info.");
    } finally {
      setIsBusy(false);
    }
  }

  async function exportCsv() {
    setIsBusy(true);
    try {
      const response = await fetch(appApiPath(`/api/bottom-up/export?operatorName=${encodeURIComponent(operatorName)}`), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to export bottom-up CSV.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const fileName =
        response.headers.get("Content-Disposition")?.match(/filename=\"([^\"]+)\"/)?.[1] ??
        "mapping_publisher_to_publisherids_revenue_multiplier_bottom_up.csv";
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
      await reloadWorkbench();
      setStatusMessage(`Exported ${fileName}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to export CSV.");
    } finally {
      setIsBusy(false);
    }
  }

  async function exportStep1FilteredCsv() {
    setIsBusy(true);
    try {
      const query = new URLSearchParams({
        operatorName,
        filters: JSON.stringify(step1AppliedFilters),
        sortField: step1SortField,
        sortDirection: step1SortDirection,
      });
      const response = await fetch(appApiPath(`/api/bottom-up/step1-publishers/export?${query.toString()}`), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to export filtered Step 1 publisher names.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const fileName =
        response.headers.get("Content-Disposition")?.match(/filename=\"([^\"]+)\"/)?.[1] ??
        "bottom_up_step1_publisher_names_filtered.csv";
      const rowCount = Number(response.headers.get("X-Export-Row-Count") ?? step1TotalCount);
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
      await reloadWorkbench();
      setStatusMessage(`Exported ${formatCount(rowCount)} filtered Step 1 publisher names to ${fileName}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to export filtered Step 1 publisher names.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveVersion() {
    setIsBusy(true);
    try {
      const response = await fetch(appApiPath("/api/bottom-up/versions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName }),
      });
      const payload = await parseResponse(response);
      applyServerState(payload.state, "Saved a bottom-up version snapshot.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save version.");
    } finally {
      setIsBusy(false);
    }
  }

  const allPagedSelected = pagedRows.length > 0 && pagedRows.every((row) => selectedRowIds.has(row.id));

  return (
    <div className="workspace-page">
      <section className="page-banner">
        <div>
          <p className="page-kicker">Bottom Up Preparation</p>
          <h1>Mapping Publisher to Publisher ID and Revenue Multiplier</h1>
          <p className="page-summary">
            Map raw SensorTower publisher IDs back to cleaned VN publishers and the multiplier used by staging.
          </p>
        </div>
        <div className="banner-pill-stack">
          <span className="metric-pill">{state.rows.length} rows</span>
          <span className="metric-pill">{uniqueCleanedPublishers} cleaned publishers</span>
          <span className="metric-pill">{saveState === "saving" ? "Saving..." : saveState === "dirty" ? "Unsaved changes" : "Saved"}</span>
        </div>
      </section>

      <section className="action-strip">
        <Link className="button button-secondary" href="/">
          Back to Overview
        </Link>
        <label className="button button-secondary" htmlFor="bottom-up-upload">
          Upload CSV
        </label>
        <input
          id="bottom-up-upload"
          className="sr-only"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void importCsv(event.target.files?.[0] ?? null)}
        />
        <button type="button" className="button button-secondary" onClick={addRow} disabled={isBusy}>
          Add Row
        </button>
        <button type="button" className="button button-secondary" onClick={() => void syncFromProduction()} disabled={isBusy || productionSyncIsRunning}>
          Load from Production
        </button>
        <button type="button" className="button button-primary" onClick={() => void saveRows(state.rows)} disabled={isBusy}>
          Save Changes
        </button>
        <button type="button" className="button button-secondary" onClick={() => void saveVersion()} disabled={isBusy}>
          Save Version
        </button>
        <button type="button" className="button button-secondary" onClick={() => void exportCsv()} disabled={isBusy}>
          Export CSV
        </button>
        <label className="field-label" htmlFor="bottom-up-operator">
          Operator
        </label>
        <input
          id="bottom-up-operator"
          className="input enterprise-input compact-input"
          value={operatorName}
          onChange={(event) => setOperatorName(event.target.value)}
        />
        <div className="status-inline">{isBusy ? "Working..." : statusMessage}</div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-label">Rows</span>
          <strong>{state.rows.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Needs Review</span>
          <strong>{needsReviewCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Duplicate Publisher IDs</span>
          <strong>{duplicatePublisherIds}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Versions</span>
          <strong>{state.versions.length}</strong>
        </article>
      </section>

      <section className="workflow-tabs" aria-label="Bottom Up workflow steps">
        {WORKFLOW_STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`workflow-tab ${workflowStep === step.id ? "workflow-tab-active" : ""}`}
            onClick={() => setWorkflowStep(step.id)}
          >
            <strong>{step.label}</strong>
            <span>{step.summary}</span>
          </button>
        ))}
      </section>

      <section className="content-grid content-grid-wide">
        <div className="surface-card">
          <div className="section-heading">
            <div>
              <h2>{WORKFLOW_STEPS.find((step) => step.id === workflowStep)?.label}</h2>
              <p>{WORKFLOW_STEPS.find((step) => step.id === workflowStep)?.summary}</p>
            </div>
          </div>

          {workflowStep === "guide" ? (
            <div className="workflow-guide">
              <article className="workflow-guide-card">
                <span>Step 0</span>
                <h3>Upload App Full Info and check VN apps</h3>
                <p>
                  The web app reads production App Full Info from the VN Strategy system, removes invalid publisher names,
                  and flags rows where VN appears in valid countries, top countries, or publisher country.
                </p>
              </article>
              <article className="workflow-guide-card">
                <span>Step 1</span>
                <h3>Identify cleaned_publisher_name</h3>
                <p>
                  Review each raw SensorTower publisher name and map it to the cleaned VN publisher name. Existing mappings
                  are used as reference so you only focus on new or suspicious publishers.
                </p>
              </article>
              <article className="workflow-guide-card">
                <span>Step 2</span>
                <h3>Map publisher_id to cleaned publisher</h3>
                <p>
                  Confirm the publisher ID, raw publisher name, cleaned publisher name, and revenue multiplier. This is the
                  main manual cleaning screen.
                </p>
              </article>
              <article className="workflow-guide-card">
                <span>Step 3</span>
                <h3>Final file for download</h3>
                <p>
                  Export only rows with enough mapped fields into the final CSV schema consumed by staging:
                  cleaned publisher, publisher ID, publisher name, revenue multiplier.
                </p>
              </article>
            </div>
          ) : null}

          {workflowStep === "step0" ? (
            <>
              <div className="step-toolbar">
                <button type="button" className="button button-primary" onClick={() => void syncFromProduction()} disabled={isBusy || productionSyncIsRunning}>
                  {productionSyncIsRunning ? "Loading Production..." : "Load App Full Info from Production"}
                </button>
                <span className="muted-text">
                  Showing {formatCount(step0PreviewRows.length)} of {formatCount(state.appCandidateCount)} VN-related app rows.
                </span>
                <span className="muted-text">Last loaded on: {lastProductionLoadLabel}</span>
              </div>
              <div className={`production-sync-panel production-sync-panel-${productionSync.status}`}>
                <div>
                  <strong>What happens when you load again?</strong>
                  <p>
                    Step 0 candidates are refreshed from production. Step 2 rows are upserted by publisher_id:
                    matching publisher IDs are refreshed, new publisher IDs are inserted, and manual cleaned publisher
                    names, multipliers, status, notes, and audit fields are preserved where possible.
                  </p>
                </div>
                {productionSync.status === "queued" || productionSync.status === "running" ? (
                  <div className="progress-block" aria-live="polite">
                    <div className="progress-meta">
                      <span>{productionSync.stage}</span>
                      <span>
                        {productionSync.expectedRecordCount > 0
                          ? `${formatCount(productionSync.scannedRecords)} of ${formatCount(productionSync.expectedRecordCount)} rows`
                          : `${formatCount(productionSync.scannedRecords)} rows read`}
                      </span>
                    </div>
                    <div
                      className={`determinate-progress ${productionSync.expectedRecordCount > 0 ? "" : "determinate-progress-indeterminate"}`}
                      aria-label="Production sync progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={productionSyncProgress}
                      role="progressbar"
                    >
                      <span style={{ width: `${productionSync.expectedRecordCount > 0 ? productionSyncProgress : 38}%` }} />
                    </div>
                    <p className="progress-note">
                      {productionSync.message} You can leave this page and return later; the current status is saved by the server.
                    </p>
                  </div>
                ) : productionSync.status === "succeeded" ? (
                  <div className="production-sync-result production-sync-result-success" aria-live="polite">
                    <strong>Last production load completed</strong>
                    <p>{productionSync.message}</p>
                    <span>
                      {productionSync.completedAt ? new Date(productionSync.completedAt).toLocaleString() : "Completion time unavailable"}
                      {productionSync.summary ? ` | ${formatCount(productionSync.summary.replacedCount)} refreshed, ${formatCount(productionSync.summary.insertedCount)} inserted` : ""}
                    </span>
                  </div>
                ) : productionSync.status === "failed" ? (
                  <div className="production-sync-result production-sync-result-error" role="alert">
                    <strong>Last production load failed</strong>
                    <p>{productionSync.message}</p>
                    <span>
                      {productionSync.completedAt ? new Date(productionSync.completedAt).toLocaleString() : "Failure time unavailable"}
                      {productionSync.lastSuccessfulLoad?.completedAt
                        ? ` | Published dataset remains from ${new Date(productionSync.lastSuccessfulLoad.completedAt).toLocaleString()}`
                        : " | No successful production dataset has been recorded yet."}
                    </span>
                    <button type="button" className="button button-secondary" onClick={() => void syncFromProduction()} disabled={isBusy}>
                      Retry load
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="table-shell step0-table-shell">
                <table className="enterprise-table dense-table">
                  <thead>
                    <tr>
                      <th>app_id</th>
                      <th>name</th>
                      <th>publisher_name</th>
                      <th>publisher_id</th>
                      <th>humanized_name</th>
                      <th>valid_countries has VN</th>
                      <th>top_countries has VN</th>
                      <th>publisher_country Vietnam</th>
                      <th>Related to VN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {step0PreviewRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="empty-table-cell">
                          No production App Full Info rows loaded yet. Click the production load button above.
                        </td>
                      </tr>
                    ) : (
                      step0PreviewRows.map((candidate) => (
                        <tr key={candidate.id}>
                          <td>{candidate.appId}</td>
                          <td>{candidate.name}</td>
                          <td>{candidate.publisherName}</td>
                          <td>{candidate.publisherId}</td>
                          <td>{candidate.humanizedName}</td>
                          <td><BooleanBadge value={candidate.hasVnValidCountry} /></td>
                          <td><BooleanBadge value={candidate.hasVnTopCountry} /></td>
                          <td><BooleanBadge value={candidate.isVietnamPublisherCountry} /></td>
                          <td><BooleanBadge value={candidate.relatedToVn} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {workflowStep === "step1" ? (
            <>
              <div className="table-command-rail">
                <div className="pager-cluster">
                  <span className="muted-text">
                    {step1LoadState === "loading" ? "Loading Step 1 publisher names..." : `Showing ${formatCount(step1TotalCount)} of ${formatCount(step1TotalPublisherCount)} publisher names.`}
                  </span>
                  <button type="button" className="button button-secondary" onClick={() => setStep1Page((current) => Math.max(1, current - 1))} disabled={step1Page <= 1}>
                    Previous
                  </button>
                  <span>Page {step1Page} of {step1TotalPages}</span>
                  <button type="button" className="button button-secondary" onClick={() => setStep1Page((current) => Math.min(step1TotalPages, current + 1))} disabled={step1Page >= step1TotalPages}>
                    Next
                  </button>
                  <label className="field-label" htmlFor="step1-rows">
                    Rows
                  </label>
                  <select id="step1-rows" className="input select-input" value={step1RowsPerPage} onChange={(event) => { setStep1RowsPerPage(Number(event.target.value)); setStep1Page(1); setStep1SelectAllFiltered(false); setSelectedStep1PublisherNames(new Set()); }}>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                </div>

                <div className="workbench-control-row">
                  <div className="filter-builder">
                    <span className="field-label">Step 1 Filters</span>
                    {step1DraftFilters.map((filter) => (
                      <div key={filter.id} className="filter-rule">
                        <select className="input select-input" value={filter.field} onChange={(event) => updateStep1DraftFilter(filter.id, { field: event.target.value as Step1FilterField })}>
                          {Object.entries(STEP1_FILTER_FIELD_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        <input
                          className="input enterprise-input filter-value-input"
                          value={filter.value}
                          onChange={(event) => updateStep1DraftFilter(filter.id, { value: event.target.value })}
                          placeholder="Contains... TRUE/FALSE for flags"
                        />
                        <button type="button" className="button button-secondary button-compact" onClick={() => removeStep1DraftFilter(filter.id)}>Remove</button>
                      </div>
                    ))}
                    <div className="filter-actions">
                      <button type="button" className="button button-secondary button-compact" onClick={() => setStep1DraftFilters((current) => [...current, createStep1FilterRule()])}>Add Filter</button>
                      <button type="button" className="button button-primary button-compact" onClick={applyStep1Filters}>Apply Filters</button>
                      <button type="button" className="button button-secondary button-compact" onClick={clearStep1Filters}>Clear Filters</button>
                    </div>
                  </div>

                  <div className="batch-controls">
                    <span className="field-label">Step 1 Batch</span>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void exportStep1FilteredCsv()}
                      disabled={isBusy || step1TotalCount === 0}
                      title="Exports every Step 1 publisher name matching the applied filters, across all pages."
                    >
                      Export Filtered CSV
                    </button>
                    <select className="input select-input" value={step1BatchCheckedValue} onChange={(event) => setStep1BatchCheckedValue(event.target.value as "checked" | "unchecked")}>
                      <option value="checked">Mark checked</option>
                      <option value="unchecked">Mark unchecked</option>
                    </select>
                    <button type="button" className="button button-secondary" onClick={selectAllFilteredStep1PublisherNames} disabled={step1TotalCount === 0}>
                      Select Filtered
                    </button>
                    <button type="button" className="button button-secondary" onClick={clearSelectedStep1PublisherNames} disabled={selectedStep1Count === 0}>
                      Clear Selection
                    </button>
                    <button type="button" className="button button-secondary" onClick={runStep1BatchCheckedAction} disabled={selectedStep1Count === 0}>
                      Apply to Selected
                    </button>
                    <span className="muted-text">{formatCount(selectedStep1Count)} selected / {formatCount(step1CheckedPublisherCount)} checked</span>
                  </div>
                </div>
              </div>

              <div className="table-shell popover-table-shell">
                <table className="enterprise-table dense-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allPagedStep1Selected}
                          onChange={(event) => toggleAllPagedStep1PublisherNames(event.target.checked)}
                          aria-label="Select visible Step 1 publisher names"
                        />
                      </th>
                      {STEP1_SORTABLE_COLUMNS.map((column) => (
                        <th key={column.field}>
                          <button type="button" className="sort-header" onClick={() => toggleStep1Sort(column.field)}>
                            {column.label}
                            <span>{step1SortField === column.field ? (step1SortDirection === "asc" ? "ASC" : "DESC") : "SORT"}</span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {step1LoadState === "loading" ? (
                      <tr>
                        <td colSpan={STEP1_SORTABLE_COLUMNS.length + 1} className="empty-table-cell">
                          Loading publisher names from the server...
                        </td>
                      </tr>
                    ) : pagedStep1PublisherRows.length === 0 ? (
                      <tr>
                        <td colSpan={STEP1_SORTABLE_COLUMNS.length + 1} className="empty-table-cell">
                          No publisher names match the applied Step 1 filters.
                        </td>
                      </tr>
                    ) : (
                      pagedStep1PublisherRows.map((publisher) => (
                        <tr key={publisher.publisherName}>
                          <td>
                            <input
                              type="checkbox"
                              checked={step1SelectAllFiltered || selectedStep1PublisherNames.has(publisher.publisherName)}
                              onChange={() => toggleSelectedStep1PublisherName(publisher.publisherName)}
                              aria-label={`Select ${publisher.publisherName}`}
                            />
                          </td>
                          <td><PublisherNameWithApps publisher={publisher} /></td>
                          <td>
                            <select
                              className="input select-input table-input"
                              value={publisher.cleanedPublisherName}
                              onChange={(event) => updateCleanedPublisherName(publisher.publisherName, event.target.value, publisher.publisherIds)}
                              disabled={registeredPublisherNameOptions.length === 0}
                            >
                              <option value="">
                                {registeredPublisherNameOptions.length === 0 ? "No registered publishers found" : "Select registered publisher"}
                              </option>
                              {publisher.cleanedPublisherName && !registeredPublisherNameOptions.includes(publisher.cleanedPublisherName) ? (
                                <option value={publisher.cleanedPublisherName} disabled>
                                  {publisher.cleanedPublisherName} (not registered)
                                </option>
                              ) : null}
                              {registeredPublisherNameOptions.map((publisherName) => (
                                <option key={publisherName} value={publisherName}>
                                  {publisherName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td><BooleanBadge value={publisher.isInVnPublisherList} /></td>
                          <td><BooleanBadge value={publisher.isInLatestMapping} /></td>
                          <td>
                            <label className="checkbox-inline">
                              <input
                                type="checkbox"
                                checked={publisher.isChecked}
                                onChange={(event) =>
                                  toggleStep1CheckedPublisherName(publisher.publisherName, event.target.checked)
                                }
                              />
                              Checked
                            </label>
                          </td>
                          <td>{[...publisher.publisherIds].join(", ") || "-"}</td>
                          <td>{formatCount(publisher.appCount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="table-footer-actions">
                <span className="muted-text">
                  Tip: sort headers cycle ascending, descending, then unsorted.
                </span>
                <div className="pager-cluster">
                  <button type="button" className="button button-secondary" onClick={() => setStep1Page((current) => Math.max(1, current - 1))} disabled={step1Page <= 1}>Previous</button>
                  <span>Page {step1Page} of {step1TotalPages}</span>
                  <button type="button" className="button button-secondary" onClick={() => setStep1Page((current) => Math.min(step1TotalPages, current + 1))} disabled={step1Page >= step1TotalPages}>Next</button>
                </div>
              </div>
            </>
          ) : null}

          {workflowStep === "step2" ? (
          <>
          <div className="table-command-rail">
            <div className="pager-cluster">
              <button type="button" className="button button-secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" className="button button-secondary" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
                Next
              </button>
              <label className="field-label" htmlFor="bottom-up-rows">
                Rows
              </label>
              <select id="bottom-up-rows" className="input select-input" value={rowsPerPage} onChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(1); }}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="workbench-control-row">
              <div className="filter-builder">
                <span className="field-label">Filters</span>
                {draftFilters.map((filter) => (
                  <div key={filter.id} className="filter-rule">
                    <select className="input select-input" value={filter.field} onChange={(event) => updateDraftFilter(filter.id, { field: event.target.value as FilterField })}>
                      {Object.entries(FILTER_FIELD_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <input className="input enterprise-input filter-value-input" value={filter.value} onChange={(event) => updateDraftFilter(filter.id, { value: event.target.value })} placeholder="Contains..." />
                    <button type="button" className="button button-secondary button-compact" onClick={() => removeDraftFilter(filter.id)}>Remove</button>
                  </div>
                ))}
                <div className="filter-actions">
                  <button type="button" className="button button-secondary button-compact" onClick={() => setDraftFilters((current) => [...current, createFilterRule()])}>Add Filter</button>
                  <button type="button" className="button button-primary button-compact" onClick={applyFilters}>Apply Filters</button>
                  <button type="button" className="button button-secondary button-compact" onClick={clearFilters}>Clear Filters</button>
                </div>
              </div>

              <div className="batch-controls">
                <label className="field-label" htmlFor="bottom-up-batch-action">Batch Action</label>
                <select id="bottom-up-batch-action" className="input select-input" value={batchAction} onChange={(event) => setBatchAction(event.target.value as BatchAction)}>
                  <option value="update_status">Update Status</option>
                  <option value="delete_rows">Delete Rows</option>
                </select>
                {batchAction === "update_status" ? (
                  <select className="input select-input" value={batchStatus} onChange={(event) => setBatchStatus(event.target.value as BottomUpReviewStatus)}>
                    <option value="needs_review">needs_review</option>
                    <option value="confirmed">confirmed</option>
                    <option value="seeded">seeded</option>
                  </select>
                ) : null}
                <button type="button" className="button button-secondary" onClick={runBatchAction} disabled={selectedCount === 0}>
                  Apply to Selected
                </button>
                <span className="muted-text">{selectedCount} selected</span>
              </div>
            </div>
          </div>

          <div className="table-shell">
            <table className="enterprise-table dense-table">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allPagedSelected} onChange={(event) => toggleAllPagedRows(event.target.checked)} /></th>
                  {SORTABLE_COLUMNS.map((column) => (
                    <th key={column.field}>
                      <button type="button" className="sort-header" onClick={() => toggleSort(column.field)}>
                        {column.label}
                        <span>{sortField === column.field ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                  ))}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={SORTABLE_COLUMNS.length + 2} className="empty-table-cell">
                      No rows match the current view. Add a row or clear filters.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row) => (
                    <tr key={row.id}>
                      <td><input type="checkbox" checked={selectedRowIds.has(row.id)} onChange={() => toggleSelected(row.id)} /></td>
                      <td>{row.ordinal}</td>
                      <td><input className="input enterprise-input table-input" value={row.cleanedPublisherName} onChange={(event) => updateRow(row.id, { cleanedPublisherName: event.target.value })} /></td>
                      <td><input className="input enterprise-input table-input" value={row.publisherId} onChange={(event) => updateRow(row.id, { publisherId: event.target.value })} /></td>
                      <td><input className="input enterprise-input table-input" value={row.publisherName} onChange={(event) => updateRow(row.id, { publisherName: event.target.value })} /></td>
                      <td>
                        <input
                          className="input enterprise-input mini-input"
                          value={getRegisteredRevenueMultiplier(row.cleanedPublisherName)}
                          readOnly
                          title="Revenue multiplier is maintained on the registered publisher in the home Publisher Queue."
                        />
                      </td>
                      <td>
                        <select className="input select-input" value={row.reviewStatus} onChange={(event) => updateRow(row.id, { reviewStatus: event.target.value as BottomUpReviewStatus })}>
                          <option value="needs_review">needs_review</option>
                          <option value="confirmed">confirmed</option>
                          <option value="seeded">seeded</option>
                        </select>
                      </td>
                      <td><input className="input enterprise-input table-input" value={row.adder || "Recorded automatically"} readOnly /></td>
                      <td><input className="input enterprise-input mini-input" value={row.addingDate || "Recorded automatically"} readOnly /></td>
                      <td><textarea className="input notes-input" value={row.notes} onChange={(event) => updateRow(row.id, { notes: event.target.value })} /></td>
                      <td>
                        <div className="row-action-stack">
                          <button type="button" className="button button-secondary" onClick={() => insertBelow(row.id)}>Insert Below</button>
                          <button type="button" className="button button-danger" onClick={() => deleteRow(row.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer-actions">
            <button type="button" className="button button-secondary" onClick={addRow}>
              Add Row
            </button>
            <div className="pager-cluster">
              <button type="button" className="button button-secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" className="button button-secondary" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>Next</button>
            </div>
          </div>
          </>
          ) : null}

          {workflowStep === "step3" ? (
            <>
              <div className="step-toolbar">
                <button type="button" className="button button-primary" onClick={() => void exportCsv()} disabled={isBusy}>
                  Export Final CSV
                </button>
                <span className="muted-text">
                  {formatCount(finalRows.length)} rows ready for final download.
                </span>
              </div>
              <div className="table-shell">
                <table className="enterprise-table dense-table">
                  <thead>
                    <tr>
                      <th>cleaned_publisher_name</th>
                      <th>publisher_id</th>
                      <th>publisher_name</th>
                      <th>revenue_multiplier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="empty-table-cell">
                          No final rows yet. Fill cleaned publisher mappings in Step 1 or Step 2.
                        </td>
                      </tr>
                    ) : (
                      finalRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.cleanedPublisherName}</td>
                          <td>{row.publisherId}</td>
                          <td>{row.publisherName}</td>
                          <td>{row.revenueMultiplier}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>

        <div className="side-column">
          <section className="surface-card">
            <div className="section-heading"><h2>Recent Versions</h2></div>
            <div className="list-stack">
              {latestVersions.length === 0 ? <div className="list-card muted-text">No versions saved yet.</div> : latestVersions.map((version) => (
                <div key={version.id} className="list-card">
                  <strong>{version.label}</strong>
                  <p>{new Date(version.createdAt).toLocaleString()}</p>
                  <span>{version.rowCount} rows captured</span>
                </div>
              ))}
            </div>
          </section>
          <section className="surface-card">
            <div className="section-heading"><h2>Activity Log</h2></div>
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
