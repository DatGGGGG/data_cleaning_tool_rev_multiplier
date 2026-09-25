import type { BottomUpReviewStatus, BottomUpRowDraft, BottomUpStep1PublisherRow } from "@/lib/bottom-up/types";

type ParsedCsvRow = Record<string, string>;

function createRowId() {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  return `bottom_up_row_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatAuditDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }

  return value;
}

function normalizeStatus(value: unknown): BottomUpReviewStatus {
  return value === "confirmed" || value === "seeded" ? value : "needs_review";
}

export function createEmptyBottomUpRow(ordinal: number): BottomUpRowDraft {
  return {
    id: createRowId(),
    ordinal,
    cleanedPublisherName: "",
    publisherId: "",
    publisherName: "",
    revenueMultiplier: "1",
    reviewStatus: "needs_review",
    notes: "",
    adder: "",
    addingDate: "",
  };
}

export function normalizeBottomUpRow(row: Partial<BottomUpRowDraft>, ordinalFallback = 1): BottomUpRowDraft {
  const next = {
    ...createEmptyBottomUpRow(ordinalFallback),
    ...row,
  };

  return {
    id: normalizeText(next.id) || createRowId(),
    ordinal: typeof next.ordinal === "number" && Number.isFinite(next.ordinal) ? next.ordinal : ordinalFallback,
    cleanedPublisherName: normalizeText(next.cleanedPublisherName),
    publisherId: normalizeText(next.publisherId),
    publisherName: normalizeText(next.publisherName),
    revenueMultiplier: normalizeText(next.revenueMultiplier) || "1",
    reviewStatus: normalizeStatus(next.reviewStatus),
    notes: normalizeText(next.notes),
    adder: normalizeText(next.adder),
    addingDate: normalizeText(next.addingDate),
  };
}

export function normalizeBottomUpRows(rows: unknown): BottomUpRowDraft[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row, index) => normalizeBottomUpRow(row as Partial<BottomUpRowDraft>, index + 1));
}

export type BottomUpMultiplierCorrection = {
  rowId: string;
  cleanedPublisherName: string;
  previousMultiplier: string;
  resolvedMultiplier: string;
};

export type BottomUpMultiplierResolution = {
  rows: BottomUpRowDraft[];
  corrections: BottomUpMultiplierCorrection[];
  unknownCleanedPublisherNames: string[];
};

/**
 * Publisher Management owns the standard revenue multiplier.  Bottom Up rows
 * carry a denormalized copy only so CSV snapshots remain self-contained.
 */
export function resolveBottomUpRevenueMultipliers(
  rows: BottomUpRowDraft[],
  registeredPublisherMultipliers: Map<string, string>,
): BottomUpMultiplierResolution {
  const corrections: BottomUpMultiplierCorrection[] = [];
  const unknown = new Set<string>();
  const resolvedRows = rows.map((row, index) => {
    const normalized = normalizeBottomUpRow(row, index + 1);
    const cleanedPublisherKey = normalized.cleanedPublisherName.toLowerCase();
    if (!cleanedPublisherKey) return normalized;
    const registeredMultiplier = registeredPublisherMultipliers.get(cleanedPublisherKey);
    if (!registeredMultiplier) {
      unknown.add(normalized.cleanedPublisherName);
      return normalized;
    }
    if (normalized.revenueMultiplier !== registeredMultiplier) {
      corrections.push({
        rowId: normalized.id,
        cleanedPublisherName: normalized.cleanedPublisherName,
        previousMultiplier: normalized.revenueMultiplier,
        resolvedMultiplier: registeredMultiplier,
      });
    }
    return { ...normalized, revenueMultiplier: registeredMultiplier };
  });
  return {
    rows: resolvedRows,
    corrections,
    unknownCleanedPublisherNames: [...unknown].sort((left, right) => left.localeCompare(right)),
  };
}

export function findBottomUpMultiplierConflicts(rows: BottomUpRowDraft[]) {
  const valuesByKey = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.cleanedPublisherName || !row.publisherId) continue;
    const key = `${row.cleanedPublisherName.trim().toLowerCase()}\u0000${row.publisherId.trim()}`;
    const values = valuesByKey.get(key) ?? new Set<string>();
    values.add(row.revenueMultiplier.trim());
    valuesByKey.set(key, values);
  }
  return [...valuesByKey.entries()]
    .filter(([, multipliers]) => multipliers.size > 1)
    .map(([key, multipliers]) => ({ key, multipliers: [...multipliers].sort() }));
}

function parseCsv(text: string): ParsedCsvRow[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows.filter((item) => item.some((value) => value.trim() !== ""));
  if (!headerRow) {
    return [];
  }

  return dataRows.map((dataRow) =>
    headerRow.reduce<ParsedCsvRow>((accumulator, header, index) => {
      accumulator[header.trim()] = dataRow[index]?.trim() ?? "";
      return accumulator;
    }, {}),
  );
}

function pickValue(row: ParsedCsvRow, keys: string[]) {
  const direct = keys.map((key) => row[key]).find((value) => typeof value === "string" && value !== "");
  if (direct) {
    return direct;
  }

  const lowerCaseLookup = new Map(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replaceAll(" ", "_"), value]),
  );

  for (const key of keys) {
    const found = lowerCaseLookup.get(key.trim().toLowerCase().replaceAll(" ", "_"));
    if (typeof found === "string" && found !== "") {
      return found;
    }
  }

  return "";
}

export function importBottomUpRowsFromCsv(text: string): BottomUpRowDraft[] {
  return parseCsv(text)
    .map((row, index) =>
      normalizeBottomUpRow(
        {
          cleanedPublisherName: pickValue(row, ["cleaned_publisher_name", "cleanedPublisherName", "Cleaned Publisher Name"]),
          publisherId: pickValue(row, ["publisher_id", "publisherId", "Publisher ID"]),
          publisherName: pickValue(row, ["publisher_name", "publisherName", "Publisher Name"]),
          revenueMultiplier: pickValue(row, ["revenue_multiplier", "revenueMultiplier", "Revenue Multiplier"]) || "1",
          reviewStatus: "seeded",
        },
        index + 1,
      ),
    )
    .filter((row) => row.cleanedPublisherName || row.publisherId || row.publisherName);
}

export function buildBottomUpCsv(rows: BottomUpRowDraft[]) {
  const header = "cleaned_publisher_name,publisher_id,publisher_name,revenue_multiplier";
  const body = rows
    .filter((row) => row.cleanedPublisherName && row.publisherId && row.publisherName)
    .map((row) =>
      [row.cleanedPublisherName, row.publisherId, row.publisherName, row.revenueMultiplier]
        .map(csvEscape)
        .join(","),
    );

  return [header, ...body].join("\n");
}

export function buildBottomUpStep1PublisherCsv(rows: BottomUpStep1PublisherRow[]) {
  const header = [
    "publisher_name",
    "cleaned_publisher_name",
    "is_in_vn_publisher_list",
    "is_in_latest_mapping",
    "is_checked",
    "publisher_ids",
    "source_app_rows",
  ];
  const body = rows.map((row) =>
    [
      row.publisherName,
      row.cleanedPublisherName,
      row.isInVnPublisherList ? "TRUE" : "FALSE",
      row.isInLatestMapping ? "TRUE" : "FALSE",
      row.isChecked ? "TRUE" : "FALSE",
      row.publisherIds.join(" | "),
      String(row.appCount),
    ]
      .map(csvEscape)
      .join(","),
  );

  return [header.join(","), ...body].join("\n");
}

export function upsertRowsByPublisherId(existingRows: BottomUpRowDraft[], importedRows: BottomUpRowDraft[]) {
  const importedByPublisherId = new Map<string, BottomUpRowDraft>();
  const importedWithoutPublisherId: BottomUpRowDraft[] = [];

  for (const row of importedRows) {
    const publisherId = normalizeText(row.publisherId);
    if (!publisherId) {
      importedWithoutPublisherId.push(row);
      continue;
    }

    importedByPublisherId.set(publisherId, row);
  }

  const usedPublisherIds = new Set<string>();
  let replacedCount = 0;
  const mergedRows = existingRows.map((row) => {
    const publisherId = normalizeText(row.publisherId);
    const replacement = importedByPublisherId.get(publisherId);
    if (!publisherId || !replacement) {
      return row;
    }

    usedPublisherIds.add(publisherId);
    replacedCount += 1;
    return replacement;
  });

  for (const [publisherId, row] of importedByPublisherId) {
    if (!usedPublisherIds.has(publisherId)) {
      mergedRows.push(row);
    }
  }

  mergedRows.push(...importedWithoutPublisherId);

  return {
    rows: mergedRows.map((row, index) => normalizeBottomUpRow(row, index + 1)),
    replacedCount,
    insertedCount: importedRows.length - replacedCount,
  };
}
