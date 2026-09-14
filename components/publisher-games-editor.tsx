"use client";

import Link from "next/link";
import { ChangeEvent, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { appApiPath } from "@/lib/app-path";
import {
  createEmptyRow,
  createIdleResolutionState,
  createPlatformEntry,
  flattenPublisherRows,
  formatAuditDate,
} from "@/lib/top-down/workbench";
import type {
  PublisherPlatformEntry,
  PublisherRowDraft,
  SensorTowerLocalAppLookupResponse,
  SensorTowerOption,
  SensorTowerPlatform,
  SensorTowerResolveResponse,
  TopDownWorkbenchState,
} from "@/lib/top-down/types";

type PublisherGamesEditorProps = {
  initialState: TopDownWorkbenchState;
  publisherKey: string;
};

type FilterField =
  | "all_fields"
  | "game_name"
  | "review_status"
  | "sensor_tower_link"
  | "sensor_tower_link_valid"
  | "sensor_tower_game_name"
  | "sensor_tower_unified_app_id"
  | "ios_app_ids"
  | "android_app_ids"
  | "added_by"
  | "notes";

type FilterRule = {
  id: string;
  field: FilterField;
  value: string;
};

type WorkbenchResponse = {
  state: TopDownWorkbenchState;
  message?: string;
  error?: string;
};

type BatchAction = "update_status" | "fetch_sensortower" | "delete_rows";
type SortDirection = "asc" | "desc";
type SortField =
  | "ordinal"
  | "game_name"
  | "review_status"
  | "sensor_tower_link"
  | "sensor_tower_link_valid"
  | "sensor_tower_game_name"
  | "sensor_tower_unified_app_id"
  | "ios_app_ids"
  | "android_app_ids"
  | "added_by"
  | "notes";

const FILTER_FIELD_OPTIONS: Array<{ value: FilterField; label: string }> = [
  { value: "all_fields", label: "All Fields" },
  { value: "game_name", label: "Game Name" },
  { value: "review_status", label: "Status" },
  { value: "sensor_tower_link", label: "SensorTower Link" },
  { value: "sensor_tower_link_valid", label: "SensorTower Link Valid" },
  { value: "sensor_tower_game_name", label: "SensorTower Game Name" },
  { value: "sensor_tower_unified_app_id", label: "SensorTower unified_app_id" },
  { value: "ios_app_ids", label: "iOS App IDs" },
  { value: "android_app_ids", label: "Android App IDs" },
  { value: "added_by", label: "Added By" },
  { value: "notes", label: "Notes" },
];

let filterRuleCounter = 0;

function createFilterRule(field: FilterField = "all_fields", value = ""): FilterRule {
  filterRuleCounter += 1;
  return {
    id: `filter-${filterRuleCounter}`,
    field,
    value,
  };
}

const PAGE_SIZE_OPTIONS = [10, 20, 50];

type SensorTowerLinkValidity = "missing" | "unchecked" | "valid" | "invalid";

const MAX_UNDO_STEPS = 50;

function getEntriesForPlatform(row: PublisherRowDraft, platform: SensorTowerPlatform) {
  return platform === "ios" ? row.iosApps : row.androidApps;
}

function getOptionsForPlatform(row: PublisherRowDraft, platform: SensorTowerPlatform) {
  return platform === "ios" ? row.sensorTowerResolution.iosOptions : row.sensorTowerResolution.androidOptions;
}

function createEntryFromOption(option: SensorTowerOption): PublisherPlatformEntry {
  return {
    appId: option.appId,
    publisherName: option.publisherName,
    appName: option.appName,
    source: "resolved",
  };
}

function reconcileEntriesWithOptions(entries: PublisherPlatformEntry[], options: SensorTowerOption[]) {
  if (options.length === 0) {
    return entries;
  }

  const optionLookup = new Map(options.map((option) => [option.appId, option]));
  return entries
    .map((entry) => optionLookup.get(entry.appId))
    .filter((option): option is SensorTowerOption => Boolean(option))
    .map(createEntryFromOption);
}

function buildResolutionMessage(row: PublisherRowDraft) {
  const { status, unifiedAppId, errorMessage, iosOptions, androidOptions } = row.sensorTowerResolution;

  if (status === "resolving") {
    return {
      tone: "info",
      text: "Resolving SensorTower link...",
    };
  }

  if (status === "failed") {
    return {
      tone: "error",
      text: errorMessage || "SensorTower resolution failed. Manual entry mode is available below.",
    };
  }

  if (status === "empty") {
    return {
      tone: "warning",
      text: errorMessage || "No child app IDs were returned. Manual entry mode is available below.",
    };
  }

  if (status === "resolved") {
    return {
      tone: "success",
      text: `Unified app ${unifiedAppId} resolved. ${iosOptions.length} iOS and ${androidOptions.length} Android choices ready.`,
    };
  }

  if (row.sensorTowerLink.trim()) {
    return {
      tone: "muted",
      text: "Use the SensorTower fetch button to load app choices for this link.",
    };
  }

  return {
    tone: "muted",
    text: "Paste a SensorTower overview link or use manual entry below.",
  };
}

function getSensorTowerLinkValidity(row: PublisherRowDraft): SensorTowerLinkValidity {
  const link = row.sensorTowerLink.trim();
  if (!link) {
    return "missing";
  }

  if (row.sensorTowerResolution.status === "resolved") {
    return "valid";
  }

  if (row.sensorTowerResolution.status === "failed" || row.sensorTowerResolution.status === "empty") {
    return "invalid";
  }

  return "unchecked";
}

function getSensorTowerLinkValidityLabel(validity: SensorTowerLinkValidity) {
  switch (validity) {
    case "valid":
      return "TRUE";
    case "invalid":
      return "FALSE";
    case "missing":
      return "No link";
    case "unchecked":
    default:
      return "Not checked";
  }
}

function getSensorTowerLinkValidityTone(validity: SensorTowerLinkValidity) {
  switch (validity) {
    case "valid":
      return "success";
    case "invalid":
      return "error";
    case "missing":
      return "muted";
    case "unchecked":
    default:
      return "warning";
  }
}

function getSortValue(row: PublisherRowDraft, field: SortField) {
  switch (field) {
    case "ordinal":
      return row.ordinal;
    case "review_status": {
      const statusOrder: Record<PublisherRowDraft["reviewStatus"], number> = {
        needs_review: 0,
        confirmed: 1,
        seeded: 2,
      };
      return statusOrder[row.reviewStatus];
    }
    case "sensor_tower_link_valid": {
      const validityOrder: Record<SensorTowerLinkValidity, number> = {
        invalid: 0,
        unchecked: 1,
        valid: 2,
        missing: 3,
      };
      return validityOrder[getSensorTowerLinkValidity(row)];
    }
    default:
      return getFilterableRowValue(row, field);
  }
}

function getFilterableRowValue(row: PublisherRowDraft, field: FilterField) {
  switch (field) {
    case "game_name":
      return row.gameName;
    case "review_status":
      return row.reviewStatus;
    case "sensor_tower_link":
      return row.sensorTowerLink;
    case "sensor_tower_link_valid":
      return getSensorTowerLinkValidity(row);
    case "sensor_tower_game_name":
      return row.sensorTowerResolution.resolvedGameName;
    case "sensor_tower_unified_app_id":
      return row.sensorTowerResolution.unifiedAppId;
    case "ios_app_ids":
      return row.iosApps.map((entry) => [entry.appId, entry.publisherName, entry.appName].join(" ")).join(" ");
    case "android_app_ids":
      return row.androidApps.map((entry) => [entry.appId, entry.publisherName, entry.appName].join(" ")).join(" ");
    case "added_by":
      return [row.adder, row.addingDate].join(" ");
    case "notes":
      return row.notes;
    case "all_fields":
    default:
      return [
        row.gameName,
        row.reviewStatus,
        row.sensorTowerLink,
        getSensorTowerLinkValidity(row),
        row.sensorTowerResolution.resolvedGameName,
        row.sensorTowerResolution.unifiedAppId,
        row.adder,
        row.addingDate,
        row.notes,
        ...row.iosApps.map((entry) => [entry.appId, entry.publisherName, entry.appName].join(" ")),
        ...row.androidApps.map((entry) => [entry.appId, entry.publisherName, entry.appName].join(" ")),
      ].join(" ");
  }
}

function getFilterPlaceholder(field: FilterField) {
  return field === "all_fields" ? "Search all fields" : `Filter ${field.replaceAll("_", " ")}`;
}

function doesRowMatchFilter(row: PublisherRowDraft, filter: FilterRule) {
  const filterValue = filter.value.trim().toLowerCase();
  if (!filterValue) {
    return true;
  }

  if (filter.field === "review_status") {
    return row.reviewStatus.toLowerCase() === filterValue;
  }

  if (filter.field === "sensor_tower_link_valid") {
    return getSensorTowerLinkValidity(row) === filterValue;
  }

  return getFilterableRowValue(row, filter.field)
    .toLowerCase()
    .includes(filterValue);
}

function hasActiveFilterValues(filters: FilterRule[]) {
  return filters.some((filter) => filter.value.trim() !== "");
}

function collectMatchingRowIds(rows: PublisherRowDraft[], filters: FilterRule[]) {
  return rows.filter((row) => filters.every((filter) => doesRowMatchFilter(row, filter))).map((row) => row.id);
}

export function PublisherGamesEditor({ initialState, publisherKey }: PublisherGamesEditorProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  const changeVersionRef = useRef(0);
  const [undoStack, setUndoStack] = useState<PublisherRowDraft[][]>([]);
  const [redoStack, setRedoStack] = useState<PublisherRowDraft[][]>([]);
  const [operatorName, setOperatorName] = useState(initialState.operatorName);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<BatchAction>("update_status");
  const [batchStatus, setBatchStatus] = useState<PublisherRowDraft["reviewStatus"]>("needs_review");
  const [filters, setFilters] = useState<FilterRule[]>([createFilterRule()]);
  const [appliedFilterRowIds, setAppliedFilterRowIds] = useState<string[] | null>(null);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [resolvingRowIds, setResolvingRowIds] = useState<string[]>([]);
  const [validatingManualKeys, setValidatingManualKeys] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Publisher editor ready.");

  const selectedPublisher = useMemo(
    () => state.publishers.find((publisher) => publisher.key === publisherKey) ?? null,
    [publisherKey, state.publishers],
  );

  const flattenedCount = useMemo(
    () => (selectedPublisher ? flattenPublisherRows([selectedPublisher]).length : 0),
    [selectedPublisher],
  );

  const invalidSensorTowerRowCount = useMemo(
    () =>
      selectedPublisher
        ? selectedPublisher.rows.filter((row) => getSensorTowerLinkValidity(row) === "invalid").length
        : 0,
    [selectedPublisher],
  );

  function sortRowsForDisplay(rows: PublisherRowDraft[]) {
    if (!sortField || !sortDirection) {
      return rows;
    }

    const normalizedRows = rows.map((row, index) => ({
      row,
      index,
      value: getSortValue(row, sortField),
    }));

    normalizedRows.sort((left, right) => {
      const leftValue = left.value;
      const rightValue = right.value;

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        if (leftValue !== rightValue) {
          return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
        }
      } else {
        const comparison = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, {
          sensitivity: "base",
          numeric: true,
        });
        if (comparison !== 0) {
          return sortDirection === "asc" ? comparison : -comparison;
        }
      }

      return left.index - right.index;
    });

    return normalizedRows.map((item) => item.row);
  }

  const filteredRows = useMemo(() => {
    if (!selectedPublisher) {
      return [];
    }

    if (!appliedFilterRowIds) {
      return selectedPublisher.rows;
    }

    const appliedSet = new Set(appliedFilterRowIds);
    return selectedPublisher.rows.filter((row) => appliedSet.has(row.id));
  }, [appliedFilterRowIds, selectedPublisher]);

  const sortedRows = useMemo(() => sortRowsForDisplay(filteredRows), [filteredRows, sortDirection, sortField]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pagedRows = sortedRows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const pagedRowIds = pagedRows.map((row) => row.id);
  const selectedSet = new Set(selectedRowIds);
  const selectedCount = selectedRowIds.length;
  const allPagedSelected = pagedRowIds.length > 0 && pagedRowIds.every((rowId) => selectedSet.has(rowId));
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  function cloneRows(rows: PublisherRowDraft[]) {
    return structuredClone(rows);
  }

  function resetHistory(rows: PublisherRowDraft[]) {
    void rows;
    setUndoStack([]);
    setRedoStack([]);
  }

  function pushUndoSnapshot(rows: PublisherRowDraft[]) {
    setUndoStack((current) => [...current, cloneRows(rows)].slice(-MAX_UNDO_STEPS));
    setRedoStack([]);
  }

  function commitState(
    nextStateOrUpdater:
      | TopDownWorkbenchState
      | ((current: TopDownWorkbenchState) => TopDownWorkbenchState),
  ) {
    setState((current) => {
      const nextState =
        typeof nextStateOrUpdater === "function"
          ? (nextStateOrUpdater as (current: TopDownWorkbenchState) => TopDownWorkbenchState)(current)
          : nextStateOrUpdater;

      stateRef.current = nextState;
      return nextState;
    });
  }

  function applyServerState(nextState: TopDownWorkbenchState, message: string) {
    stateRef.current = nextState;
    setState(nextState);
    setHasUnsavedChanges(false);
    setSelectedRowIds([]);
    const publisher = nextState.publishers.find((item) => item.key === publisherKey);
    resetHistory(publisher?.rows ?? []);
    setStatusMessage(message);
    startTransition(() => {
      router.refresh();
    });
  }

  async function parseResponse(response: Response) {
    const raw = await response.text();
    let payload: Partial<WorkbenchResponse> = {};
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
    return payload as WorkbenchResponse;
  }

  function applySavedState(
    nextState: TopDownWorkbenchState,
    message: string,
    options: { clearSelection?: boolean; refresh?: boolean; preserveHistory?: boolean } = {},
  ) {
    stateRef.current = nextState;
    setState(nextState);
    setHasUnsavedChanges(false);
    if (!options.preserveHistory) {
      const publisher = nextState.publishers.find((item) => item.key === publisherKey);
      resetHistory(publisher?.rows ?? []);
    }
    if (options.clearSelection) {
      setSelectedRowIds([]);
    }
    setStatusMessage(message);
    if (options.refresh) {
      startTransition(() => {
        router.refresh();
      });
    }
  }

  function getCurrentPublisher() {
    return stateRef.current.publishers.find((publisher) => publisher.key === publisherKey) ?? null;
  }

  function stampRow(row: PublisherRowDraft) {
    return {
      ...row,
      adder: operatorName.trim() || "Local operator",
      addingDate: formatAuditDate(),
    };
  }

  function updatePublisherRows(
    nextRowsOrUpdater: PublisherRowDraft[] | ((rows: PublisherRowDraft[]) => PublisherRowDraft[]),
    options: { recordHistory?: boolean } = {},
  ) {
    const currentPublisher = getCurrentPublisher();
    if (currentPublisher && options.recordHistory !== false) {
      pushUndoSnapshot(currentPublisher.rows);
    }

    commitState((current) => ({
      ...current,
      publishers: current.publishers.map((publisher) => {
        if (publisher.key !== publisherKey) {
          return publisher;
        }

        const nextRows =
          typeof nextRowsOrUpdater === "function"
            ? nextRowsOrUpdater(publisher.rows)
            : nextRowsOrUpdater;

        return {
          ...publisher,
          rows: nextRows,
        };
      }),
    }));
    changeVersionRef.current += 1;
    setHasUnsavedChanges(true);
  }

  function updateRowDraft(rowId: string, updater: (row: PublisherRowDraft) => PublisherRowDraft) {
    updatePublisherRows((rows) =>
      rows.map((row) => (row.id === rowId ? stampRow(updater(row)) : row)),
    );
  }

  function undoLastChange() {
    const publisher = getCurrentPublisher();
    const previousRows = undoStack[undoStack.length - 1];
    if (!publisher || !previousRows) {
      return;
    }

    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, cloneRows(publisher.rows)].slice(-MAX_UNDO_STEPS));
    updatePublisherRows(previousRows, { recordHistory: false });
    setSelectedRowIds([]);
    setStatusMessage("Undid the last change.");
  }

  function redoLastUndo() {
    const publisher = getCurrentPublisher();
    const nextRows = redoStack[redoStack.length - 1];
    if (!publisher || !nextRows) {
      return;
    }

    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, cloneRows(publisher.rows)].slice(-MAX_UNDO_STEPS));
    updatePublisherRows(nextRows, { recordHistory: false });
    setSelectedRowIds([]);
    setStatusMessage("Redid the last undone change.");
  }

  async function persistPublishers(
    message = "Saved changes.",
    options: { autosave?: boolean; clearSelection?: boolean; refresh?: boolean } = {},
  ) {
    if (isBusy) {
      return;
    }

    const requestVersion = changeVersionRef.current;
    const publishersToSave = stateRef.current.publishers;
    setIsBusy(true);
    try {
      const response = await fetch(appApiPath("/api/top-down/workbench"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operatorName,
          publishers: publishersToSave,
        }),
      });
      const payload = await parseResponse(response);
      if (changeVersionRef.current === requestVersion) {
        applySavedState(payload.state, message, {
          ...options,
          preserveHistory: true,
        });
      } else {
        setStatusMessage(
          options.autosave
            ? "Autosave completed, but newer edits are still pending save."
            : "Save completed, but newer edits are still pending save.",
        );
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to save changes.");
    } finally {
      setIsBusy(false);
    }
  }

  function shouldShowRowResolution(row: PublisherRowDraft) {
    const status = row.sensorTowerResolution.status;
    return status === "failed" || status === "empty" || status === "resolving";
  }

  function renderPagerControls(className: string) {
    return (
      <div className={className}>
        <button
          type="button"
          className="pager-button"
          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          disabled={currentPage === 0}
        >
          Previous
        </button>
        <div className="pager-status">
          Page {currentPage + 1} of {pageCount}
        </div>
        <button
          type="button"
          className="pager-button"
          onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
          disabled={currentPage >= pageCount - 1}
        >
          Next
        </button>
      </div>
    );
  }

  useEffect(() => {
    if (!hasUnsavedChanges || isBusy || isBatchRunning) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistPublishers("All changes saved automatically.", {
        autosave: true,
      });
    }, 1500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasUnsavedChanges, isBusy, isBatchRunning, operatorName, state]);

  useEffect(() => {
    if (selectedPublisher) {
      resetHistory(selectedPublisher.rows);
    }
  }, [publisherKey]);

  function toggleRowSelection(rowId: string) {
    setSelectedRowIds((current) =>
      current.includes(rowId) ? current.filter((value) => value !== rowId) : [...current, rowId],
    );
  }

  function toggleSelectPagedRows() {
    setSelectedRowIds((current) => {
      if (allPagedSelected) {
        return current.filter((rowId) => !pagedRowIds.includes(rowId));
      }

      const merged = new Set([...current, ...pagedRowIds]);
      return [...merged];
    });
  }

  function applyBatchStatus() {
    const publisher = getCurrentPublisher();
    if (!publisher || selectedCount === 0) {
      return;
    }

    updatePublisherRows((rows) =>
      rows.map((row) =>
        selectedSet.has(row.id)
          ? stampRow({
              ...row,
              reviewStatus: batchStatus,
            })
          : row,
      ),
    );
    setStatusMessage(`Updated ${selectedCount} selected rows to ${batchStatus}.`);
  }

  function addFilterRule() {
    setFilters((current) => [...current, createFilterRule()]);
  }

  function updateFilterRule(filterId: string, updates: Partial<Pick<FilterRule, "field" | "value">>) {
    setFilters((current) =>
      current.map((filter) => (filter.id === filterId ? { ...filter, ...updates } : filter)),
    );
  }

  function removeFilterRule(filterId: string) {
    setFilters((current) => {
      if (current.length === 1) {
        return [createFilterRule()];
      }

      return current.filter((filter) => filter.id !== filterId);
    });
  }

  function clearFilters() {
    setFilters([createFilterRule()]);
    setAppliedFilterRowIds(null);
    setPageIndex(0);
    setStatusMessage("Cleared filters. Showing all rows.");
  }

  function cycleSort(field: SortField) {
    if (sortField !== field) {
      setSortField(field);
      setSortDirection("asc");
      setPageIndex(0);
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      setPageIndex(0);
      return;
    }

    if (sortDirection === "desc") {
      setSortField(null);
      setSortDirection(null);
      setPageIndex(0);
      return;
    }

    setSortField(field);
    setSortDirection("asc");
    setPageIndex(0);
  }

  function getSortIndicator(field: SortField) {
    if (sortField !== field || !sortDirection) {
      return "↕";
    }

    return sortDirection === "asc" ? "↑" : "↓";
  }

  function renderSortableHeader(label: string, field: SortField) {
    return (
      <button
        type="button"
        className={`sort-header-button ${sortField === field && sortDirection ? "sort-header-button-active" : ""}`}
        onClick={() => cycleSort(field)}
      >
        <span>{label}</span>
        <span className="sort-header-indicator" aria-hidden="true">
          {getSortIndicator(field)}
        </span>
      </button>
    );
  }

  function applyFilters(nextFilters = filters) {
    const publisher = getCurrentPublisher();
    if (!publisher) {
      return;
    }

    if (!hasActiveFilterValues(nextFilters)) {
      setAppliedFilterRowIds(null);
      setPageIndex(0);
      setStatusMessage("Showing all rows.");
      return;
    }

    const matchingRowIds = collectMatchingRowIds(publisher.rows, nextFilters);
    setAppliedFilterRowIds(matchingRowIds);
    setPageIndex(0);
    setStatusMessage(`Applied filters. ${matchingRowIds.length} row${matchingRowIds.length === 1 ? "" : "s"} visible.`);
  }

  function buildVisibleRowIdsWithForcedRow(rowId: string) {
    if (!appliedFilterRowIds) {
      return null;
    }

    return [...new Set([...appliedFilterRowIds, rowId])];
  }

  function navigateToRow(nextRows: PublisherRowDraft[], rowId: string, visibleRowIds: string[] | null) {
    const nextVisibleRows = visibleRowIds
      ? nextRows.filter((row) => new Set(visibleRowIds).has(row.id))
      : nextRows;
    const nextSortedRows = sortRowsForDisplay(nextVisibleRows);
    const nextRowIndex = nextSortedRows.findIndex((row) => row.id === rowId);

    if (nextRowIndex === -1) {
      return;
    }

    setPageIndex(Math.floor(nextRowIndex / pageSize));
  }

  function applyInvalidSensorTowerFilter() {
    const nextFilters = [createFilterRule("sensor_tower_link_valid", "invalid")];
    setFilters(nextFilters);
    applyFilters(nextFilters);
    setStatusMessage("Filtered rows where SensorTower link valid = FALSE.");
  }

  function applyBatchAction() {
    if (batchAction === "fetch_sensortower") {
      void fetchSelectedSensorTowerRows();
      return;
    }

    if (batchAction === "delete_rows") {
      applyBatchDelete();
      return;
    }

    applyBatchStatus();
  }

  function applyBatchDelete() {
    const publisher = getCurrentPublisher();
    if (!publisher || selectedCount === 0) {
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedCount} selected row${selectedCount === 1 ? "" : "s"}?`)) {
      return;
    }

    updatePublisherRows((rows) =>
      rows
        .filter((row) => !selectedSet.has(row.id))
        .map((row, index) => ({
          ...row,
          ordinal: index + 1,
        })),
    );
    setSelectedRowIds([]);
    setStatusMessage(`Deleted ${selectedCount} selected row${selectedCount === 1 ? "" : "s"}.`);
  }

  function updateField(rowId: string, field: "gameName" | "reviewStatus" | "notes", value: string) {
    updateRowDraft(rowId, (row) => ({
      ...row,
      [field]: value,
    }));
  }

  function updateSensorTowerLink(rowId: string, value: string) {
    updateRowDraft(rowId, (row) => ({
      ...row,
      sensorTowerLink: value,
      sensorTowerResolution: createIdleResolutionState(),
    }));
  }

  function addRow() {
    const publisher = getCurrentPublisher();
    if (!publisher) {
      return;
    }

    const nextRow = stampRow(createEmptyRow(publisher.rows.length + 1));
    const nextRows = [...publisher.rows, nextRow];
    const nextVisibleRowIds = buildVisibleRowIdsWithForcedRow(nextRow.id);

    updatePublisherRows(nextRows);
    if (nextVisibleRowIds) {
      setAppliedFilterRowIds(nextVisibleRowIds);
    }
    navigateToRow(nextRows, nextRow.id, nextVisibleRowIds);
    setStatusMessage(`Added a new draft row to ${publisher.name}.`);
  }

  function insertRowBelow(rowId: string) {
    const publisher = getCurrentPublisher();
    if (!publisher) {
      return;
    }

    const insertIndex = publisher.rows.findIndex((row) => row.id === rowId);
    if (insertIndex === -1) {
      return;
    }

    const sourceRow = publisher.rows[insertIndex];
    const nextRow = stampRow({
      ...createEmptyRow(insertIndex + 2),
      reviewStatus: sourceRow.reviewStatus,
    });

    const nextRows = [...publisher.rows];
    nextRows.splice(insertIndex + 1, 0, nextRow);

    const normalizedRows = nextRows.map((row, index) => ({
      ...row,
      ordinal: index + 1,
    }));
    const nextVisibleRowIds = buildVisibleRowIdsWithForcedRow(nextRow.id);

    updatePublisherRows(normalizedRows);
    if (nextVisibleRowIds) {
      setAppliedFilterRowIds(nextVisibleRowIds);
    }
    navigateToRow(normalizedRows, nextRow.id, nextVisibleRowIds);

    setStatusMessage(`Inserted a new draft row below ${publisher.name} row ${publisher.rows.find((row) => row.id === rowId)?.ordinal ?? ""}.`);
  }

  function deleteRow(rowId: string) {
    const publisher = getCurrentPublisher();
    if (!publisher) {
      return;
    }

    if (!window.confirm("Are you sure you want to delete this row?")) {
      return;
    }

    updatePublisherRows((rows) =>
      rows
        .filter((row) => row.id !== rowId)
        .map((row, index) => ({
          ...row,
          ordinal: index + 1,
        })),
    );
    setSelectedRowIds((current) => current.filter((value) => value !== rowId));
    setStatusMessage(`Removed a row from ${publisher.name}.`);
  }

  function setPlatformEntries(rowId: string, platform: SensorTowerPlatform, nextEntries: PublisherPlatformEntry[]) {
    updateRowDraft(rowId, (row) => ({
      ...row,
      iosApps: platform === "ios" ? nextEntries : row.iosApps,
      androidApps: platform === "android" ? nextEntries : row.androidApps,
    }));
  }

  function addResolvedOption(rowId: string, platform: SensorTowerPlatform, appId: string) {
    if (!appId) {
      return;
    }

    const publisher = getCurrentPublisher();
    const row = publisher?.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return;
    }

    const option = getOptionsForPlatform(row, platform).find((candidate) => candidate.appId === appId);
    if (!option) {
      return;
    }

    const nextEntries = [...getEntriesForPlatform(row, platform)];
    if (nextEntries.some((entry) => entry.appId === option.appId)) {
      return;
    }

    nextEntries.push(createEntryFromOption(option));
    setPlatformEntries(rowId, platform, nextEntries);
    setStatusMessage(`Added ${platform === "ios" ? "iOS" : "Android"} app ${option.appId}.`);
  }

  function getManualEntryKey(rowId: string, platform: SensorTowerPlatform, index: number) {
    return `${rowId}_${platform}_${index}`;
  }

  function toggleResolvedOption(rowId: string, platform: SensorTowerPlatform, option: SensorTowerOption, checked: boolean) {
    const publisher = getCurrentPublisher();
    const row = publisher?.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return;
    }

    const currentEntries = getEntriesForPlatform(row, platform);
    const alreadySelected = currentEntries.some((entry) => entry.appId === option.appId);

    if (checked && !alreadySelected) {
      setPlatformEntries(rowId, platform, [...currentEntries, createEntryFromOption(option)]);
      setStatusMessage(`Selected ${platform === "ios" ? "iOS" : "Android"} app ${option.appId}.`);
      return;
    }

    if (!checked && alreadySelected) {
      setPlatformEntries(
        rowId,
        platform,
        currentEntries.filter((entry) => entry.appId !== option.appId),
      );
      setStatusMessage(`Unselected ${platform === "ios" ? "iOS" : "Android"} app ${option.appId}.`);
    }
  }

  function addManualEntry(rowId: string, platform: SensorTowerPlatform) {
    const publisher = getCurrentPublisher();
    const row = publisher?.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return;
    }

    setPlatformEntries(rowId, platform, [
      ...getEntriesForPlatform(row, platform),
      createPlatformEntry("", "", "", "manual"),
    ]);
  }

  function updateManualEntry(rowId: string, platform: SensorTowerPlatform, index: number, value: string) {
    const publisher = getCurrentPublisher();
    const row = publisher?.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return;
    }

    const nextEntries = getEntriesForPlatform(row, platform).map((entry, entryIndex) =>
      entryIndex === index
        ? {
            ...entry,
            appId: value,
            source: "manual" as const,
          }
        : entry,
    );
    setPlatformEntries(rowId, platform, nextEntries);
  }

  function removePlatformEntry(rowId: string, platform: SensorTowerPlatform, index: number) {
    const publisher = getCurrentPublisher();
    const row = publisher?.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return;
    }

    setPlatformEntries(
      rowId,
      platform,
      getEntriesForPlatform(row, platform).filter((_, entryIndex) => entryIndex !== index),
    );
  }

  async function validateManualEntry(rowId: string, platform: SensorTowerPlatform, index: number) {
    const publisher = getCurrentPublisher();
    const row = publisher?.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return;
    }

    const currentEntries = getEntriesForPlatform(row, platform);
    const entry = currentEntries[index];
    const appId = entry?.appId.trim() || "";
    if (!appId) {
      setStatusMessage("Type an app ID before validating it.");
      return;
    }

    const validationKey = getManualEntryKey(rowId, platform, index);
    setValidatingManualKeys((current) => (current.includes(validationKey) ? current : [...current, validationKey]));

    try {
      const matchingOption = getOptionsForPlatform(row, platform).find((option) => option.appId === appId);
      if (matchingOption) {
        const nextEntries = currentEntries.filter((_, entryIndex) => entryIndex !== index);
        if (!nextEntries.some((candidate) => candidate.appId === matchingOption.appId)) {
          nextEntries.push(createEntryFromOption(matchingOption));
        }
        setPlatformEntries(rowId, platform, nextEntries);
        setStatusMessage(`Matched ${platform === "ios" ? "iOS" : "Android"} app ${appId} to fetched SensorTower choices.`);
        return;
      }

      const response = await fetch(appApiPath("/api/top-down/sensortower/lookup-app"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appId,
          os: platform,
        }),
      });

      const payload = (await response.json()) as SensorTowerLocalAppLookupResponse;
      if (!response.ok) {
        throw new Error(payload.errorMessage || "Failed to validate the manual app ID.");
      }

      if (!payload.found) {
        setStatusMessage(payload.errorMessage || `SensorTower could not find ${appId}.`);
        return;
      }

      if (
        row.sensorTowerResolution.unifiedAppId &&
        payload.unifiedAppId &&
        payload.unifiedAppId !== row.sensorTowerResolution.unifiedAppId
      ) {
        updateRowDraft(rowId, (currentRow) => {
          const nextEntries = getEntriesForPlatform(currentRow, platform).map((candidate, entryIndex) =>
            entryIndex === index
              ? {
                  ...candidate,
                  appId,
                  publisherName: payload.publisherName ?? candidate.publisherName,
                  appName: payload.appName ?? candidate.appName,
                  source: "manual" as const,
                }
              : candidate,
          );

          return {
            ...currentRow,
            iosApps: platform === "ios" ? nextEntries : currentRow.iosApps,
            androidApps: platform === "android" ? nextEntries : currentRow.androidApps,
          };
        });
        setStatusMessage(`App ID ${appId} exists in SensorTower, but it does not belong to this game's fetched app set.`);
        return;
      }

      updateRowDraft(rowId, (currentRow) => {
        const nextEntries = getEntriesForPlatform(currentRow, platform).map((candidate, entryIndex) =>
          entryIndex === index
            ? {
                ...candidate,
                appId,
                publisherName: payload.publisherName ?? candidate.publisherName,
                appName: payload.appName ?? candidate.appName,
                source: "manual" as const,
              }
            : candidate,
        );

        return {
          ...currentRow,
          iosApps: platform === "ios" ? nextEntries : currentRow.iosApps,
          androidApps: platform === "android" ? nextEntries : currentRow.androidApps,
        };
      });
      setStatusMessage(`Validated ${platform === "ios" ? "iOS" : "Android"} app ${appId} with SensorTower.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to validate the manual app ID.");
    } finally {
      setValidatingManualKeys((current) => current.filter((candidate) => candidate !== validationKey));
    }
  }

  async function resolveSensorTowerLinkForRow(
    rowId: string,
    options: { suppressStatusMessage?: boolean } = {},
  ) {
    const publisher = getCurrentPublisher();
    const row = publisher?.rows.find((candidate) => candidate.id === rowId);
    if (!row) {
      return { outcome: "missing_row" as const };
    }

    const link = row.sensorTowerLink.trim();
    if (!link) {
      updateRowDraft(rowId, (currentRow) => ({
        ...currentRow,
        sensorTowerResolution: createIdleResolutionState(),
      }));
      if (!options.suppressStatusMessage) {
        setStatusMessage("Cleared SensorTower resolution state for the row.");
      }
      return { outcome: "missing_link" as const };
    }

    setResolvingRowIds((current) => (current.includes(rowId) ? current : [...current, rowId]));
    updateRowDraft(rowId, (currentRow) => ({
      ...currentRow,
      sensorTowerResolution: createIdleResolutionState("resolving"),
    }));
    if (!options.suppressStatusMessage) {
      setStatusMessage("Resolving SensorTower link...");
    }

    try {
      const response = await fetch(appApiPath("/api/top-down/sensortower/resolve"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          link,
          operatorName,
          publisherKey,
          rowId,
        }),
      });

      const payload = (await response.json()) as SensorTowerResolveResponse;
      const nextResolution = {
        status: payload.status,
        unifiedAppId: payload.unifiedAppId,
        resolvedGameName: payload.resolvedGameName ?? "",
        errorMessage: payload.errorMessage ?? "",
        resolvedAt: payload.resolvedAt ?? new Date().toISOString(),
        iosOptions: payload.iosOptions ?? [],
        androidOptions: payload.androidOptions ?? [],
      };

      updateRowDraft(rowId, (currentRow) => ({
        ...currentRow,
        iosApps: reconcileEntriesWithOptions(currentRow.iosApps, nextResolution.iosOptions),
        androidApps: reconcileEntriesWithOptions(currentRow.androidApps, nextResolution.androidOptions),
        sensorTowerResolution: nextResolution,
      }));

      if (payload.status === "resolved") {
        if (!options.suppressStatusMessage) {
          setStatusMessage(
            `Resolved unified app ${payload.unifiedAppId}. ${payload.iosOptions.length} iOS and ${payload.androidOptions.length} Android choices loaded.`,
          );
        }
      } else if (payload.status === "empty") {
        if (!options.suppressStatusMessage) {
          setStatusMessage(
            payload.errorMessage || "No SensorTower child app IDs were returned. Manual entry mode is available.",
          );
        }
      } else {
        if (!options.suppressStatusMessage) {
          setStatusMessage(payload.errorMessage || "SensorTower resolution failed. Manual entry mode is available.");
        }
      }
      return { outcome: payload.status };
    } catch (error) {
      updateRowDraft(rowId, (currentRow) => ({
        ...currentRow,
        sensorTowerResolution: {
          ...createIdleResolutionState("failed"),
          errorMessage: error instanceof Error ? error.message : "Failed to resolve the SensorTower link.",
        },
      }));
      if (!options.suppressStatusMessage) {
        setStatusMessage(error instanceof Error ? error.message : "Failed to resolve the SensorTower link.");
      }
      return { outcome: "failed" as const };
    } finally {
      setResolvingRowIds((current) => current.filter((candidate) => candidate !== rowId));
    }
  }

  async function fetchSelectedSensorTowerRows() {
    const publisher = getCurrentPublisher();
    if (!publisher || selectedCount === 0) {
      return;
    }

    const selectedRows = publisher.rows.filter((row) => selectedSet.has(row.id));
    const fetchableRows = selectedRows.filter((row) => row.sensorTowerLink.trim());
    const skippedCount = selectedRows.length - fetchableRows.length;

    if (fetchableRows.length === 0) {
      setStatusMessage("No selected rows have a SensorTower link to fetch.");
      return;
    }

    setIsBatchRunning(true);

    let resolvedCount = 0;
    let emptyCount = 0;
    let failedCount = 0;

    try {
      for (let index = 0; index < fetchableRows.length; index += 1) {
        const row = fetchableRows[index];
        setStatusMessage(`Fetching SensorTower ${index + 1}/${fetchableRows.length}: ${row.gameName || `row ${row.ordinal}`}`);
        const result = await resolveSensorTowerLinkForRow(row.id, { suppressStatusMessage: true });

        if (result.outcome === "resolved") {
          resolvedCount += 1;
        } else if (result.outcome === "empty") {
          emptyCount += 1;
        } else if (result.outcome === "failed") {
          failedCount += 1;
        }
      }

      const summaryParts = [
        `Fetched ${fetchableRows.length} selected row${fetchableRows.length === 1 ? "" : "s"}`,
        `${resolvedCount} resolved`,
      ];

      if (emptyCount > 0) {
        summaryParts.push(`${emptyCount} empty`);
      }

      if (failedCount > 0) {
        summaryParts.push(`${failedCount} failed`);
      }

      if (skippedCount > 0) {
        summaryParts.push(`${skippedCount} skipped without link`);
      }

      setStatusMessage(`${summaryParts.join(", ")}.`);
    } finally {
      setIsBatchRunning(false);
    }
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const publisher = getCurrentPublisher();
    if (!file || !publisher) {
      return;
    }

    setIsBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("publisherKey", publisher.key);
      formData.set("operatorName", operatorName);

      const response = await fetch(appApiPath("/api/top-down/import"), {
        method: "POST",
        body: formData,
      });
      const payload = await parseResponse(response);
      applyServerState(payload.state, payload.message ?? `Imported ${file.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to import CSV.");
    } finally {
      event.target.value = "";
      setIsBusy(false);
    }
  }

  function renderPlatformCell(row: PublisherRowDraft, platform: SensorTowerPlatform) {
    const entries = getEntriesForPlatform(row, platform);
    const options = getOptionsForPlatform(row, platform);
    const hasResolvedOptions = options.length > 0;
    const label = platform === "ios" ? "iOS" : "Android";
    const manualEntries = hasResolvedOptions ? entries.filter((entry) => entry.source === "manual") : entries;
    const resolvedSelectedCount = hasResolvedOptions
      ? options.filter((option) => entries.some((entry) => entry.appId === option.appId)).length
      : 0;

    return (
      <div className="platform-cell">
        <div className="platform-cell-body">
          {hasResolvedOptions ? (
            <div className="platform-picker">
              <div className="resolved-choice-list">
                {options.map((option) => {
                  const checked = entries.some((entry) => entry.appId === option.appId);
                  return (
                    <label key={`${platform}_${option.appId}`} className="resolved-choice-row">
                      <div className="resolved-choice-copy">
                        <strong className="resolved-choice-title">{option.appId}</strong>
                        <div className="resolved-choice-meta">{option.publisherName || "SensorTower publisher name unavailable"}</div>
                        {option.appName ? <div className="resolved-choice-submeta">{option.appName}</div> : null}
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleResolvedOption(row.id, platform, option, event.target.checked)}
                        aria-label={`Select ${label} app ${option.appId}`}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {manualEntries.length > 0 ? (
            <div className="selection-stack">
              {manualEntries.map((entry) => {
                const index = entries.findIndex((candidate) => candidate === entry);
                const manualEntryKey = getManualEntryKey(row.id, platform, index);
                const isValidating = validatingManualKeys.includes(manualEntryKey);
                return (
                  <div key={`${platform}_${row.id}_${index}`} className="selection-card">
                    <div className="selection-card-header">
                      <input
                        className="input enterprise-input table-input manual-entry-input"
                        value={entry.appId}
                        onChange={(event) => updateManualEntry(row.id, platform, index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void validateManualEntry(row.id, platform, index);
                          }
                        }}
                        placeholder={`${label} App ID`}
                      />
                      <button
                        type="button"
                        className="button button-secondary manual-validate-button"
                        onClick={() => void validateManualEntry(row.id, platform, index)}
                        disabled={isValidating}
                        aria-label={`Validate ${label} app entry ${index + 1}`}
                      >
                        {isValidating ? "..." : "OK"}
                      </button>
                      <button
                        type="button"
                        className="button button-danger manual-remove-button"
                        onClick={() => removePlatformEntry(row.id, platform, index)}
                        aria-label={`Remove ${label} app entry ${index + 1}`}
                      >
                        x
                      </button>
                    </div>
                    <div className="selection-meta">
                      {entry.publisherName || "SensorTower publisher name unavailable"}
                    </div>
                    {entry.appName ? <div className="selection-submeta">{entry.appName}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="platform-manual-action">
          {hasResolvedOptions ? (
            <div className="platform-selection-count">{`${resolvedSelectedCount}/${options.length} selected`}</div>
          ) : null}
          <button
            type="button"
            className="button button-secondary button-inline manual-add-button"
            onClick={() => addManualEntry(row.id, platform)}
          >
            {`Add ${label} App IDs Manually`}
          </button>
        </div>
      </div>
    );
  }

  if (!selectedPublisher) {
    return (
      <div className="workspace-page">
        <div className="surface-card">
          <h1>Publisher not found</h1>
          <p className="muted-text">The requested publisher key does not exist in the current top-down dataset.</p>
          <Link href="/" className="button button-primary">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <button
        type="button"
        className={`floating-warning ${invalidSensorTowerRowCount > 0 ? "floating-warning-active" : ""}`}
        onClick={applyInvalidSensorTowerFilter}
        aria-label={`Show ${invalidSensorTowerRowCount} rows with invalid SensorTower links`}
        title="Filter rows where SensorTower link valid = FALSE"
      >
        <span className="floating-warning-count">{invalidSensorTowerRowCount}</span>
        <span className="floating-warning-label">SensorTower issues</span>
      </button>

      <section className="page-banner compact-banner">
        <div>
          <p className="page-kicker">Publisher Editor</p>
          <h1>{selectedPublisher.name}</h1>
          <p className="page-summary">
            Dedicated page for game-list entry, review, and CSV seeding for this publisher only.
          </p>
        </div>
        <div className="banner-meta">
          <div className="meta-pill">{selectedPublisher.rows.length} rows</div>
          <div className="meta-pill">{flattenedCount} flattened apps</div>
          <div className="meta-pill">{hasUnsavedChanges ? "Unsaved changes" : "Saved"}</div>
        </div>
      </section>

      <section className="action-strip">
        <Link className="button button-secondary" href="/">
          Back to Overview
        </Link>
        <label className="button button-secondary" htmlFor="publisher-upload">
          Upload CSV
        </label>
        <input
          id="publisher-upload"
          className="sr-only"
          type="file"
          accept=".csv"
          onChange={handleCsvUpload}
          disabled={isBusy}
        />
        <button type="button" className="button button-secondary" onClick={addRow} disabled={isBusy}>
          Add Row
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={undoLastChange}
          disabled={isBusy || !canUndo}
        >
          Undo
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={redoLastUndo}
          disabled={isBusy || !canRedo}
        >
          Redo
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() =>
            void persistPublishers("Saved changes.", {
              clearSelection: false,
              refresh: false,
            })
          }
          disabled={isBusy || !hasUnsavedChanges}
        >
          Save Changes
        </button>
        <div className="operator-inline">
          <span className="field-label">Operator</span>
          <input
            className="input enterprise-input small-input"
            value={operatorName}
            onChange={(event) => setOperatorName(event.target.value)}
          />
        </div>
        <div className="history-inline">{canUndo || canRedo ? `${undoStack.length} undo / ${redoStack.length} redo` : "History clean"}</div>
        <div className="status-inline">{isBusy ? "Working..." : statusMessage}</div>
      </section>

      <section className="surface-card">
        <div className="section-heading">
          <div>
            <h2>Game List</h2>
            <p>Filtered enterprise table view for row-level editing.</p>
          </div>
        </div>
        <div className="table-toolbar">
            <div className="table-toolbar-top">
              <div className="table-top-actions">
                {renderPagerControls("table-top-pagination")}
                <label className="field-inline">
                  <span className="field-label">Rows</span>
                  <select
                    className="select enterprise-input small-select"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPageIndex(0);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="table-toolbar-middle">
              <div className="filter-builder">
                <div className="field-label filter-builder-label">Filters</div>
                <div className="filter-rule-list">
                  {filters.map((filter) => (
                    <div key={filter.id} className="filter-rule-row">
                      <select
                        className="select enterprise-input table-filter filter-field-select"
                        value={filter.field}
                        onChange={(event) =>
                          updateFilterRule(filter.id, {
                            field: event.target.value as FilterField,
                            value: "",
                          })
                        }
                      >
                        {FILTER_FIELD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {filter.field === "review_status" ? (
                        <select
                          className="select enterprise-input table-filter filter-value-select"
                          value={filter.value}
                          onChange={(event) => updateFilterRule(filter.id, { value: event.target.value })}
                        >
                          <option value="">All</option>
                          <option value="needs_review">Needs Review</option>
                          <option value="confirmed">Confirmed</option>
                          <option value="seeded">Seeded</option>
                        </select>
                      ) : filter.field === "sensor_tower_link_valid" ? (
                        <select
                          className="select enterprise-input table-filter filter-value-select"
                          value={filter.value}
                          onChange={(event) => updateFilterRule(filter.id, { value: event.target.value })}
                        >
                          <option value="">All</option>
                          <option value="valid">TRUE</option>
                          <option value="invalid">FALSE</option>
                          <option value="unchecked">Not checked</option>
                          <option value="missing">No link</option>
                        </select>
                      ) : (
                        <input
                          className="input enterprise-input table-filter filter-value-input"
                          value={filter.value}
                          onChange={(event) => updateFilterRule(filter.id, { value: event.target.value })}
                          placeholder={getFilterPlaceholder(filter.field)}
                        />
                      )}
                      <button
                        type="button"
                        className="button button-secondary button-inline filter-remove-button"
                        onClick={() => removeFilterRule(filter.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="filter-builder-actions">
                    <button
                      type="button"
                      className="button button-secondary button-inline"
                      onClick={() => applyFilters()}
                    >
                      Apply Filters
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-inline"
                      onClick={addFilterRule}
                    >
                      Add Filter
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-inline"
                      onClick={clearFilters}
                    >
                      Clear Filters
                    </button>
                  </div>
                </div>
              </div>
              <div className="table-controls">
                <div className="batch-controls">
                  <label className="field-inline">
                    <span className="field-label">Batch Action</span>
                    <select
                      className="select enterprise-input small-select"
                      value={batchAction}
                      onChange={(event) => setBatchAction(event.target.value as BatchAction)}
                    >
                      <option value="update_status">Update Status</option>
                      <option value="fetch_sensortower">Fetch SensorTower</option>
                      <option value="delete_rows">Delete Rows</option>
                    </select>
                  </label>
                  {batchAction === "update_status" ? (
                    <label className="field-inline">
                      <span className="field-label">Batch Status</span>
                      <select
                        className="select enterprise-input small-select"
                        value={batchStatus}
                        onChange={(event) => setBatchStatus(event.target.value as PublisherRowDraft["reviewStatus"])}
                      >
                        <option value="needs_review">needs_review</option>
                        <option value="confirmed">confirmed</option>
                        <option value="seeded">seeded</option>
                      </select>
                    </label>
                  ) : batchAction === "fetch_sensortower" ? (
                    <div className="selection-count">Fetches only selected rows that have a SensorTower link</div>
                  ) : (
                    <div className="selection-count">Deletes all selected rows and reorders the remaining list</div>
                  )}
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={applyBatchAction}
                    disabled={selectedCount === 0 || isBatchRunning}
                  >
                    {batchAction === "fetch_sensortower"
                      ? isBatchRunning
                        ? "Fetching Selected..."
                        : "Fetch Selected"
                      : batchAction === "delete_rows"
                        ? "Delete Selected"
                        : "Apply to Selected"}
                  </button>
                  <div className="selection-count">{selectedCount} selected</div>
                </div>
              </div>
            </div>
          </div>

        <div className="table-shell">
          <table className="enterprise-table editor-table">
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={allPagedSelected}
                    onChange={toggleSelectPagedRows}
                    aria-label="Select all rows on current page"
                  />
                </th>
                <th>{renderSortableHeader("ID", "ordinal")}</th>
                <th>{renderSortableHeader("Game Name", "game_name")}</th>
                <th>{renderSortableHeader("Status", "review_status")}</th>
                <th>{renderSortableHeader("Sensor Tower Link", "sensor_tower_link")}</th>
                <th>{renderSortableHeader("SensorTower Link Valid", "sensor_tower_link_valid")}</th>
                <th>{renderSortableHeader("SensorTower Game Name", "sensor_tower_game_name")}</th>
                <th>{renderSortableHeader("SensorTower unified_app_id", "sensor_tower_unified_app_id")}</th>
                <th>{renderSortableHeader("iOS App IDs", "ios_app_ids")}</th>
                <th>{renderSortableHeader("Android App IDs", "android_app_ids")}</th>
                <th>{renderSortableHeader("Added By", "added_by")}</th>
                <th>{renderSortableHeader("Notes", "notes")}</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => {
                const resolutionMessage = buildResolutionMessage(row);
                const isResolvingRow = resolvingRowIds.includes(row.id);
                const linkValidity = getSensorTowerLinkValidity(row);
                return (
                  <tr key={row.id}>
                    <td className="checkbox-cell">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(row.id)}
                        onChange={() => toggleRowSelection(row.id)}
                        aria-label={`Select row ${row.ordinal}`}
                      />
                    </td>
                    <td>{row.ordinal}</td>
                    <td>
                      <input
                        className="input enterprise-input table-input"
                        value={row.gameName}
                        onChange={(event) => updateField(row.id, "gameName", event.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="select enterprise-input table-input"
                        value={row.reviewStatus}
                        onChange={(event) => updateField(row.id, "reviewStatus", event.target.value)}
                      >
                        <option value="needs_review">needs_review</option>
                        <option value="confirmed">confirmed</option>
                        <option value="seeded">seeded</option>
                      </select>
                    </td>
                    <td>
                      <div className="account-stack">
                        <input
                          className="input enterprise-input table-input"
                          value={row.sensorTowerLink}
                          onChange={(event) => updateSensorTowerLink(row.id, event.target.value)}
                        />
                        {shouldShowRowResolution(row) ? (
                          <div className={`row-resolution row-resolution-${resolutionMessage.tone}`}>
                            {resolutionMessage.text}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className={`validity-pill validity-pill-${getSensorTowerLinkValidityTone(linkValidity)}`}>
                        {getSensorTowerLinkValidityLabel(linkValidity)}
                      </div>
                    </td>
                    <td>
                      <div className="resolved-game-name">
                        {row.sensorTowerResolution.resolvedGameName || "-"}
                      </div>
                    </td>
                    <td>
                      <div className="resolved-game-name">
                        {row.sensorTowerResolution.unifiedAppId || "-"}
                      </div>
                    </td>
                    <td className="app-id-cell">{renderPlatformCell(row, "ios")}</td>
                    <td className="app-id-cell">{renderPlatformCell(row, "android")}</td>
                    <td>
                      <div className="account-stack">
                        <input
                          className="input enterprise-input table-input"
                          value={row.adder}
                          readOnly
                          placeholder="Recorded automatically"
                        />
                        <input
                          className="input enterprise-input table-input"
                          value={row.addingDate}
                          readOnly
                          placeholder="Recorded automatically"
                        />
                      </div>
                    </td>
                    <td>
                      <textarea
                        className="textarea enterprise-input table-textarea"
                        value={row.notes}
                        onChange={(event) => updateField(row.id, "notes", event.target.value)}
                        rows={2}
                      />
                    </td>
                    <td>
                      <div className="account-stack">
                        <button
                          type="button"
                          className="button button-secondary button-inline"
                          onClick={() => insertRowBelow(row.id)}
                          disabled={isBusy}
                        >
                          Insert Below
                        </button>
                        <button
                          type="button"
                          className="button button-secondary button-inline"
                          onClick={() => void resolveSensorTowerLinkForRow(row.id)}
                          disabled={isResolvingRow || isBatchRunning || !row.sensorTowerLink.trim()}
                        >
                          Fetch SensorTower
                        </button>
                        {isResolvingRow ? (
                          <div className="fetch-loading" aria-live="polite">
                            <span className="loading-spinner" />
                            <span>Fetching...</span>
                          </div>
                        ) : null}
                        <button type="button" className="button button-danger" onClick={() => deleteRow(row.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="empty-cell">
                    No rows matched the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <div className="table-footer-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={addRow}
              disabled={isBusy}
            >
              Add Row
            </button>
          </div>
          {renderPagerControls("table-footer-pagination")}
        </div>
      </section>
    </div>
  );
}
