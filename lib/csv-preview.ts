export type ParsedCsvPreview = { columns: string[]; rows: string[][] };

/** Read-only RFC 4180-style parser used only for browser previews. */
export function parseCsvPreview(text: string): ParsedCsvPreview {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      record.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      record.push(field);
      records.push(record);
      field = "";
      record = [];
      continue;
    }
    field += char;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }

  const [header = [], ...rows] = records;
  const columns = header.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value));
  return { columns, rows: rows.filter((row) => row.some((value) => value !== "")) };
}
