type CellValue = { value?: unknown; formula?: unknown; type?: unknown };
type CellMap = Record<string, CellValue | unknown>;

export type SubcontractorSourceStatus = {
  lcpStatus: string;
  dirStatus: string;
  completionStatus: "Complete" | "Incomplete" | "Not checked";
};

function parseCells(value: unknown): CellMap {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as CellMap
      : {};
  } catch {
    return {};
  }
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") {
    const record = cell as CellValue;
    const value = record.value ?? record.formula;
    if (value === null || value === undefined) return "";
    if (record.type === "date" && typeof value === "number" && Number.isFinite(value)) {
      return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
    }
    return String(value).trim();
  }
  return String(cell).trim();
}

function normalizedHeader(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findColumn(headers: CellMap, predicate: (header: string) => boolean): string | null {
  for (const [column, value] of Object.entries(headers)) {
    const header = normalizedHeader(cellText(value));
    if (header && predicate(header)) return column;
  }
  return null;
}

function explicitCompletion(value: string): "Complete" | "Incomplete" | null {
  const normalized = value.trim().toLowerCase();
  if (["not complete", "incomplete", "missing", "no", "overdue", "pending", "in progress", "false", "0"].some((status) => normalized.includes(status))) return "Incomplete";
  if (["complete", "completed", "yes", "done", "registered"].some((status) => normalized.includes(status))) return "Complete";
  if (["true", "1", "✓", "✔"].includes(normalized)) return "Complete";
  return null;
}

function isPositiveStatus(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  return explicitCompletion(value) === "Complete";
}

function unavailableStatus(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "not checked" || normalized === "not checked.";
}

/**
 * Reads LCP/DIR values only from the source row attached to this subcontractor
 * relationship. It intentionally does not accept project-level status values.
 */
export function readSubcontractorSourceStatus(
  headerCellsJson: unknown,
  sourceCellsJson: unknown,
): SubcontractorSourceStatus {
  const headers = parseCells(headerCellsJson);
  const source = parseCells(sourceCellsJson);
  const lcpColumn = findColumn(headers, (header) => header.startsWith("lcp"));
  const dirColumn = findColumn(headers, (header) => header.startsWith("dir"));
  const completionColumn = findColumn(headers, (header) => header.startsWith("status") || header.includes("completionstatus") || header.includes("subcontractorstatus"));

  const lcpStatus = lcpColumn ? cellText(source[lcpColumn]) : "";
  const dirStatus = dirColumn ? cellText(source[dirColumn]) : "";
  const explicit = completionColumn ? explicitCompletion(cellText(source[completionColumn])) : null;
  const lcpAvailable = !unavailableStatus(lcpStatus);
  const dirAvailable = !unavailableStatus(dirStatus);
  const lcpDisplay = lcpAvailable ? lcpStatus : "Not checked";
  const dirDisplay = dirAvailable ? dirStatus : "Not checked";

  return {
    lcpStatus: lcpDisplay,
    dirStatus: dirDisplay,
    completionStatus: explicit ?? (
      !lcpAvailable && !dirAvailable
        ? "Not checked"
        : lcpAvailable && dirAvailable && isPositiveStatus(lcpStatus) && isPositiveStatus(dirStatus)
          ? "Complete"
          : "Incomplete"
    ),
  };
}
