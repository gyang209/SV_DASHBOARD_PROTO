import type {
  ReferenceOnlyCatalog,
  ReferenceOnlyProject,
  ReferenceOnlyRelatedRecord,
  ReferenceOnlySourceRow,
} from "@workspace/api-zod";
import { getSqlPool, quoteSqlIdentifier, safeQuery } from "./sqlServer";
import { ensureTrashStorageForReads } from "./trash";

type DbRow = Record<string, unknown>;

const referenceRelatedTables = [
  "ContractorObservations",
  "FederalProjects",
  "InformationNeeds",
  "Issues",
  "ProjectContractors",
  "ProjectIdentifiers",
  "ProjectNames",
  "Withholdings",
] as const;

let cachedCatalog: ReferenceOnlyCatalog | null = null;
let cachedAt = 0;
let catalogLoad: Promise<ReferenceOnlyCatalog> | null = null;
let catalogGeneration = 0;

function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  return value;
}

function parseCells(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, cell]) => [
          key,
          normalizeValue(cell),
        ]),
      );
    }
  } catch {
    return { raw: value };
  }
  return {};
}

function valueObject(row: DbRow, exclude: Set<string> = new Set()): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !exclude.has(key))
      .map(([key, value]) => [key, normalizeValue(value)]),
  );
}

async function loadReferenceOnlyData(): Promise<ReferenceOnlyCatalog> {
  await ensureTrashStorageForReads();
  const pool = await getSqlPool();
  const projectsResult = await safeQuery(
    pool.request(),
    `SELECT p.Id AS id, p.ProjectKey AS projectKey, p.Category AS category,
       p.Name AS name, p.SourceRowId AS sourceRowId,
       COALESCE(sh.Name, N'Unknown source') AS sourceSheet,
       sr.ExcelRow AS excelRow, sr.CellsJson AS cellsJson
     FROM labor_compliance_excel_stage.Projects p
     LEFT JOIN labor_compliance_excel_stage.SourceRows sr
       ON sr.Id = p.SourceRowId
      AND NOT EXISTS (
        SELECT 1 FROM labor_compliance_excel_app.Trash trash
        WHERE trash.RecordType = N'sourceRow'
          AND trash.RecordId = CONVERT(nvarchar(120), sr.Id)
      )
     LEFT JOIN labor_compliance_excel_stage.Sheets sh ON sh.Id = sr.SheetId
     WHERE p.ResolutionStatus = N'ReferenceOnly'
       AND NOT EXISTS (
         SELECT 1 FROM labor_compliance_excel_app.Trash trash
         WHERE trash.RecordType = N'project'
           AND trash.RecordId = CONVERT(nvarchar(120), p.Id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM labor_compliance_excel_app.Trash trash
         WHERE trash.RecordType = N'sourceRow'
           AND trash.RecordId = CONVERT(nvarchar(120), p.SourceRowId)
       )
     ORDER BY sh.Name, sr.ExcelRow, p.Id`,
  );

  const recordsById = new Map<number, ReferenceOnlyProject>();
  const sourceRowsByProject = new Map<number, Map<number, ReferenceOnlySourceRow>>();

  const addSourceRow = (
    projectId: number,
    sourceRowId: unknown,
    sourceSheet: unknown,
    excelRow: unknown,
    cellsJson: unknown,
  ): void => {
    const id = integer(sourceRowId);
    if (id === null) return;
    const projectRows = sourceRowsByProject.get(projectId) ?? new Map();
    projectRows.set(id, {
      id,
      sourceSheet: typeof sourceSheet === "string" ? sourceSheet : "Unknown source",
      excelRow: integer(excelRow) ?? 0,
      cells: parseCells(cellsJson),
    });
    sourceRowsByProject.set(projectId, projectRows);
  };

  for (const row of projectsResult.recordset as DbRow[]) {
    const id = integer(row.id);
    if (id === null) continue;
    recordsById.set(id, {
      id,
      projectKey: String(row.projectKey ?? ""),
      category: String(row.category ?? ""),
      name: String(row.name ?? ""),
      sourceSheet: String(row.sourceSheet ?? "Unknown source"),
      excelRow: integer(row.excelRow),
      sourceRows: [],
      relatedRecords: [],
    });
    addSourceRow(id, row.sourceRowId, row.sourceSheet, row.excelRow, row.cellsJson);
  }

  const relatedResults = await Promise.all(
    referenceRelatedTables.map(async (tableName) => {
      const quotedTable = quoteSqlIdentifier(tableName);
      const result = await safeQuery(
        pool.request(),
        `SELECT related.*, sourceSheet.Name AS __sourceSheet,
           sourceRow.ExcelRow AS __excelRow, sourceRow.CellsJson AS __cellsJson
         FROM labor_compliance_excel_stage.${quotedTable} related
         JOIN labor_compliance_excel_stage.Projects project
           ON project.Id = related.ProjectId
          AND project.ResolutionStatus = N'ReferenceOnly'
           AND NOT EXISTS (
             SELECT 1 FROM labor_compliance_excel_app.Trash trash
             WHERE trash.RecordType = N'project'
               AND trash.RecordId = CONVERT(nvarchar(120), project.Id)
           )
         LEFT JOIN labor_compliance_excel_stage.SourceRows sourceRow
           ON sourceRow.Id = related.SourceRowId
           AND NOT EXISTS (
             SELECT 1 FROM labor_compliance_excel_app.Trash trash
             WHERE trash.RecordType = N'sourceRow'
               AND trash.RecordId = CONVERT(nvarchar(120), sourceRow.Id)
           )
         LEFT JOIN labor_compliance_excel_stage.Sheets sourceSheet
           ON sourceSheet.Id = sourceRow.SheetId
         ORDER BY related.Id`,
      );
      return { tableName, rows: result.recordset as DbRow[] };
    }),
  );

  const relatedTableCounts = relatedResults.map(({ tableName, rows }) => ({
    name: tableName,
    count: rows.length,
  }));

  for (const { tableName, rows } of relatedResults) {
    for (const row of rows) {
      const projectId = integer(row.ProjectId);
      if (projectId === null) continue;
      const project = recordsById.get(projectId);
      if (!project) continue;
      const recordId = integer(row.Id);
      if (recordId === null) continue;

      project.relatedRecords.push({
        tableName,
        recordId,
        sourceSheet:
          typeof row.__sourceSheet === "string" ? row.__sourceSheet : null,
        excelRow: integer(row.__excelRow),
        fields: valueObject(
          row,
          new Set(["__sourceSheet", "__excelRow", "__cellsJson"]),
        ),
      } satisfies ReferenceOnlyRelatedRecord);
      addSourceRow(
        projectId,
        row.SourceRowId,
        row.__sourceSheet,
        row.__excelRow,
        row.__cellsJson,
      );
    }
  }

  const sourceSheetCounts = new Map<string, number>();
  const allSourceRowIds = new Set<number>();
  for (const [projectId, project] of recordsById) {
    sourceSheetCounts.set(
      project.sourceSheet,
      (sourceSheetCounts.get(project.sourceSheet) ?? 0) + 1,
    );
    const projectSourceRows = sourceRowsByProject.get(projectId);
    if (projectSourceRows) {
      project.sourceRows = [...projectSourceRows.values()].sort(
        (left, right) =>
          left.sourceSheet.localeCompare(right.sourceSheet) ||
          left.excelRow - right.excelRow,
      );
      for (const sourceRow of project.sourceRows) allSourceRowIds.add(sourceRow.id);
    }
    project.relatedRecords.sort(
      (left, right) =>
        left.tableName.localeCompare(right.tableName) ||
        (left.excelRow ?? 0) - (right.excelRow ?? 0) ||
        left.recordId - right.recordId,
    );
  }

  const records = [...recordsById.values()].sort(
    (left, right) =>
      left.sourceSheet.localeCompare(right.sourceSheet) ||
      (left.excelRow ?? 0) - (right.excelRow ?? 0) ||
      left.id - right.id,
  );

  return {
    summary: {
      totalProjects: records.length,
      sourceRowCount: allSourceRowIds.size,
      relatedRecordCount: relatedTableCounts.reduce(
        (total, item) => total + item.count,
        0,
      ),
      sourceSheetCounts: [...sourceSheetCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      relatedTableCounts,
    },
    records,
    refreshedAt: new Date(),
  };
}

export async function getReferenceOnlyData(): Promise<ReferenceOnlyCatalog> {
  if (cachedCatalog && Date.now() - cachedAt < 60_000) return cachedCatalog;
  if (!catalogLoad) {
    const generation = catalogGeneration;
    catalogLoad = loadReferenceOnlyData()
      .then((catalog) => {
        if (generation === catalogGeneration) {
          cachedCatalog = catalog;
          cachedAt = Date.now();
        }
        return catalog;
      })
      .finally(() => {
        if (generation === catalogGeneration) catalogLoad = null;
      });
  }
  return catalogLoad;
}

export function invalidateReferenceOnlyCache(): void {
  catalogGeneration += 1;
  cachedCatalog = null;
  cachedAt = 0;
  catalogLoad = null;
}
