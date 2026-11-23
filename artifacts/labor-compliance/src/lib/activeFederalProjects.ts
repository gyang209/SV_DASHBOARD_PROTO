import { formatProjectNumberForDisplay } from "./projectForm";

export type ActiveFederalSourceRecord = {
  id: number;
  excelRow: number;
  cells: Record<string, { value?: string | null; formula?: string | null }>;
};

export type FederalProjectMatchRecord = {
  id: number;
  projectName: string;
  projectNumber: string;
  projectKey: string;
  dirNumber: string;
  contractorName: string;
};

export type ActiveFederalTableRow<TProject> = {
  key: string;
  project: TProject | null;
  source: ActiveFederalSourceRecord | null;
  matchState: "matched" | "unmatched" | "ambiguous";
};

type WorkbookSourceRow = {
  id: number;
  excelRow: number;
  cellsJson: string;
};

export function parseActiveFederalSourceRows(rows: WorkbookSourceRow[]): ActiveFederalSourceRecord[] {
  return rows.flatMap((row) => {
    if (row.excelRow <= 1) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.cellsJson);
    } catch {
      parsed = {};
    }
    const cells = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ActiveFederalSourceRecord["cells"]
      : {};
    return [{ id: row.id, excelRow: row.excelRow, cells }];
  });
}

function readCell(source: ActiveFederalSourceRecord, column: string): string {
  const cell = source.cells[`${column}${source.excelRow}`];
  if (!cell || typeof cell !== "object") return "";
  return cell.value ?? (cell.formula ? `=${cell.formula}` : "");
}

function normalizeMatchValue(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeProjectNumber(value: unknown): string {
  return formatProjectNumberForDisplay(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function stripFederalProjectSuffix(value: unknown): string {
  return String(value ?? "").replace(/(?:\s*\(Federal\))+\s*$/i, "").trim();
}

export function isFederalProjectName(value: unknown): boolean {
  const name = String(value ?? "").trim();
  return Boolean(name && stripFederalProjectSuffix(name) !== name);
}

export function getActiveFederalProjectDisplay<TProject extends FederalProjectMatchRecord>(
  row: ActiveFederalTableRow<TProject>,
): { projectName: string; projectNumber: string; dirNumber: string; contractorName: string } {
  const value = (column: string, projectValue: string | null | undefined) =>
    String(projectValue || (row.source ? readCell(row.source, column) : "") || "").trim();
  return {
    projectName: stripFederalProjectSuffix(value("A", row.project?.projectName)),
    projectNumber: formatProjectNumberForDisplay(value("B", row.project?.projectNumber || row.project?.projectKey)),
    dirNumber: value("C", row.project?.dirNumber),
    contractorName: value("D", row.project?.contractorName),
  };
}

export function hasConflictingActiveFederalSourceIdentity(
  sourceRows: ActiveFederalSourceRecord[],
  target: ActiveFederalSourceRecord,
): boolean {
  const identity = (source: ActiveFederalSourceRecord) => ({
    name: normalizeMatchValue(readCell(source, "A")),
    projectNumber: normalizeProjectNumber(readCell(source, "B")),
    dirNumber: normalizeMatchValue(readCell(source, "C")),
    contractor: normalizeMatchValue(readCell(source, "D")),
  });
  const current = identity(target);
  return sourceRows.some((source) => {
    if (source.id === target.id) return false;
    const other = identity(source);
    const sharesIdentity = Boolean(
      (current.projectNumber && current.projectNumber === other.projectNumber)
      || (current.dirNumber && current.dirNumber === other.dirNumber)
      || (current.name && current.name === other.name),
    );
    const differs = (left: string, right: string) => Boolean(left || right) && left !== right;
    return sharesIdentity && (
      differs(current.projectNumber, other.projectNumber)
      || differs(current.dirNumber, other.dirNumber)
      || differs(current.name, other.name)
      || differs(current.contractor, other.contractor)
    );
  });
}

export function joinActiveFederalRows<TProject extends FederalProjectMatchRecord>(
  sourceRows: ActiveFederalSourceRecord[],
  candidates: TProject[],
  federalProjects: TProject[],
): ActiveFederalTableRow<TProject>[] {
  const matchProject = (source: ActiveFederalSourceRecord): {
    project?: TProject;
    ambiguous: boolean;
  } => {
    const name = normalizeMatchValue(readCell(source, "A"));
    const contractor = normalizeMatchValue(readCell(source, "D"));
    const chooseCandidate = (matches: TProject[]) => {
      if (matches.length === 1) return { project: matches[0], ambiguous: false };
      if (matches.length < 2) return { ambiguous: false };
      const narrowed = matches.filter((project) =>
        (!name || normalizeMatchValue(project.projectName) === name)
        && (!contractor || normalizeMatchValue(project.contractorName) === contractor),
      );
      return narrowed.length === 1
        ? { project: narrowed[0], ambiguous: false }
        : { ambiguous: true };
    };

    let ambiguous = false;
    const projectNumber = normalizeProjectNumber(readCell(source, "B"));
    const byNumber: { project?: TProject; ambiguous: boolean } = projectNumber ? chooseCandidate(candidates.filter((project) =>
      normalizeProjectNumber(project.projectNumber) === projectNumber
      || normalizeProjectNumber(project.projectKey) === projectNumber,
    )) : { ambiguous: false };
    if (byNumber.project) return byNumber;
    ambiguous ||= byNumber.ambiguous;

    const dirNumber = normalizeMatchValue(readCell(source, "C"));
    const byDirNumber: { project?: TProject; ambiguous: boolean } = dirNumber ? chooseCandidate(candidates.filter((project) =>
      normalizeMatchValue(project.dirNumber) === dirNumber,
    )) : { ambiguous: false };
    if (byDirNumber.project) return byDirNumber;
    ambiguous ||= byDirNumber.ambiguous;

    const byName: { project?: TProject; ambiguous: boolean } = name ? chooseCandidate(candidates.filter((project) =>
      normalizeMatchValue(project.projectName) === name,
    )) : { ambiguous: false };
    if (byName.project) return byName;
    ambiguous ||= byName.ambiguous;
    return { ambiguous };
  };

  const matchedProjectIds = new Set<number>();
  const rows: ActiveFederalTableRow<TProject>[] = [];
  sourceRows.forEach((source) => {
    const match = matchProject(source);
    const project = match.project ?? null;
    if (project) {
      if (matchedProjectIds.has(project.id)) return;
      matchedProjectIds.add(project.id);
    }
    rows.push({
      key: `excel-${source.id}`,
      project,
      source,
      matchState: project ? "matched" : match.ambiguous ? "ambiguous" : "unmatched",
    });
  });

  federalProjects.forEach((project) => {
    if (!matchedProjectIds.has(project.id)) {
      rows.push({ key: `project-${project.id}`, project, source: null, matchState: "matched" });
    }
  });
  return rows;
}
