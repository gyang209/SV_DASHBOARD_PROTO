import type {
  DatabaseCatalog,
  DatabaseRowUpdate,
  DatabaseRowUpdateResponse,
  DatabaseRows,
  DatabaseRowsQuery,
  DatabaseTable,
} from "@workspace/api-zod";
import { getSqlPool, quoteSqlIdentifier, safeQuery, sql } from "./sqlServer";

type DbRow = Record<string, unknown>;
type ColumnInfo = DatabaseTable["columns"][number] & { ordinal: number };

export class DatabaseRowUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseRowUpdateError";
  }
}

const visibleSchemas = new Set([
  "labor_compliance",
  "labor_compliance_excel_stage",
  "labor_compliance_excel_app",
]);
let catalogCache: DatabaseCatalog | null = null;
let catalogCachedAt = 0;
let catalogLoad: Promise<DatabaseCatalog> | null = null;

function quoteSqlString(value: string): string {
  return `N'${value.replaceAll("'", "''")}'`;
}

function normalizeCell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  return value;
}

const editableTypes = new Set([
  "bigint", "binary", "bit", "char", "date", "datetime", "datetime2",
  "datetimeoffset", "decimal", "float", "int", "money", "nchar",
  "numeric", "nvarchar", "real", "smallint", "smallmoney", "smalldatetime",
  "time", "tinyint", "uniqueidentifier", "varbinary", "varchar", "xml",
]);

function sqlTypeForColumn(column: DatabaseTable["columns"][number]): string {
  const type = column.dataType.toLowerCase();
  if (!editableTypes.has(type)) {
    throw new DatabaseRowUpdateError(`The ${column.name} column uses a type that cannot be edited here.`);
  }
  if (type === "decimal" || type === "numeric") {
    const precision = column.precision ?? 18;
    const scale = column.scale ?? 0;
    return `${type}(${precision},${scale})`;
  }
  if (["datetime2", "datetimeoffset", "time"].includes(type)) {
    return `${type}(${column.scale ?? 7})`;
  }
  if (["char", "nchar", "varchar", "nvarchar", "binary", "varbinary"].includes(type)) {
    const bytes = column.maxLength ?? -1;
    const length = bytes < 0 ? "max" : String(type.startsWith("n") ? Math.max(1, Math.floor(bytes / 2)) : bytes);
    return `${type}(${length})`;
  }
  return type;
}

function sqlParameterValue(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  throw new DatabaseRowUpdateError("Only scalar database values can be updated.");
}

function binaryValue(value: unknown): Buffer | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new DatabaseRowUpdateError("Binary values must be supplied as base64 text.");
  const normalized = value.replace(/=+$/, "");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== normalized) {
    throw new DatabaseRowUpdateError("Binary values must be valid base64 text.");
  }
  return decoded;
}

function isBinaryColumn(column: DatabaseTable["columns"][number]): boolean {
  return ["binary", "varbinary"].includes(column.dataType.toLowerCase());
}

function bindDatabaseValue(
  request: import("mssql").Request,
  parameter: string,
  column: DatabaseTable["columns"][number],
  value: unknown,
): string {
  if (isBinaryColumn(column)) {
    request.input(parameter, sql.VarBinary(sql.MAX), binaryValue(value));
    return `@${parameter}`;
  }
  request.input(parameter, sql.NVarChar(sql.MAX), sqlParameterValue(value));
  return `TRY_CONVERT(${sqlTypeForColumn(column)}, @${parameter})`;
}

function validateColumnValue(
  column: DatabaseTable["columns"][number],
  value: unknown,
): void {
  if (value === null) {
    if (!column.nullable) throw new DatabaseRowUpdateError(`${column.name} cannot be NULL.`);
    return;
  }
  const type = column.dataType.toLowerCase();
  if (["binary", "varbinary"].includes(type)) {
    const decoded = binaryValue(value);
    if (decoded && column.maxLength !== null && column.maxLength > 0 && decoded.length > column.maxLength) {
      throw new DatabaseRowUpdateError(`${column.name} is longer than the SQL Server column allows.`);
    }
    return;
  }
  const valueString = sqlParameterValue(value) ?? "";
  const textTypes = new Set(["char", "nchar", "nvarchar", "varchar", "xml"]);
  if (!valueString && !textTypes.has(type)) {
    throw new DatabaseRowUpdateError(`${column.name} must contain a value or be explicitly set to NULL.`);
  }
  if (["char", "nchar", "nvarchar", "varchar"].includes(type) && column.maxLength !== null && column.maxLength > 0) {
    const limit = type.startsWith("n") ? Math.floor(column.maxLength / 2) : column.maxLength;
    if (valueString.length > limit) {
      throw new DatabaseRowUpdateError(`${column.name} is longer than the SQL Server column allows.`);
    }
  }
}

function escapedLike(value: string): string {
  return value.replace(/[~%_[\]]/g, (character) => `~${character}`);
}

async function loadDatabaseCatalog(): Promise<DatabaseCatalog> {
  const pool = await getSqlPool();
  const columnsResult = await safeQuery(
    pool.request(),
    `SELECT s.name AS schemaName, t.name AS tableName, c.name AS columnName,
       ty.name AS dataType, c.is_nullable AS nullable, c.column_id AS ordinal,
        CASE WHEN pk.column_id IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS primaryKey,
        c.is_identity AS identityFlag, c.is_computed AS computed,
        c.max_length AS maxLengthBytes, c.precision AS precisionValue,
        c.scale AS scaleValue
     FROM sys.tables t
     JOIN sys.schemas s ON s.schema_id = t.schema_id
     JOIN sys.columns c ON c.object_id = t.object_id
     JOIN sys.types ty ON ty.user_type_id = c.user_type_id
     LEFT JOIN (
       SELECT ic.object_id, ic.column_id
       FROM sys.indexes i
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       WHERE i.is_primary_key = 1
     ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
     WHERE t.is_ms_shipped = 0
       AND s.name IN (N'labor_compliance', N'labor_compliance_excel_stage', N'labor_compliance_excel_app')
     ORDER BY s.name, t.name, c.column_id`
  );
  const groups = new Map<string, { schemaName: string; tableName: string; columns: ColumnInfo[] }>();
  for (const row of columnsResult.recordset as DbRow[]) {
    const schemaName = String(row.schemaName);
    const tableName = String(row.tableName);
    if (!visibleSchemas.has(schemaName)) continue;
    const key = `${schemaName}.${tableName}`;
    const group = groups.get(key) ?? { schemaName, tableName, columns: [] };
    const column: ColumnInfo = {
      name: String(row.columnName),
      dataType: String(row.dataType),
      nullable: row.nullable === true,
      primaryKey: row.primaryKey === true,
      identity: row.identityFlag === true,
      computed: row.computed === true,
      editable: false,
      maxLength: Number(row.maxLengthBytes),
      precision: Number(row.precisionValue),
      scale: Number(row.scaleValue),
      ordinal: Number(row.ordinal),
    };
    column.editable =
      !column.primaryKey &&
      !column.identity &&
      !column.computed &&
      editableTypes.has(column.dataType.toLowerCase());
    group.columns.push(column);
    groups.set(key, group);
  }

  const tableGroups = [...groups.values()].sort((left, right) =>
    `${left.schemaName}.${left.tableName}`.localeCompare(
      `${right.schemaName}.${right.tableName}`,
    ),
  );
  const countStatements = tableGroups.map(
    (table) =>
      `SELECT ${quoteSqlString(table.schemaName)} AS schemaName, ` +
      `${quoteSqlString(table.tableName)} AS tableName, COUNT_BIG(*) AS recordCount ` +
      `FROM ${quoteSqlIdentifier(table.schemaName)}.${quoteSqlIdentifier(table.tableName)}`,
  );
  const countsResult = countStatements.length
    ? await safeQuery(pool.request(), countStatements.join(" UNION ALL "))
    : { recordset: [] as DbRow[] };
  const countByTable = new Map(
    (countsResult.recordset as DbRow[]).map((row) => [
      `${row.schemaName}.${row.tableName}`,
      Number(row.recordCount),
    ]),
  );

  const tables: DatabaseTable[] = tableGroups.map((group) => ({
    schemaName: group.schemaName,
    tableName: group.tableName,
    recordCount: countByTable.get(`${group.schemaName}.${group.tableName}`) ?? 0,
    columns: group.columns.map(({ ordinal: _ordinal, ...column }) => column),
  }));
  return { tables, refreshedAt: new Date() };
}

export async function getDatabaseCatalog(
  forceRefresh = false,
): Promise<DatabaseCatalog> {
  if (!forceRefresh && catalogCache && Date.now() - catalogCachedAt < 60_000) {
    return catalogCache;
  }
  if (!catalogLoad) {
    catalogLoad = loadDatabaseCatalog()
      .then((catalog) => {
        catalogCache = catalog;
        catalogCachedAt = Date.now();
        return catalog;
      })
      .finally(() => {
        catalogLoad = null;
      });
  }
  return catalogLoad;
}

export function invalidateDatabaseCatalog(): void {
  catalogCache = null;
  catalogCachedAt = 0;
}

export async function getDatabaseTableRows(
  schemaName: string,
  tableName: string,
  input: DatabaseRowsQuery,
): Promise<DatabaseRows> {
  const catalog = await getDatabaseCatalog();
  const table = catalog.tables.find(
    (candidate) =>
      candidate.schemaName === schemaName && candidate.tableName === tableName,
  );
  if (!table) throw new Error("The requested SQL Server table was not found.");

  const page = Math.max(1, Math.trunc(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize || 50)));
  const offset = (page - 1) * pageSize;
  const searchableColumns = table.columns.filter(
    (column) => !["image", "varbinary", "binary", "geometry", "geography"].includes(column.dataType.toLowerCase()),
  );
  const search = (input.search ?? "").trim();
  const whereClause =
    search && searchableColumns.length
      ? `WHERE (${searchableColumns
          .map(
            (column) =>
              `TRY_CONVERT(nvarchar(max), ${quoteSqlIdentifier(column.name)}) LIKE @search ESCAPE N'~'`,
          )
          .join(" OR ")})`
      : "";
  const qualifiedTable = `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
  const pool = await getSqlPool();

  const countRequest = pool.request();
  if (whereClause) {
    countRequest.input(
      "search",
      sql.NVarChar(sql.MAX),
      `%${escapedLike(search)}%`,
    );
  }
  const countResult = await safeQuery(
    countRequest,
    `SELECT COUNT_BIG(*) AS total FROM ${qualifiedTable} ${whereClause}`,
  );
  const total = Number((countResult.recordset[0] as DbRow).total);

  const orderColumns = table.columns.filter((column) => column.primaryKey);
  const stableOrder =
    orderColumns.length > 0
      ? orderColumns
      : table.columns.slice(0, 1);
  const orderClause = stableOrder.length
    ? stableOrder.map((column) => quoteSqlIdentifier(column.name)).join(", ")
    : "(SELECT NULL)";
  const rowsRequest = pool
    .request()
    .input("offset", sql.Int, offset)
    .input("pageSize", sql.Int, pageSize);
  if (whereClause) {
    rowsRequest.input(
      "search",
      sql.NVarChar(sql.MAX),
      `%${escapedLike(search)}%`,
    );
  }
  const rowsResult = await safeQuery(
    rowsRequest,
    `SELECT * FROM ${qualifiedTable} ${whereClause}
     ORDER BY ${orderClause}
     OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
  );
  const rows = (rowsResult.recordset as DbRow[]).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, normalizeCell(value)]),
    ),
  );
  return {
    schemaName,
    tableName,
    columns: table.columns,
    rows,
    total,
    page,
    pageSize,
  };
}

export async function updateDatabaseTableRow(
  schemaName: string,
  tableName: string,
  input: DatabaseRowUpdate,
): Promise<DatabaseRowUpdateResponse> {
  const catalog = await getDatabaseCatalog();
  const table = catalog.tables.find(
    (candidate) =>
      candidate.schemaName === schemaName && candidate.tableName === tableName,
  );
  if (!table) throw new DatabaseRowUpdateError("The requested SQL Server table was not found.");

  const keyColumns = table.columns.filter((column) => column.primaryKey);
  if (!keyColumns.length) throw new DatabaseRowUpdateError("Rows in this table do not have a stable primary key.");
  const suppliedKeys = Object.keys(input.key);
  if (
    suppliedKeys.length !== keyColumns.length ||
    keyColumns.some((column) => !(column.name in input.key))
  ) {
    throw new DatabaseRowUpdateError("Provide every primary-key value for the row.");
  }

  const updates = Object.entries(input.values);
  if (!updates.length) throw new DatabaseRowUpdateError("Choose at least one field to update.");
  const columnsByName = new Map(table.columns.map((column) => [column.name, column]));
  const updateColumns = updates.map(([name]) => {
    const column = columnsByName.get(name);
    if (!column || !column.editable) {
      throw new DatabaseRowUpdateError(`The ${name} column cannot be edited.`);
    }
    validateColumnValue(column, input.values[name]);
    return column;
  });

  const pool = await getSqlPool();
  const request = pool.request();
  const assignments: string[] = [];
  for (const [index, [name, value]] of updates.entries()) {
    const column = updateColumns[index];
    const parameter = `value${index}`;
    const expression = bindDatabaseValue(request, parameter, column, value);
    if (!isBinaryColumn(column)) {
      const validateResult = await safeQuery(
        request,
        `SELECT CASE WHEN @${parameter} IS NULL OR TRY_CONVERT(${sqlTypeForColumn(column)}, @${parameter}) IS NOT NULL
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS valid`,
      );
      if ((validateResult.recordset[0] as DbRow)?.valid !== true) {
        throw new DatabaseRowUpdateError(`The value for ${name} is not valid for its SQL Server type.`);
      }
    }
    assignments.push(`${quoteSqlIdentifier(name)} = ${expression}`);
  }

  const conditions: string[] = [];
  for (const [index, column] of keyColumns.entries()) {
    const parameter = `key${index}`;
    const value = sqlParameterValue(input.key[column.name]);
    if (value === null) throw new DatabaseRowUpdateError(`The primary-key value for ${column.name} cannot be empty.`);
    const expression = bindDatabaseValue(request, parameter, column, value);
    conditions.push(`${quoteSqlIdentifier(column.name)} = ${expression}`);
  }
  const qualifiedTable =
    `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
  const updated = await safeQuery(
    request,
    `UPDATE ${qualifiedTable}
     SET ${assignments.join(", ")}
     OUTPUT INSERTED.${quoteSqlIdentifier(keyColumns[0].name)} AS updatedKey
     WHERE ${conditions.join(" AND ")}`,
  );
  if (updated.recordset.length !== 1) {
    throw new DatabaseRowUpdateError("The row could not be found or was not updated.");
  }
  return { updated: true, schemaName, tableName };
}
