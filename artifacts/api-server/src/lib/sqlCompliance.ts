import { randomUUID } from "node:crypto";
import { createReadCache } from "./readCache";
import { logger } from "./logger";
import type {
  ContractorSubcontractor,
  Contractor,
  Project,
  Withholding,
  WorkbookSheetRow,
  WorkspaceData,
} from "@workspace/api-zod";
import { getSqlPool, safeQuery, sql } from "./sqlServer";
import { ensureTrashStorageForReads } from "./trash";
import {
  readSubcontractorSourceStatus,
  type SubcontractorSourceStatus,
} from "./subcontractorSource";
import {
  buildContractorChanges,
  buildProjectChanges,
  buildRecordCreatedChange,
  type RecordFieldChange,
} from "./recordHistory";

type DataInput = Record<string, unknown>;
type DbRow = Record<string, unknown>;

const newRecordIdOffset = 1_000_000_000;
// SQL Server edit tables enforce FieldMask >= 0; this positive sentinel marks all fields.
const fullFieldMask = Number.MAX_SAFE_INTEGER;
const workspaceCache = createReadCache(loadWorkspace, {
  freshMs: 4 * 60_000,
  staleMs: 6 * 60_000,
  maxStaleMs: 60 * 60_000,
  onRefreshError: (err) => logger.warn({ err }, "SQL Server workspace refresh failed"),
});
let projectAppColumnsPromise: Promise<boolean> | null = null;
let recordHistoryStoragePromise: Promise<void> | null = null;

async function ensureRecordHistoryStorage(
  pool: Awaited<ReturnType<typeof getSqlPool>>,
): Promise<void> {
  if (!recordHistoryStoragePromise) {
    recordHistoryStoragePromise = safeQuery(
      pool.request(),
      `IF OBJECT_ID(N'labor_compliance_excel_app.RecordHistory', N'U') IS NULL
       BEGIN
         CREATE TABLE labor_compliance_excel_app.RecordHistory
         (
           Id bigint IDENTITY(1,1) NOT NULL
             CONSTRAINT PK_LaborComplianceRecordHistory PRIMARY KEY,
           RecordType nvarchar(40) NOT NULL,
           RecordId nvarchar(120) NOT NULL,
           ActorId nvarchar(255) NOT NULL,
           ChangesJson nvarchar(max) NOT NULL,
           OccurredAtUtc datetime2(7) NOT NULL,
           CONSTRAINT CK_LaborComplianceRecordHistory_Type
             CHECK (RecordType IN (N'project', N'contractor'))
         );
         CREATE INDEX IX_LaborComplianceRecordHistory_Record
           ON labor_compliance_excel_app.RecordHistory
             (RecordType, RecordId, OccurredAtUtc DESC, Id DESC);
       END;`,
    ).then(() => undefined).catch((error: unknown) => {
      recordHistoryStoragePromise = null;
      throw error;
    });
  }
  await recordHistoryStoragePromise;
}

export type RecordHistoryEvent = {
  id: number;
  recordType: "project" | "contractor";
  recordId: string;
  actorId: string;
  occurredAt: Date;
  changes: RecordFieldChange[];
};

export async function getRecordHistory(
  recordType: "project" | "contractor",
  recordId: number,
): Promise<RecordHistoryEvent[]> {
  const pool = await getSqlPool();
  await ensureRecordHistoryStorage(pool);
  const result = await safeQuery(
    pool.request()
      .input("recordType", sql.NVarChar(40), recordType)
      .input("recordId", sql.NVarChar(120), String(recordId)),
    `WITH CreationEvent AS (
       SELECT Id, RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc
       FROM labor_compliance_excel_app.RecordHistory
       WHERE RecordType = @recordType AND RecordId = @recordId
         AND JSON_VALUE(ChangesJson, '$[0].field') = N'Record created'
     ),
     RecentEvents AS (
       SELECT TOP (500) Id, RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc
       FROM labor_compliance_excel_app.RecordHistory
       WHERE RecordType = @recordType AND RecordId = @recordId
         AND ISNULL(JSON_VALUE(ChangesJson, '$[0].field'), N'') <> N'Record created'
       ORDER BY OccurredAtUtc DESC, Id DESC
     )
     SELECT Id AS id, RecordType AS recordType,
       RecordId AS recordId, ActorId AS actorId,
       ChangesJson AS changesJson, OccurredAtUtc AS occurredAt
     FROM (
       SELECT Id, RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc
       FROM CreationEvent
       UNION ALL
       SELECT Id, RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc
       FROM RecentEvents
     ) AS recordEvents
     ORDER BY OccurredAtUtc ASC, Id ASC`,
  );
  return (result.recordset as DbRow[]).map((row) => ({
    id: number(row.id),
    recordType: text(row.recordType) as RecordHistoryEvent["recordType"],
    recordId: text(row.recordId),
    actorId: text(row.actorId),
    occurredAt: row.occurredAt instanceof Date
      ? row.occurredAt
      : new Date(text(row.occurredAt)),
    changes: JSON.parse(text(row.changesJson)) as RecordFieldChange[],
  }));
}

async function ensureProjectAppColumns(
  pool: Awaited<ReturnType<typeof getSqlPool>>,
): Promise<boolean> {
  if (!projectAppColumnsPromise) {
    projectAppColumnsPromise = pool.request().query(
      `IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form1Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form1Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form2Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form2Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form3Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form3Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form4Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form4Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form1Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form1Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form2Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form2Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form3Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form3Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form4Status') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form4Status nvarchar(40) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'FederalProjectNumber') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD FederalProjectNumber nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'DavisBaconDetermination') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DavisBaconDetermination nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'FederalSetupInLcp') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD FederalSetupInLcp nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'FederalNotes') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD FederalNotes nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'FederalActive') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD FederalActive nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'FederalProjectNumber') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD FederalProjectNumber nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'DavisBaconDetermination') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD DavisBaconDetermination nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'FederalSetupInLcp') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD FederalSetupInLcp nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'FederalNotes') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD FederalNotes nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'FederalActive') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD FederalActive nvarchar(max) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'PrimeApprover') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD PrimeApprover nvarchar(1000) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'PrimeApprover') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD PrimeApprover nvarchar(1000) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'DesignProjectManager') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DesignProjectManager nvarchar(1000) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'DesignProjectManagerEmail') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DesignProjectManagerEmail nvarchar(1000) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'DesignWeekStart') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DesignWeekStart date NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'DesignWeekEnd') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DesignWeekEnd date NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'DesignPwcrExpirationDate') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DesignPwcrExpirationDate date NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'DesignPwcrExpirationDateEdited') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DesignPwcrExpirationDateEdited bit NOT NULL CONSTRAINT DF_LCEA_ProjectEdits_DesignPwcrExpirationDateEdited DEFAULT (0);
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'DesignProjectManager') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD DesignProjectManager nvarchar(1000) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'DesignProjectManagerEmail') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD DesignProjectManagerEmail nvarchar(1000) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'DesignWeekStart') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD DesignWeekStart date NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'DesignWeekEnd') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD DesignWeekEnd date NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'DesignPwcrExpirationDate') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD DesignPwcrExpirationDate date NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'DesignPwcrExpirationDateEdited') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD DesignPwcrExpirationDateEdited bit NOT NULL CONSTRAINT DF_LCEA_NewProjects_DesignPwcrExpirationDateEdited DEFAULT (0);
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'RegistrationBypass') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD RegistrationBypass bit NOT NULL CONSTRAINT DF_LCEA_ProjectEdits_RegistrationBypass DEFAULT (0);
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'RegistrationBypassStatus') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD RegistrationBypassStatus nvarchar(20) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'PayrollFormsBypass') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD PayrollFormsBypass bit NOT NULL CONSTRAINT DF_LCEA_ProjectEdits_PayrollFormsBypass DEFAULT (0);
       IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'PayrollFormsBypassStatus') IS NULL
         ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD PayrollFormsBypassStatus nvarchar(20) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'RegistrationBypass') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD RegistrationBypass bit NOT NULL CONSTRAINT DF_LCEA_NewProjects_RegistrationBypass DEFAULT (0);
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'RegistrationBypassStatus') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD RegistrationBypassStatus nvarchar(20) NULL;
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'PayrollFormsBypass') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD PayrollFormsBypass bit NOT NULL CONSTRAINT DF_LCEA_NewProjects_PayrollFormsBypass DEFAULT (0);
       IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'PayrollFormsBypassStatus') IS NULL
         ALTER TABLE labor_compliance_excel_app.NewProjects ADD PayrollFormsBypassStatus nvarchar(20) NULL;`,
    ).then(() => true).catch((error: unknown) => {
      logger.warn({ err: error }, "Could not ensure app-owned project fields");
      return false;
    });
  }
  return projectAppColumnsPromise;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  return /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? null;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function boolText(value: unknown): boolean {
  const normalized = text(value).trim().toLowerCase();
  return ["yes", "true", "1", "registered", "complete"].includes(normalized);
}

function normalizedKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromToday(value: string): number {
  const target = Date.parse(`${value}T00:00:00.000Z`);
  const current = Date.parse(`${today()}T00:00:00.000Z`);
  return Math.ceil((target - current) / 86_400_000);
}

function safeFormsStatus(value: unknown): Project["formsStatus"] {
  if (text(value) === "Projects with all forms") return "Projects with all forms";
  if (text(value) === "Projects with missing forms") return "Projects with missing forms";
  return "Not tracked";
}

function safeFormStatus(value: unknown): Project["form1Status"] {
  const normalized = text(value);
  if (normalized === "Not checked" || normalized === "Complete" || normalized === "Missing") {
    return normalized;
  }
  return "Not tracked";
}

function safeBypassStatus(value: unknown): "" | "OK" | "Completed" {
  const normalized = text(value).trim();
  return normalized === "OK" || normalized === "Completed" ? normalized : "";
}

const individualFormStatusKeys = [
  "form1Status",
  "form2Status",
  "form3Status",
  "form4Status",
] as const;

function hasNonDefaultFormStatuses(input: DataInput): boolean {
  return individualFormStatusKeys.some(
    (key) => key in input && safeFormStatus(input[key]) !== "Not tracked",
  );
}

function formStatusesChanged(input: DataInput, current: Project): boolean {
  return individualFormStatusKeys.some(
    (key) => key in input && safeFormStatus(input[key]) !== current[key],
  );
}

const federalProjectTextKeys = [
  "federalProjectNumber",
  "davisBaconDetermination",
  "federalSetupInLcp",
  "federalNotes",
  "federalActive",
] as const;

const projectBypassFieldKeys = [
  "registrationBypass",
  "registrationBypassStatus",
  "payrollFormsBypass",
  "payrollFormsBypassStatus",
] as const;

function hasProjectBypassValues(input: DataInput): boolean {
  return input.registrationBypass === true
    || Boolean(text(input.registrationBypassStatus).trim())
    || input.payrollFormsBypass === true
    || Boolean(text(input.payrollFormsBypassStatus).trim());
}

function hasFederalProjectTextValues(input: DataInput): boolean {
  return federalProjectTextKeys.some(
    (key) => key in input && text(input[key]).trim().length > 0,
  );
}

const designProjectFieldKeys = [
  "designProjectManager",
  "designProjectManagerEmail",
  "designWeekStart",
  "designWeekEnd",
  "designPwcrExpirationDate",
] as const;
const dateProjectFieldKeys = new Set<string>([
  "designWeekStart",
  "designWeekEnd",
  "designPwcrExpirationDate",
]);

function projectFieldChanged(
  input: DataInput,
  current: Project,
  key: string,
): boolean {
  if (!(key in input)) return false;
  return dateProjectFieldKeys.has(key)
    ? date(input[key]) !== date(current[key as keyof Project])
    : text(input[key]) !== text(current[key as keyof Project]);
}

function projectFieldsChanged(
  input: DataInput,
  current: Project,
  keys: readonly string[],
): boolean {
  return keys.some((key) => projectFieldChanged(input, current, key));
}

function hasDesignProjectValues(input: DataInput): boolean {
  return designProjectFieldKeys.some((key) =>
    dateProjectFieldKeys.has(key)
      ? date(input[key]) !== null
      : text(input[key]).trim().length > 0,
  );
}

export function mapSqlProject(row: DbRow): Project {
  const projectName = text(row.projectName);
  const projectNumber = text(row.projectNumber);
  const dirNumber = text(row.dirNumber);
  const sourceSheets = text(row.sourceSheets);
  const paymentDueDate = date(row.paymentDueDate);
  const paymentDate = date(row.paymentDate);
  const hasSourceSheetList = sourceSheets.trim().length > 0;
  const daysUntilDue =
    paymentDueDate && !paymentDate ? daysFromToday(paymentDueDate) : null;
  const category = text(row.category).toLowerCase();
  const pasCipSourceText = (hasSourceSheetList ? sourceSheets : text(row.sourceSheet)).toLowerCase();
  return {
    id: number(row.id),
    projectKey: text(row.projectKey),
    projectNumber,
    projectName,
    dirNumber,
    classification: text(row.classification),
    contractorId: nullableNumber(row.contractorId),
    contractorName: text(row.contractorName),
    intakeDate: date(row.intakeDate),
    registrationStatus: text(row.registrationStatus) || "Not checked",
    registrationBypass: bool(row.registrationBypass),
    registrationBypassStatus: safeBypassStatus(row.registrationBypassStatus),
    registrationCheckedOn: date(row.registrationCheckedOn),
    payrollFormsStatus: text(row.payrollFormsStatus) || "Not checked",
    payrollFormsBypass: bool(row.payrollFormsBypass),
    payrollFormsBypassStatus: safeBypassStatus(row.payrollFormsBypassStatus),
    payrollFormsCheckedOn: date(row.payrollFormsCheckedOn),
    formsStatus: safeFormsStatus(row.formsStatus),
    form1Status: safeFormStatus(row.form1Status),
    form2Status: safeFormStatus(row.form2Status),
    form3Status: safeFormStatus(row.form3Status),
    form4Status: safeFormStatus(row.form4Status),
    paymentDueDate,
    paymentDate,
    complianceNotes: text(row.complianceNotes),
    projectInitiationDate: date(row.projectInitiationDate),
    projectFinishDate: date(row.projectFinishDate),
    pwc100: bool(row.pwc100) || boolText(row.pwc100Text),
    pwc100RegisteredDate: date(row.pwc100RegisteredDate),
    pwc100ExpirationDate: date(row.pwc100ExpirationDate),
    designProjectManager:
      row.designProjectManager === null || row.designProjectManager === undefined
        ? text(row.primeApprover)
        : text(row.designProjectManager),
    designProjectManagerEmail: text(row.designProjectManagerEmail),
    designWeekStart: date(row.designWeekStart),
    designWeekEnd: date(row.designWeekEnd),
    designPwcrExpirationDate: date(row.designPwcrExpirationDate),
    primeApprover: text(row.primeApprover),
    federalProject: bool(row.federalProject),
    federalProjectNumber: nullableText(row.federalProjectNumber),
    davisBaconDetermination: nullableText(row.davisBaconDetermination),
    federalSetupInLcp: nullableText(row.federalSetupInLcp),
    federalNotes: nullableText(row.federalNotes),
    federalActive: nullableText(row.federalActive),
    designProject:
      row.designProject === null || row.designProject === undefined
        ? category === "design"
        : bool(row.designProject),
    onCall:
      row.onCall === null || row.onCall === undefined
        ? category === "oncall_nonpas"
        : bool(row.onCall),
    pasCipDpw: hasSourceSheetList
      ? pasCipSourceText.includes("pas cip")
      : category === "cip_dpw" || pasCipSourceText.includes("pas cip"),
    latePayment:
      paymentDueDate !== null &&
      (paymentDate
        ? paymentDate > paymentDueDate
        : daysFromToday(paymentDueDate) < 0),
    daysUntilDue,
    sourceSheets,
  };
}

export function mapSqlContractor(row: DbRow): Contractor {
  return {
    id: number(row.id),
    name: text(row.name),
    aliases: text(row.aliases),
    sourceCount: number(row.sourceCount),
    sourceSheets: text(row.sourceSheets),
    projectCount: number(row.projectCount),
    subcontractorCount: number(row.subcontractorCount),
    subcontractors: Array.isArray(row.subcontractors)
      ? row.subcontractors as ContractorSubcontractor[]
      : [],
  };
}

export function resolvePrimaryContractorId(
  project: Pick<Project, "contractorId" | "contractorName">,
  contractors: readonly Pick<Contractor, "id" | "name" | "aliases">[],
): number | null {
  const knownId = project.contractorId;
  if (knownId !== null && contractors.some((contractor) => contractor.id === knownId)) {
    return knownId;
  }

  const normalizeName = (value: string) =>
    value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const projectNameKey = normalizeName(text(project.contractorName));
  if (!projectNameKey) return null;

  const matches = contractors.filter((contractor) =>
    [contractor.name, ...contractor.aliases.split(/[,;|]/)]
      .some((name) => normalizeName(name) === projectNameKey),
  );
  return matches.length === 1 ? matches[0].id : null;
}

export function mapSqlWithholding(row: DbRow): Withholding {
  const releaseDate = date(row.releaseDate);
  const releaseDateText = text(row.releaseDateText);
  return {
    id: number(row.id),
    projectId: nullableNumber(row.projectId),
    contractorId: nullableNumber(row.contractorId),
    projectName: text(row.projectName),
    contractorName: text(row.contractorName),
    invoiceReference: text(row.invoiceReference),
    projectNumberOriginal: text(row.projectNumberOriginal),
    projectMatch: text(row.projectMatch),
    amountWithheld: number(row.amountWithheld),
    notificationDate: date(row.notificationDate),
    notificationDateText: text(row.notificationDateText),
    reason: text(row.reason),
    releaseDate,
    releaseDateText,
    releaseReference: text(row.releaseReference),
    notes: text(row.notes),
    released: releaseDate !== null,
  };
}

export class ContractorSubcontractorStorageUnavailable extends Error {
  constructor() {
    super("Run the contractor-subcontractor SQL migration in MIS119ATEMP before managing subcontractor links.");
    this.name = "ContractorSubcontractorStorageUnavailable";
  }
}

export class ContractorSubcontractorLinkInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractorSubcontractorLinkInputError";
  }
}

export class ContractorSubcontractorLinkNotFoundError extends Error {
  constructor() {
    super("The subcontractor link was not found.");
    this.name = "ContractorSubcontractorLinkNotFoundError";
  }
}

export class ContractorSubcontractorLinkConflictError extends Error {
  constructor() {
    super("This subcontractor is already linked to that project.");
    this.name = "ContractorSubcontractorLinkConflictError";
  }
}

async function ensureContractorSubcontractorLinkStorage(
  pool: Awaited<ReturnType<typeof getSqlPool>>,
): Promise<void> {
  const tableCheck = await safeQuery(
    pool.request(),
    `SELECT OBJECT_ID(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'U') AS tableId`,
  );
  if (!number((tableCheck.recordset[0] as DbRow | undefined)?.tableId)) {
    throw new ContractorSubcontractorStorageUnavailable();
  }
}

function newEntityId(databaseId: number): number {
  return newRecordIdOffset + databaseId;
}

function isNewEntityId(id: number): boolean {
  return id >= newRecordIdOffset;
}

function rawNewEntityId(id: number): number {
  return id - newRecordIdOffset;
}

async function loadProjects(pool: Awaited<ReturnType<typeof getSqlPool>>): Promise<Project[]> {
  const projectAppColumnsAvailable = await ensureProjectAppColumns(pool);
  const editFormStatusProjection = projectAppColumnsAvailable
    ? `e.Form1Status AS form1Status, e.Form2Status AS form2Status,
       e.Form3Status AS form3Status, e.Form4Status AS form4Status`
    : `CAST(N'Not tracked' AS nvarchar(40)) AS form1Status,
       CAST(N'Not tracked' AS nvarchar(40)) AS form2Status,
       CAST(N'Not tracked' AS nvarchar(40)) AS form3Status,
       CAST(N'Not tracked' AS nvarchar(40)) AS form4Status`;
  const editBypassProjection = projectAppColumnsAvailable
    ? `CAST(COALESCE(e.RegistrationBypass, 0) AS bit) AS registrationBypass,
       COALESCE(e.RegistrationBypassStatus, N'') AS registrationBypassStatus,
       CAST(COALESCE(e.PayrollFormsBypass, 0) AS bit) AS payrollFormsBypass,
       COALESCE(e.PayrollFormsBypassStatus, N'') AS payrollFormsBypassStatus`
    : `CAST(0 AS bit) AS registrationBypass, CAST(N'' AS nvarchar(20)) AS registrationBypassStatus,
       CAST(0 AS bit) AS payrollFormsBypass, CAST(N'' AS nvarchar(20)) AS payrollFormsBypassStatus`;
  const newFormStatusProjection = projectAppColumnsAvailable
    ? `newProject.Form1Status AS form1Status, newProject.Form2Status AS form2Status,
       newProject.Form3Status AS form3Status, newProject.Form4Status AS form4Status`
    : `CAST(N'Not tracked' AS nvarchar(40)) AS form1Status,
       CAST(N'Not tracked' AS nvarchar(40)) AS form2Status,
       CAST(N'Not tracked' AS nvarchar(40)) AS form3Status,
       CAST(N'Not tracked' AS nvarchar(40)) AS form4Status`;
  const newBypassProjection = projectAppColumnsAvailable
    ? `CAST(COALESCE(newProject.RegistrationBypass, 0) AS bit) AS registrationBypass,
       COALESCE(newProject.RegistrationBypassStatus, N'') AS registrationBypassStatus,
       CAST(COALESCE(newProject.PayrollFormsBypass, 0) AS bit) AS payrollFormsBypass,
       COALESCE(newProject.PayrollFormsBypassStatus, N'') AS payrollFormsBypassStatus`
    : `CAST(0 AS bit) AS registrationBypass, CAST(N'' AS nvarchar(20)) AS registrationBypassStatus,
       CAST(0 AS bit) AS payrollFormsBypass, CAST(N'' AS nvarchar(20)) AS payrollFormsBypassStatus`;
  const editFederalFieldsProjection = projectAppColumnsAvailable
    ? `e.FederalProjectNumber AS federalProjectNumber,
       e.DavisBaconDetermination AS davisBaconDetermination,
       e.FederalSetupInLcp AS federalSetupInLcp, e.FederalNotes AS federalNotes,
       e.FederalActive AS federalActive`
    : `CAST(NULL AS nvarchar(max)) AS federalProjectNumber,
       CAST(NULL AS nvarchar(max)) AS davisBaconDetermination,
       CAST(NULL AS nvarchar(max)) AS federalSetupInLcp,
       CAST(NULL AS nvarchar(max)) AS federalNotes,
       CAST(NULL AS nvarchar(max)) AS federalActive`;
  const newFederalFieldsProjection = projectAppColumnsAvailable
    ? `newProject.FederalProjectNumber AS federalProjectNumber,
       newProject.DavisBaconDetermination AS davisBaconDetermination,
       newProject.FederalSetupInLcp AS federalSetupInLcp,
       newProject.FederalNotes AS federalNotes, newProject.FederalActive AS federalActive`
    : `CAST(NULL AS nvarchar(max)) AS federalProjectNumber,
       CAST(NULL AS nvarchar(max)) AS davisBaconDetermination,
       CAST(NULL AS nvarchar(max)) AS federalSetupInLcp,
       CAST(NULL AS nvarchar(max)) AS federalNotes,
       CAST(NULL AS nvarchar(max)) AS federalActive`;
  const editPrimeApproverProjection = projectAppColumnsAvailable
    ? `COALESCE(e.PrimeApprover, tr.PrimeApprover, N'') AS primeApprover`
    : `COALESCE(tr.PrimeApprover, N'') AS primeApprover`;
  const newPrimeApproverProjection = projectAppColumnsAvailable
    ? `newProject.PrimeApprover AS primeApprover`
    : `CAST(N'' AS nvarchar(1000)) AS primeApprover`;
  const editDesignFieldsProjection = projectAppColumnsAvailable
    ? `COALESCE(e.DesignProjectManager, tr.DesignPM, e.PrimeApprover, tr.PrimeApprover, N'') AS designProjectManager,
       COALESCE(e.DesignProjectManagerEmail, N'') AS designProjectManagerEmail,
       e.DesignWeekStart AS designWeekStart, e.DesignWeekEnd AS designWeekEnd,
       CASE WHEN e.DesignPwcrExpirationDateEdited = 1
         THEN e.DesignPwcrExpirationDate ELSE tr.PWCRExpirationDate END AS designPwcrExpirationDate`
    : `COALESCE(tr.DesignPM, tr.PrimeApprover, N'') AS designProjectManager,
       CAST(N'' AS nvarchar(1000)) AS designProjectManagerEmail,
       CAST(NULL AS date) AS designWeekStart, CAST(NULL AS date) AS designWeekEnd,
       tr.PWCRExpirationDate AS designPwcrExpirationDate`;
  const newDesignFieldsProjection = projectAppColumnsAvailable
    ? `newProject.DesignProjectManager AS designProjectManager,
       newProject.DesignProjectManagerEmail AS designProjectManagerEmail,
       newProject.DesignWeekStart AS designWeekStart,
       newProject.DesignWeekEnd AS designWeekEnd,
       CASE WHEN newProject.DesignPwcrExpirationDateEdited = 1
         THEN newProject.DesignPwcrExpirationDate ELSE NULL END AS designPwcrExpirationDate`
    : `CAST(NULL AS nvarchar(1000)) AS designProjectManager,
       CAST(N'' AS nvarchar(1000)) AS designProjectManagerEmail,
       CAST(NULL AS date) AS designWeekStart, CAST(NULL AS date) AS designWeekEnd,
       CAST(NULL AS date) AS designPwcrExpirationDate`;
  const base = await safeQuery(
    pool.request(),
    `WITH Identifiers AS (
       SELECT ProjectId,
         MAX(CASE WHEN Kind = N'ProjectNumber' THEN OriginalValue END) AS ProjectNumber,
         MAX(CASE WHEN Kind = N'DIR' THEN OriginalValue END) AS DIRNumber
       FROM labor_compliance_excel_stage.ProjectIdentifiers
       GROUP BY ProjectId
     ),
     PrimeRows AS (
       SELECT pc.ProjectId, pc.ContractorId, c.Name AS ContractorName,
         ROW_NUMBER() OVER (PARTITION BY pc.ProjectId ORDER BY pc.Id) AS RowNumber
       FROM labor_compliance_excel_stage.ProjectContractors pc
       JOIN labor_compliance_excel_stage.Contractors c ON c.Id = pc.ContractorId
        WHERE (
          LOWER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(pc.Role)), N' ', N''), N'-', N''), N'_', N'')) LIKE N'prime%'
          OR LOWER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(pc.Role)), N' ', N''), N'-', N''), N'_', N'')) LIKE N'primary%'
        )
          AND NOT EXISTS (
             SELECT 1 FROM labor_compliance_excel_app.Trash trash
             WHERE trash.RecordType = N'contractor'
               AND trash.RecordId = CONVERT(nvarchar(120), c.Id)
           )
            AND NOT EXISTS (
              SELECT 1 FROM labor_compliance_excel_app.Trash trash
              WHERE trash.RecordType = N'sourceRow'
                AND trash.RecordId = CONVERT(nvarchar(120), pc.SourceRowId)
            )
     ),
     TrackingRows AS (
       SELECT t.*,
         ROW_NUMBER() OVER (PARTITION BY t.ProjectId ORDER BY t.SourceRowId DESC, t.Id DESC) AS RowNumber
       FROM labor_compliance_excel_stage.TrackingEntries t
     ),
     InfoRows AS (
       SELECT n.*,
         ROW_NUMBER() OVER (PARTITION BY n.ProjectId ORDER BY n.SourceRowId DESC, n.Id DESC) AS RowNumber
       FROM labor_compliance_excel_stage.InformationNeeds n
     ),
     ProjectNotes AS (
       SELECT ProjectId,
         STRING_AGG(CONVERT(nvarchar(max), NoteText), N' · ') AS Notes
       FROM labor_compliance_excel_stage.SourceNotes
       GROUP BY ProjectId
     )
     SELECT p.Id AS id,
       COALESCE(e.ProjectKey, p.ProjectKey) AS projectKey,
       COALESCE(e.ProjectNumber, i.ProjectNumber, N'') AS projectNumber,
       COALESCE(e.ProjectName, p.Name) AS projectName,
       COALESCE(e.DIRNumber, i.DIRNumber, N'') AS dirNumber,
       COALESCE(e.Classification, N'') AS classification,
       COALESCE(e.PrimaryContractor, pr.ContractorId) AS contractorId,
       COALESCE(newContractor.Name, contractorEdit.Name, selectedContractor.Name, pr.ContractorName) AS contractorName,
       e.IntakeDate AS intakeDate,
       COALESCE(e.RegistrationStatus, tr.LCPThroughText,
         CONVERT(nvarchar(10), tr.LCPThroughDate, 23), N'Not checked') AS registrationStatus,
       e.RegistrationCheckedOn AS registrationCheckedOn,
       COALESCE(e.PayrollFormsStatus, tr.DIRThroughText,
         CONVERT(nvarchar(10), tr.DIRThroughDate, 23), N'Not checked') AS payrollFormsStatus,
        ${editBypassProjection},
       e.PayrollFormsCheckedOn AS payrollFormsCheckedOn,
       e.FormsStatus AS formsStatus,
       ${editFormStatusProjection},
       ${editFederalFieldsProjection},
       e.PaymentDueDate AS paymentDueDate,
       e.PaymentDate AS paymentDate,
       COALESCE(e.ComplianceNotes, pn.Notes, N'') AS complianceNotes,
       COALESCE(e.ProjectInitiationDate, ir.NTPDate) AS projectInitiationDate,
       e.ProjectFinishDate AS projectFinishDate,
       COALESCE(e.PWC100, CASE
         WHEN tr.PWC100RegistrationDate IS NOT NULL THEN CAST(1 AS bit)
         WHEN LOWER(COALESCE(tr.PWC100Text, N'')) IN (N'yes', N'true', N'1') THEN CAST(1 AS bit)
         ELSE CAST(0 AS bit) END) AS pwc100,
       COALESCE(e.PWC100RegisteredDate, tr.PWC100RegistrationDate) AS pwc100RegisteredDate,
       e.PWC100ExpirationDate AS pwc100ExpirationDate,
        ${editDesignFieldsProjection},
       ${editPrimeApproverProjection},
       COALESCE(e.FederalProject, CASE WHEN EXISTS (
         SELECT 1 FROM labor_compliance_excel_stage.FederalProjects fp WHERE fp.ProjectId = p.Id
       ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END) AS federalProject,
       COALESCE(e.DesignProject, CASE WHEN p.Category = N'Design' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END) AS designProject,
       COALESCE(e.OnCall, CASE WHEN p.Category = N'OnCall_NonPAS' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END) AS onCall,
       CASE WHEN p.Category = N'CIP_DPW' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS pasCipDpw,
       p.Category AS category,
       COALESCE(e.SourceSheets, sh.Name, N'') AS sourceSheets,
       sh.Name AS sourceSheet
     FROM labor_compliance_excel_stage.Projects p
     LEFT JOIN Identifiers i ON i.ProjectId = p.Id
     LEFT JOIN PrimeRows pr ON pr.ProjectId = p.Id AND pr.RowNumber = 1
     LEFT JOIN TrackingRows tr ON tr.ProjectId = p.Id AND tr.RowNumber = 1
     LEFT JOIN InfoRows ir ON ir.ProjectId = p.Id AND ir.RowNumber = 1
     LEFT JOIN ProjectNotes pn ON pn.ProjectId = p.Id
     LEFT JOIN labor_compliance_excel_app.ProjectEdits e ON e.RecordId = p.Id
     LEFT JOIN labor_compliance_excel_stage.Contractors selectedContractor
       ON selectedContractor.Id = COALESCE(e.PrimaryContractor, pr.ContractorId)
       AND NOT EXISTS (
         SELECT 1 FROM labor_compliance_excel_app.Trash trash
         WHERE trash.RecordType = N'contractor'
           AND trash.RecordId = CONVERT(nvarchar(120), selectedContractor.Id)
       )
     LEFT JOIN labor_compliance_excel_app.ContractorEdits contractorEdit
       ON contractorEdit.RecordId = selectedContractor.Id
     LEFT JOIN labor_compliance_excel_app.NewContractors newContractor
       ON newContractor.Id = COALESCE(e.PrimaryContractor, pr.ContractorId) - ${newRecordIdOffset}
       AND NOT EXISTS (
         SELECT 1 FROM labor_compliance_excel_app.Trash trash
         WHERE trash.RecordType = N'contractor'
           AND trash.RecordId = CONVERT(nvarchar(120), ${newRecordIdOffset} + newContractor.Id)
       )
     LEFT JOIN labor_compliance_excel_stage.SourceRows sr ON sr.Id = p.SourceRowId
     LEFT JOIN labor_compliance_excel_stage.Sheets sh ON sh.Id = sr.SheetId
      WHERE p.ResolutionStatus = N'MainProjectList'
        AND NOT EXISTS (
          SELECT 1 FROM labor_compliance_excel_app.Trash trash
          WHERE trash.RecordType = N'project'
            AND trash.RecordId = CONVERT(nvarchar(120), p.Id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM labor_compliance_excel_app.Trash trash
          WHERE trash.RecordType = N'sourceRow'
            AND trash.RecordId = CONVERT(nvarchar(120), p.SourceRowId)
        )`
  );

  const added = await safeQuery(
    pool.request(),
    `SELECT newProject.Id AS id, newProject.ProjectKey AS projectKey,
       newProject.ProjectNumber AS projectNumber, newProject.ProjectName AS projectName,
       newProject.DIRNumber AS dirNumber, newProject.Classification AS classification,
       newProject.PrimaryContractor AS contractorId,
       COALESCE(newContractor.Name, contractorEdit.Name, selectedContractor.Name, N'') AS contractorName,
       newProject.IntakeDate AS intakeDate, newProject.RegistrationStatus AS registrationStatus,
        ${newBypassProjection},
       newProject.RegistrationCheckedOn AS registrationCheckedOn,
       newProject.PayrollFormsStatus AS payrollFormsStatus,
       newProject.PayrollFormsCheckedOn AS payrollFormsCheckedOn,
       newProject.FormsStatus AS formsStatus,
       ${newFormStatusProjection},
       ${newFederalFieldsProjection},
       newProject.PaymentDueDate AS paymentDueDate, newProject.PaymentDate AS paymentDate,
       newProject.ComplianceNotes AS complianceNotes,
       newProject.ProjectInitiationDate AS projectInitiationDate,
       newProject.ProjectFinishDate AS projectFinishDate, newProject.PWC100 AS pwc100,
       newProject.PWC100RegisteredDate AS pwc100RegisteredDate,
       newProject.PWC100ExpirationDate AS pwc100ExpirationDate,
        ${newDesignFieldsProjection},
       ${newPrimeApproverProjection},
       newProject.FederalProject AS federalProject,
       newProject.DesignProject AS designProject, newProject.OnCall AS onCall,
       CAST(NULL AS bit) AS pasCipDpw,
       CAST(NULL AS nvarchar(255)) AS category, newProject.SourceSheets AS sourceSheets,
       CAST(NULL AS nvarchar(255)) AS sourceSheet
        FROM labor_compliance_excel_app.NewProjects newProject
     LEFT JOIN labor_compliance_excel_stage.Contractors selectedContractor
       ON selectedContractor.Id = newProject.PrimaryContractor
       AND NOT EXISTS (
         SELECT 1 FROM labor_compliance_excel_app.Trash trash
         WHERE trash.RecordType = N'contractor'
           AND trash.RecordId = CONVERT(nvarchar(120), selectedContractor.Id)
       )
     LEFT JOIN labor_compliance_excel_app.ContractorEdits contractorEdit
       ON contractorEdit.RecordId = selectedContractor.Id
      LEFT JOIN labor_compliance_excel_app.NewContractors newContractor
        ON newContractor.Id = newProject.PrimaryContractor - ${newRecordIdOffset}
       AND NOT EXISTS (
         SELECT 1 FROM labor_compliance_excel_app.Trash trash
         WHERE trash.RecordType = N'contractor'
           AND trash.RecordId = CONVERT(nvarchar(120), ${newRecordIdOffset} + newContractor.Id)
       )
      WHERE NOT EXISTS (
        SELECT 1 FROM labor_compliance_excel_app.Trash trash
        WHERE trash.RecordType = N'project'
          AND trash.RecordId = CONVERT(nvarchar(120), ${newRecordIdOffset} + newProject.Id)
      )`
  );

  const byId = new Map<number, Project>();
  for (const row of base.recordset as DbRow[]) {
    const project = mapSqlProject(row);
    byId.set(project.id, project);
  }
  for (const row of added.recordset as DbRow[]) {
    const project = mapSqlProject({ ...row, id: newEntityId(number(row.id)) });
    byId.set(project.id, project);
  }
  return [...byId.values()].sort((left, right) => left.id - right.id);
}

async function loadContractors(
  pool: Awaited<ReturnType<typeof getSqlPool>>,
  projects: Project[],
): Promise<Contractor[]> {
  const [base, aliases, observations, added, sourceSubcontractors, sourceHeaders, appLinks] = await Promise.all([
    safeQuery(
      pool.request(),
      `SELECT c.Id AS id, COALESCE(e.Name, c.Name) AS name,
         COALESCE(e.Aliases, N'') AS aliases,
         COALESCE(e.SourceCount, 0) AS sourceCount,
         COALESCE(e.SourceSheets, N'') AS sourceSheets
        FROM labor_compliance_excel_stage.Contractors c
        LEFT JOIN labor_compliance_excel_app.ContractorEdits e ON e.RecordId = c.Id
        WHERE NOT EXISTS (
          SELECT 1 FROM labor_compliance_excel_app.Trash trash
          WHERE trash.RecordType = N'contractor'
            AND trash.RecordId = CONVERT(nvarchar(120), c.Id)
        )`
    ),
    safeQuery(
      pool.request(),
      `SELECT ContractorId AS contractorId, Name AS name
       FROM labor_compliance_excel_stage.ContractorAliases`
    ),
    safeQuery(
      pool.request(),
      `SELECT o.ContractorId AS contractorId, o.Id AS id, s.Name AS sourceSheet
       FROM labor_compliance_excel_stage.ContractorObservations o
       LEFT JOIN labor_compliance_excel_stage.SourceRows r ON r.Id = o.SourceRowId
       LEFT JOIN labor_compliance_excel_stage.Sheets s ON s.Id = r.SheetId`
    ),
    safeQuery(
      pool.request(),
      `SELECT Id AS id, Name AS name, COALESCE(Aliases, N'') AS aliases,
         COALESCE(SourceCount, 0) AS sourceCount, COALESCE(SourceSheets, N'') AS sourceSheets
        FROM labor_compliance_excel_app.NewContractors newContractor
        WHERE NOT EXISTS (
          SELECT 1 FROM labor_compliance_excel_app.Trash trash
          WHERE trash.RecordType = N'contractor'
            AND trash.RecordId = CONVERT(nvarchar(120), ${newRecordIdOffset} + newContractor.Id)
        )`
    ),
    safeQuery(
      pool.request(),
      `SELECT pc.Id AS relationshipId, pc.ProjectId AS projectId,
         pc.ContractorId AS subcontractorId, sourceRow.SheetId AS sourceSheetId,
         sourceRow.CellsJson AS sourceCellsJson
       FROM labor_compliance_excel_stage.ProjectContractors pc
       LEFT JOIN labor_compliance_excel_stage.SourceRows sourceRow
         ON sourceRow.Id = pc.SourceRowId
       WHERE LOWER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(pc.Role)), N' ', N''), N'-', N''), N'_', N'')) LIKE N'sub%'
          AND NOT EXISTS (
            SELECT 1 FROM labor_compliance_excel_app.Trash trash
            WHERE trash.RecordType = N'sourceRow'
              AND trash.RecordId = CONVERT(nvarchar(120), sourceRow.Id)
          )
       ORDER BY pc.ProjectId, pc.ContractorId, pc.SourceRowId DESC, pc.Id DESC`
    ),
    safeQuery(
      pool.request(),
      `WITH RankedHeaders AS (
         SELECT SheetId AS sheetId, ExcelRow AS excelRow, CellsJson AS cellsJson,
           ROW_NUMBER() OVER (PARTITION BY SheetId ORDER BY ExcelRow, Id) AS headerRank
         FROM labor_compliance_excel_stage.SourceRows
         WHERE ExcelRow <= 15
       )
       SELECT sheetId, excelRow, cellsJson FROM RankedHeaders
       WHERE headerRank <= 15
       ORDER BY sheetId, excelRow`
    ),
    safeQuery(
      pool.request(),
      `IF OBJECT_ID(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'U') IS NULL
         SELECT CAST(NULL AS int) AS id, CAST(NULL AS int) AS primaryContractorId,
           CAST(NULL AS int) AS subcontractorId, CAST(NULL AS int) AS projectId,
           CAST(NULL AS nvarchar(40)) AS projectType WHERE 1 = 0;
       ELSE
         EXEC sys.sp_executesql N'
           SELECT Id AS id, PrimaryContractorId AS primaryContractorId,
             SubcontractorId AS subcontractorId, ProjectId AS projectId,
             ProjectType AS projectType
            FROM labor_compliance_excel_app.ContractorSubcontractorLinks links
            WHERE NOT EXISTS (
              SELECT 1 FROM labor_compliance_excel_app.Trash trash
              WHERE trash.RecordType = N''subcontractorLink''
                AND trash.RecordId = CONVERT(nvarchar(120), links.Id)
            )
           ORDER BY Id';`
    ),
  ]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const contractorRows = [
    ...(base.recordset as DbRow[]).map((row) => ({ ...row, id: number(row.id) })),
    ...(added.recordset as DbRow[]).map((row) => ({
      ...row,
      id: newEntityId(number(row.id)),
    })),
  ];
  const contractorById = new Map(
    contractorRows.map((row) => [
      number(row.id),
      mapSqlContractor({
        ...row,
        projectCount: 0,
        subcontractorCount: 0,
        subcontractors: [],
      }),
    ]),
  );

  const aliasesById = new Map<number, Set<string>>();
  for (const row of aliases.recordset as DbRow[]) {
    const id = number(row.contractorId);
    const values = aliasesById.get(id) ?? new Set<string>();
    if (text(row.name)) values.add(text(row.name));
    aliasesById.set(id, values);
  }
  const contractorCandidates = [...contractorById.values()].map((contractor) => {
    const id = contractor.id;
    return {
      id,
      name: contractor.name,
      aliases: [
        contractor.aliases,
        ...[...(aliasesById.get(id) ?? [])],
      ].filter(Boolean).join(", "),
    };
  });
  const resolveProjectContractor = (project: Project) =>
    resolvePrimaryContractorId(project, contractorCandidates);

  const projectIdsByContractor = new Map<number, Set<number>>();
  for (const project of projects) {
    const primaryContractorId = resolveProjectContractor(project);
    if (primaryContractorId === null) continue;
    project.contractorId = primaryContractorId;
    const projectIds = projectIdsByContractor.get(primaryContractorId) ?? new Set<number>();
    projectIds.add(project.id);
    projectIdsByContractor.set(primaryContractorId, projectIds);
  }
  const headersBySheet = new Map<number, DbRow[]>();
  for (const row of sourceHeaders.recordset as DbRow[]) {
    const sheetId = number(row.sheetId);
    const rows = headersBySheet.get(sheetId) ?? [];
    rows.push(row);
    headersBySheet.set(sheetId, rows);
  }
  const detailsByPrimary = new Map<number, Map<string, ContractorSubcontractor>>();
  const addDetail = (
    primaryContractorId: number,
    projectId: number,
    subcontractorId: number,
    projectType: string,
    sourceSheetId?: number,
    sourceCellsJson?: unknown,
    linkId: number | null = null,
  ): void => {
    const project = projectById.get(projectId);
    const subcontractor = contractorById.get(subcontractorId);
    if (!project || !subcontractor) return;
    const sheetHeaders = sourceSheetId === undefined ? [] : headersBySheet.get(sourceSheetId) ?? [];
    let sourceStatus: SubcontractorSourceStatus = readSubcontractorSourceStatus(null, null);
    if (sourceCellsJson) {
      for (const headerRow of sheetHeaders) {
        const parsed = readSubcontractorSourceStatus(headerRow.cellsJson, sourceCellsJson);
        if (sourceStatus.completionStatus === "Not checked" && parsed.completionStatus !== "Not checked") {
          sourceStatus = parsed;
        }
        if (sourceStatus.completionStatus === "Complete") break;
      }
    }
    const id = `${projectId}:${subcontractorId}`;
    const detail: ContractorSubcontractor = {
      id,
      linkId,
      projectId,
      projectName: project.projectName,
      projectNumber: project.projectNumber || project.projectKey,
      projectType: projectType || projectTypeLabels(project).join(", ") || "Not specified",
      subcontractorId,
      subcontractorName: subcontractor.name,
      lcpStatus: sourceStatus.lcpStatus,
      dirStatus: sourceStatus.dirStatus,
      completionStatus: sourceStatus.completionStatus,
      projectRegistrationBypass: project.registrationBypass,
      projectRegistrationBypassStatus: project.registrationBypassStatus,
      projectPayrollFormsBypass: project.payrollFormsBypass,
      projectPayrollFormsBypassStatus: project.payrollFormsBypassStatus,
    };
    const details = detailsByPrimary.get(primaryContractorId) ?? new Map();
    const current = details.get(id);
    if (!current) {
      details.set(id, detail);
    } else {
      const hasBetterSourceStatus =
        current.completionStatus === "Not checked" &&
        detail.completionStatus !== "Not checked";
      details.set(id, {
        ...current,
        ...(hasBetterSourceStatus ? {
          lcpStatus: detail.lcpStatus,
          dirStatus: detail.dirStatus,
          completionStatus: detail.completionStatus,
        } : {}),
        ...(linkId !== null ? { projectType: detail.projectType } : {}),
        linkId: linkId ?? current.linkId,
      });
    }
    detailsByPrimary.set(primaryContractorId, details);
  };

  for (const row of sourceSubcontractors.recordset as DbRow[]) {
    const projectId = number(row.projectId);
    const project = projectById.get(projectId);
    if (!project?.contractorId) continue;
    const sourceType = projectTypeLabels(project).join(", ");
    addDetail(
      project.contractorId,
      projectId,
      number(row.subcontractorId),
      sourceType,
      row.sourceSheetId === null || row.sourceSheetId === undefined ? undefined : number(row.sourceSheetId),
      row.sourceCellsJson,
    );
  }
  for (const row of appLinks.recordset as DbRow[]) {
    const projectId = number(row.projectId);
    const project = projectById.get(projectId);
    if (!project) continue;
    const primaryContractorId = resolveProjectContractor(project);
    if (primaryContractorId === null) continue;
    if (!contractorById.has(primaryContractorId)) continue;
    const projectIds = projectIdsByContractor.get(primaryContractorId) ?? new Set<number>();
    projectIds.add(projectId);
    projectIdsByContractor.set(primaryContractorId, projectIds);
    addDetail(
      primaryContractorId,
      projectId,
      number(row.subcontractorId),
      text(row.projectType),
      undefined,
      undefined,
      number(row.id),
    );
  }

  const sourceById = new Map<number, { count: number; sheets: Set<string> }>();
  for (const row of observations.recordset as DbRow[]) {
    const id = number(row.contractorId);
    const current = sourceById.get(id) ?? { count: 0, sheets: new Set<string>() };
    current.count += 1;
    if (text(row.sourceSheet)) current.sheets.add(text(row.sourceSheet));
    sourceById.set(id, current);
  }

  const result = (base.recordset as DbRow[]).map((row) => {
    const id = number(row.id);
    const source = sourceById.get(id);
    const explicitAliases = text(row.aliases);
    const inferredAliases = [...(aliasesById.get(id) ?? [])].join(", ");
    const subcontractors = [...(detailsByPrimary.get(id)?.values() ?? [])]
      .sort((left, right) =>
        left.projectName.localeCompare(right.projectName) ||
        left.subcontractorName.localeCompare(right.subcontractorName),
      );
    return mapSqlContractor({
      ...row,
      aliases: explicitAliases || inferredAliases,
      sourceCount: number(row.sourceCount) || source?.count || 0,
      sourceSheets:
        text(row.sourceSheets) || [...(source?.sheets ?? [])].sort().join(", "),
      projectCount: projectIdsByContractor.get(id)?.size ?? 0,
      subcontractorCount: new Set(subcontractors.map((detail) => detail.subcontractorId)).size,
      subcontractors,
    });
  });
  result.push(
    ...(added.recordset as DbRow[]).map((row) => {
      const id = newEntityId(number(row.id));
      const subcontractors = [...(detailsByPrimary.get(id)?.values() ?? [])]
        .sort((left, right) =>
          left.projectName.localeCompare(right.projectName) ||
          left.subcontractorName.localeCompare(right.subcontractorName),
        );
      return mapSqlContractor({
        ...row,
        id,
        projectCount: projectIdsByContractor.get(id)?.size ?? 0,
        subcontractorCount: new Set(subcontractors.map((detail) => detail.subcontractorId)).size,
        subcontractors,
      });
    }),
  );
  return result.sort((left, right) => left.id - right.id);
}

function projectTypeLabels(project: Project): string[] {
  return [
    project.federalProject ? "Federal" : "",
    project.designProject ? "Design" : "",
    project.onCall ? "On Call" : "",
    project.pasCipDpw ? "PAS CIP+DPW" : "",
  ].filter(Boolean);
}

async function loadWithholdings(
  pool: Awaited<ReturnType<typeof getSqlPool>>,
  projects: Project[],
  contractors: Contractor[],
): Promise<Withholding[]> {
  const [base, added] = await Promise.all([
    safeQuery(
      pool.request(),
      `SELECT w.Id AS id, w.ProjectId AS projectId, w.ContractorId AS contractorId,
         COALESCE(e.ProjectNameOriginal, w.ProjectNameOriginal, p.Name, N'') AS projectName,
         COALESCE(e.ContractorNameOriginal, w.ContractorNameOriginal, c.Name, N'') AS contractorName,
         COALESCE(e.InvoiceReference, w.InvoiceReference, N'') AS invoiceReference,
         COALESCE(e.ProjectNumberOriginal, w.ProjectNumberOriginal, N'') AS projectNumberOriginal,
         COALESCE(e.ProjectMatch, N'') AS projectMatch,
         COALESCE(e.AmountWithheld, w.Amount, 0) AS amountWithheld,
         COALESCE(e.NotificationDate, w.NotificationDate) AS notificationDate,
         COALESCE(e.NotificationDateText, w.NotificationText, N'') AS notificationDateText,
         COALESCE(e.Reason, w.Reason, N'') AS reason,
         COALESCE(e.ReleaseDate, w.ReleaseDate) AS releaseDate,
         COALESCE(e.ReleaseDateText, w.ReleaseDateText, N'') AS releaseDateText,
         COALESCE(e.ReleaseReference, w.ReleaseReference, N'') AS releaseReference,
         COALESCE(e.Notes, w.Notes, N'') AS notes
        FROM labor_compliance_excel_stage.Withholdings w
       LEFT JOIN labor_compliance_excel_stage.Projects p ON p.Id = w.ProjectId
       LEFT JOIN labor_compliance_excel_stage.Contractors c ON c.Id = w.ContractorId
        LEFT JOIN labor_compliance_excel_app.WithholdingEdits e ON e.RecordId = w.Id
        WHERE NOT EXISTS (
          SELECT 1 FROM labor_compliance_excel_app.Trash trash
          WHERE trash.RecordType = N'withholding'
            AND trash.RecordId = CONVERT(nvarchar(120), w.Id)
        )`
    ),
    safeQuery(
      pool.request(),
      `SELECT Id AS id, Project AS projectId, Contractor AS contractorId,
         COALESCE(ProjectNameOriginal, N'') AS projectName,
         COALESCE(ContractorNameOriginal, N'') AS contractorName,
         COALESCE(InvoiceReference, N'') AS invoiceReference,
         COALESCE(ProjectNumberOriginal, N'') AS projectNumberOriginal,
         COALESCE(ProjectMatch, N'') AS projectMatch,
         COALESCE(AmountWithheld, 0) AS amountWithheld,
         NotificationDate AS notificationDate,
         COALESCE(NotificationDateText, N'') AS notificationDateText,
         COALESCE(Reason, N'') AS reason, ReleaseDate AS releaseDate,
         COALESCE(ReleaseDateText, N'') AS releaseDateText,
         COALESCE(ReleaseReference, N'') AS releaseReference,
         COALESCE(Notes, N'') AS notes
        FROM labor_compliance_excel_app.NewWithholdings newWithholding
        WHERE NOT EXISTS (
          SELECT 1 FROM labor_compliance_excel_app.Trash trash
          WHERE trash.RecordType = N'withholding'
            AND trash.RecordId = CONVERT(nvarchar(120), ${newRecordIdOffset} + newWithholding.Id)
        )`
    ),
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const contractorById = new Map(contractors.map((contractor) => [contractor.id, contractor]));
  const mapped = (rows: DbRow[], addedRows: boolean) =>
    rows.map((row) => {
      const projectId = nullableNumber(row.projectId);
      const contractorId = nullableNumber(row.contractorId);
      return mapSqlWithholding({
        ...row,
        id: addedRows ? newEntityId(number(row.id)) : row.id,
        projectName:
          text(row.projectName) ||
          (projectId ? projectById.get(projectId)?.projectName : "") ||
          "",
        contractorName:
          text(row.contractorName) ||
          (contractorId ? contractorById.get(contractorId)?.name : "") ||
          "",
      });
    });
  return [...mapped(base.recordset as DbRow[], false), ...mapped(added.recordset as DbRow[], true)]
    .sort((left, right) => left.id - right.id);
}

async function loadWorkspace(): Promise<WorkspaceData> {
  await ensureTrashStorageForReads();
  const pool = await getSqlPool();
  const projects = await loadProjects(pool);
  const contractors = await loadContractors(pool, projects);
  const withholdings = await loadWithholdings(pool, projects, contractors);
  const outstanding = withholdings.filter((row) => !row.released);
  const dueSoon = projects.filter(
    (project) =>
      project.daysUntilDue !== null &&
      project.daysUntilDue >= 0 &&
      project.daysUntilDue <= 7,
  ).length;
  const overdue = projects.filter((project) => project.latePayment).length;
  return {
    projects,
    contractors,
    withholdings,
    summary: {
      totalProjects: projects.length,
      dueSoon,
      overdue,
      unreleasedWithholdings: outstanding.length,
      amountWithheld: outstanding.reduce(
        (total, row) => total + Number(row.amountWithheld || 0),
        0,
      ),
      refreshedAt: new Date().toISOString(),
    },
  };
}

export async function getWorkspaceData(
  forceRefresh = false,
): Promise<WorkspaceData> {
  return workspaceCache.get(forceRefresh);
}

export async function getWorkbookSheetRows(
  sheetName: string,
): Promise<WorkbookSheetRow[]> {
  await ensureTrashStorageForReads();
  const pool = await getSqlPool();
  const request = pool
    .request()
    .input("sheetName", sql.NVarChar(255), sheetName);
  const result = await safeQuery(
    request,
    `SELECT r.Id AS id, s.Name AS sourceSheet, r.ExcelRow AS excelRow,
       r.CellsJson AS cellsJson
     FROM labor_compliance_excel_stage.SourceRows r
     JOIN labor_compliance_excel_stage.Sheets s ON s.Id = r.SheetId
      WHERE s.Name = @sheetName
        AND NOT EXISTS (
          SELECT 1 FROM labor_compliance_excel_app.Trash trash
          WHERE trash.RecordType = N'sourceRow'
            AND trash.RecordId = CONVERT(nvarchar(120), r.Id)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM labor_compliance_excel_stage.Projects linkedProject
          JOIN labor_compliance_excel_app.Trash trash
            ON trash.RecordType = N'project'
           AND trash.RecordId = CONVERT(nvarchar(120), linkedProject.Id)
          WHERE linkedProject.SourceRowId = r.Id
        )
     ORDER BY r.ExcelRow, r.Id`
  );
  return (result.recordset as DbRow[]).map((row) => ({
    id: number(row.id),
    sourceSheet: text(row.sourceSheet),
    excelRow: number(row.excelRow),
    cellsJson: text(row.cellsJson),
  }));
}

export async function getWorkbookSourceRowById(id: number): Promise<WorkbookSheetRow | null> {
  await ensureTrashStorageForReads();
  const pool = await getSqlPool();
  const result = await safeQuery(
    pool.request().input("id", sql.Int, id),
    `SELECT r.Id AS id, s.Name AS sourceSheet, r.ExcelRow AS excelRow,
       r.CellsJson AS cellsJson
     FROM labor_compliance_excel_stage.SourceRows r
     JOIN labor_compliance_excel_stage.Sheets s ON s.Id = r.SheetId
     WHERE r.Id = @id
       AND NOT EXISTS (
         SELECT 1 FROM labor_compliance_excel_app.Trash trash
         WHERE trash.RecordType = N'sourceRow'
           AND trash.RecordId = CONVERT(nvarchar(120), r.Id)
       )`,
  );
  const row = result.recordset[0] as DbRow | undefined;
  if (!row) return null;
  return {
    id: number(row.id),
    sourceSheet: text(row.sourceSheet),
    excelRow: number(row.excelRow),
    cellsJson: text(row.cellsJson),
  };
}

export type WorkbookSourceRowRelation = {
  id: number;
  sourceSheet: string;
  excelRow: number;
  projectId: number | null;
  projectName: string;
  contractorId: number | null;
  contractorName: string;
  relationshipRole: string;
};

export async function getWorkbookSourceRowRelations(filters: {
  sourceRowId?: number;
  projectId?: number;
}): Promise<WorkbookSourceRowRelation[]> {
  if (filters.sourceRowId === undefined && filters.projectId === undefined) return [];
  const pool = await getSqlPool();
  const result = await safeQuery(
    pool.request()
      .input("sourceRowId", sql.Int, filters.sourceRowId ?? null)
      .input("projectId", sql.Int, filters.projectId ?? null),
    `WITH SourceRelations AS (
       SELECT r.Id AS sourceRowId, s.Name AS sourceSheet, r.ExcelRow AS excelRow,
         p.Id AS projectId, p.Name AS projectName,
         CAST(NULL AS int) AS contractorId,
         CAST(NULL AS nvarchar(1000)) AS contractorName,
         CAST(N'project source' AS nvarchar(100)) AS relationshipRole
       FROM labor_compliance_excel_stage.Projects p
       JOIN labor_compliance_excel_stage.SourceRows r ON r.Id = p.SourceRowId
       JOIN labor_compliance_excel_stage.Sheets s ON s.Id = r.SheetId
       UNION ALL
       SELECT r.Id AS sourceRowId, s.Name AS sourceSheet, r.ExcelRow AS excelRow,
         p.Id AS projectId, p.Name AS projectName,
         c.Id AS contractorId, c.Name AS contractorName,
         COALESCE(pc.Role, N'contractor') AS relationshipRole
       FROM labor_compliance_excel_stage.ProjectContractors pc
       JOIN labor_compliance_excel_stage.SourceRows r ON r.Id = pc.SourceRowId
       JOIN labor_compliance_excel_stage.Sheets s ON s.Id = r.SheetId
       LEFT JOIN labor_compliance_excel_stage.Projects p ON p.Id = pc.ProjectId
       LEFT JOIN labor_compliance_excel_stage.Contractors c ON c.Id = pc.ContractorId
     )
     SELECT DISTINCT sourceRowId AS id, sourceSheet, excelRow, projectId,
       projectName, contractorId, contractorName, relationshipRole
     FROM SourceRelations
     WHERE (@sourceRowId IS NOT NULL AND sourceRowId = @sourceRowId)
        OR (@projectId IS NOT NULL AND projectId = @projectId)
     ORDER BY sourceSheet, excelRow, relationshipRole;`,
  );
  return (result.recordset as DbRow[]).map((row) => ({
    id: number(row.id),
    sourceSheet: text(row.sourceSheet),
    excelRow: number(row.excelRow),
    projectId: nullableNumber(row.projectId),
    projectName: text(row.projectName),
    contractorId: nullableNumber(row.contractorId),
    contractorName: text(row.contractorName),
    relationshipRole: text(row.relationshipRole),
  }));
}

export function invalidateWorkspaceCache(): void {
  workspaceCache.invalidate();
}

function sourceSheetNames(value: unknown): Set<string> {
  const raw = text(value);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === "string"));
    }
  } catch {
    // Older overlays may store a delimited list rather than JSON.
  }
  return new Set(raw.split(/[,;|]/).map((item) => item.trim()).filter(Boolean));
}

export function projectWriteValues(
  input: DataInput,
  current?: Project,
  metadata?: { alternateNames: string; sourceRecordCount: number },
): DbRow {
  const merged = { ...current, ...input } as Record<string, unknown>;
  const projectName = text(merged.projectName).trim();
  const projectNumber = text(merged.projectNumber);
  const dirNumber = text(merged.dirNumber);
  const sourceSheets = sourceSheetNames(merged.sourceSheets);
  for (const [flag, sheet] of [
    ["pasCipDpw", "1. LCP & DIR - PAS CIP+DPW"],
    ["designProject", "2. LCP & DIR - DESIGN"],
    ["onCall", "3. LCP & DIR - ON CALL NON PAS"],
    ["federalProject", "Active Federal Projects"],
  ]) {
    if (typeof merged[flag] !== "boolean") continue;
    if (merged[flag] === true) sourceSheets.add(sheet);
    else sourceSheets.delete(sheet);
  }
  return {
    ProjectKey: text(merged.projectKey) || `LC-${randomUUID().slice(0, 8).toUpperCase()}`,
    ProjectNumber: projectNumber || null,
    ProjectNumbers: JSON.stringify(projectNumber ? [projectNumber] : []),
    DIRNumber: dirNumber || null,
    DIRNumbers: JSON.stringify(dirNumber ? [dirNumber] : []),
    ProjectName: projectName,
    AlternateNames: metadata?.alternateNames ?? "[]",
    Classification: text(merged.classification),
    SourceSheets: JSON.stringify([...sourceSheets]),
    SourceRecordCount: metadata?.sourceRecordCount ?? (current ? 1 : 0),
    PrimaryContractor: nullableNumber(merged.contractorId),
    IntakeDate: date(merged.intakeDate),
    RegistrationStatus: text(merged.registrationStatus) || "Not checked",
    RegistrationBypass: merged.registrationBypass === true,
    RegistrationBypassStatus: merged.registrationBypass === true
      ? text(merged.registrationBypassStatus)
      : "",
    RegistrationCheckedOn: date(merged.registrationCheckedOn),
    PayrollFormsStatus: text(merged.payrollFormsStatus) || "Not checked",
    PayrollFormsBypass: merged.payrollFormsBypass === true,
    PayrollFormsBypassStatus: merged.payrollFormsBypass === true
      ? text(merged.payrollFormsBypassStatus)
      : "",
    PayrollFormsCheckedOn: date(merged.payrollFormsCheckedOn),
    FormsStatus: safeFormsStatus(merged.formsStatus),
    Form1Status: safeFormStatus(merged.form1Status),
    Form2Status: safeFormStatus(merged.form2Status),
    Form3Status: safeFormStatus(merged.form3Status),
    Form4Status: safeFormStatus(merged.form4Status),
    DesignProjectManager: text(merged.designProjectManager),
    DesignProjectManagerEmail: text(merged.designProjectManagerEmail),
    DesignWeekStart: date(merged.designWeekStart),
    DesignWeekEnd: date(merged.designWeekEnd),
    DesignPwcrExpirationDate: date(merged.designPwcrExpirationDate),
    DesignPwcrExpirationDateEdited: true,
    PaymentDueDate: date(merged.paymentDueDate),
    PaymentDate: date(merged.paymentDate),
    ComplianceNotes: text(merged.complianceNotes),
    ProjectInitiationDate: date(merged.projectInitiationDate),
    ProjectFinishDate: date(merged.projectFinishDate),
    PWC100: merged.pwc100 === true,
    PWC100RegisteredDate: date(merged.pwc100RegisteredDate),
    PWC100ExpirationDate: date(merged.pwc100ExpirationDate),
    FederalProject: merged.federalProject === true,
    FederalProjectNumber: text(merged.federalProjectNumber),
    DavisBaconDetermination: text(merged.davisBaconDetermination),
    FederalSetupInLcp: text(merged.federalSetupInLcp),
    FederalNotes: text(merged.federalNotes),
    FederalActive: text(merged.federalActive),
    PrimeApprover: text(merged.primeApprover),
    DesignProject: merged.designProject === true,
    OnCall: merged.onCall === true,
  };
}

function addInputs(request: sql.Request, values: DbRow): void {
  const dateFields = new Set([
    "IntakeDate",
    "RegistrationCheckedOn",
    "PayrollFormsCheckedOn",
    "PaymentDueDate",
    "PaymentDate",
    "ProjectInitiationDate",
    "ProjectFinishDate",
    "PWC100RegisteredDate",
    "PWC100ExpirationDate",
    "DesignWeekStart",
    "DesignWeekEnd",
    "DesignPwcrExpirationDate",
  ]);
  const integerFields = new Set(["PrimaryContractor", "SourceRecordCount"]);
  const booleanFields = new Set([
    "PWC100",
    "FederalProject",
    "DesignProject",
    "OnCall",
    "DesignPwcrExpirationDateEdited",
    "RegistrationBypass",
    "PayrollFormsBypass",
  ]);
  for (const [key, value] of Object.entries(values)) {
    const type = dateFields.has(key)
      ? sql.Date
      : integerFields.has(key)
        ? sql.Int
        : booleanFields.has(key)
          ? sql.Bit
          : sql.NVarChar(sql.MAX);
    request.input(key, type, value);
  }
}

async function getProjectEditMetadata(
  id: number,
): Promise<{ alternateNames: string; sourceRecordCount: number }> {
  const pool = await getSqlPool();
  const result = await safeQuery(
    pool.request().input("recordId", sql.Int, id),
    `SELECT AlternateNames, SourceRecordCount
     FROM labor_compliance_excel_app.ProjectEdits
     WHERE RecordId=@recordId`,
  );
  const row = result.recordset[0] as DbRow | undefined;
  return {
    alternateNames:
      row?.AlternateNames === null || row?.AlternateNames === undefined
        ? "[]"
        : text(row.AlternateNames),
    sourceRecordCount:
      row?.SourceRecordCount === null || row?.SourceRecordCount === undefined
        ? 1
        : number(row.SourceRecordCount),
  };
}

async function reloadProject(id: number): Promise<Project> {
  const workspace = await getWorkspaceData(true);
  const result = workspace.projects.find((row) => row.id === id);
  if (!result) throw new Error("The project was saved but could not be reloaded.");
  return result;
}

export async function createProject(input: DataInput, actorId: string): Promise<Project> {
  const values = projectWriteValues(input);
  const pool = await getSqlPool();
  await ensureRecordHistoryStorage(pool);
  const projectAppColumnsAvailable = await ensureProjectAppColumns(pool);
  if (!projectAppColumnsAvailable && hasProjectBypassValues(input)) {
    throw new Error("LCP and DIR bypass settings cannot be saved until the SQL schema update succeeds.");
  }
  if (!projectAppColumnsAvailable && hasNonDefaultFormStatuses(input)) {
    throw new Error("Individual Form 1–4 statuses cannot be saved until the SQL schema update succeeds.");
  }
  if (!projectAppColumnsAvailable && hasFederalProjectTextValues(input)) {
    throw new Error("Active Federal fields cannot be saved until the SQL schema update succeeds.");
  }
  if (!projectAppColumnsAvailable && text(input.primeApprover).trim()) {
    throw new Error("Prime Approver cannot be saved until the SQL schema update succeeds.");
  }
  if (!projectAppColumnsAvailable && hasDesignProjectValues(input)) {
    throw new Error("Design project details cannot be saved until the SQL schema update succeeds.");
  }
  const projectAppColumns = projectAppColumnsAvailable
    ? ", Form1Status, Form2Status, Form3Status, Form4Status, FederalProjectNumber, DavisBaconDetermination, FederalSetupInLcp, FederalNotes, FederalActive, PrimeApprover, DesignProjectManager, DesignProjectManagerEmail, DesignWeekStart, DesignWeekEnd, DesignPwcrExpirationDate, DesignPwcrExpirationDateEdited, RegistrationBypass, RegistrationBypassStatus, PayrollFormsBypass, PayrollFormsBypassStatus"
    : "";
  const projectAppValues = projectAppColumnsAvailable
    ? ", @Form1Status, @Form2Status, @Form3Status, @Form4Status, @FederalProjectNumber, @DavisBaconDetermination, @FederalSetupInLcp, @FederalNotes, @FederalActive, @PrimeApprover, @DesignProjectManager, @DesignProjectManagerEmail, @DesignWeekStart, @DesignWeekEnd, @DesignPwcrExpirationDate, @DesignPwcrExpirationDateEdited, @RegistrationBypass, @RegistrationBypassStatus, @PayrollFormsBypass, @PayrollFormsBypassStatus"
    : "";
  const request = pool.request();
  addInputs(request, values);
  request.input("createdAtUtc", sql.DateTime2, new Date());
  request.input("historyActorId", sql.NVarChar(255), actorId.slice(0, 255));
  request.input("historyChangesJson", sql.NVarChar(sql.MAX), JSON.stringify(buildRecordCreatedChange("project")));
  const result = await safeQuery(
    request,
    `SET XACT_ABORT ON;
     BEGIN TRY
       BEGIN TRANSACTION;
       DECLARE @CreatedProjectIds TABLE (Id int NOT NULL);
       DECLARE @ProjectId int;
       INSERT INTO labor_compliance_excel_app.NewProjects (
         CreatedAtUtc, ProjectKey, ProjectNumber, ProjectNumbers, DIRNumber, DIRNumbers,
         ProjectName, AlternateNames, Classification, SourceSheets, SourceRecordCount,
         PrimaryContractor, IntakeDate, RegistrationStatus, RegistrationCheckedOn,
         PayrollFormsStatus, PayrollFormsCheckedOn, FormsStatus${projectAppColumns}, PaymentDueDate, PaymentDate,
         ComplianceNotes, ProjectInitiationDate, ProjectFinishDate, PWC100,
         PWC100RegisteredDate, PWC100ExpirationDate, FederalProject, DesignProject, OnCall
       ) OUTPUT INSERTED.Id INTO @CreatedProjectIds
       VALUES (
         @createdAtUtc, @ProjectKey, @ProjectNumber, @ProjectNumbers, @DIRNumber, @DIRNumbers,
         @ProjectName, @AlternateNames, @Classification, @SourceSheets, @SourceRecordCount,
         @PrimaryContractor, @IntakeDate, @RegistrationStatus, @RegistrationCheckedOn,
         @PayrollFormsStatus, @PayrollFormsCheckedOn, @FormsStatus${projectAppValues}, @PaymentDueDate, @PaymentDate,
         @ComplianceNotes, @ProjectInitiationDate, @ProjectFinishDate, @PWC100,
         @PWC100RegisteredDate, @PWC100ExpirationDate, @FederalProject, @DesignProject, @OnCall
       );
       SELECT TOP (1) @ProjectId = Id FROM @CreatedProjectIds;
       INSERT INTO labor_compliance_excel_app.RecordHistory
         (RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc)
       VALUES
         (N'project', CONVERT(nvarchar(120), @ProjectId + ${newRecordIdOffset}),
           @historyActorId, @historyChangesJson, SYSUTCDATETIME());
       COMMIT TRANSACTION;
       SELECT @ProjectId AS Id;
     END TRY
     BEGIN CATCH
       IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
       THROW;
     END CATCH;`,
  );
  const id = newEntityId(number((result.recordset[0] as DbRow).Id));
  invalidateWorkspaceCache();
  return reloadProject(id);
}

export async function updateProjectRecord(
  id: number,
  input: DataInput,
  actorId: string,
): Promise<Project> {
  const workspace = await getWorkspaceData();
  const current = workspace.projects.find((project) => project.id === id);
  if (!current) throw new Error("Project record not found.");
  const metadata = isNewEntityId(id) ? undefined : await getProjectEditMetadata(id);
  const changes = buildProjectChanges(input, current, workspace.contractors);
  const values = projectWriteValues(input, current, metadata);
  const pool = await getSqlPool();
  await ensureRecordHistoryStorage(pool);
  const projectAppColumnsAvailable = await ensureProjectAppColumns(pool);
  if (!projectAppColumnsAvailable && projectFieldsChanged(input, current, projectBypassFieldKeys)) {
    throw new Error("LCP and DIR bypass settings cannot be saved until the SQL schema update succeeds.");
  }
  if (!projectAppColumnsAvailable && formStatusesChanged(input, current)) {
    throw new Error("Individual Form 1–4 statuses cannot be saved until the SQL schema update succeeds.");
  }
  if (!projectAppColumnsAvailable && projectFieldsChanged(input, current, federalProjectTextKeys)) {
    throw new Error("Active Federal fields cannot be saved until the SQL schema update succeeds.");
  }
  if (
    !projectAppColumnsAvailable &&
    "primeApprover" in input &&
    text(input.primeApprover) !== current.primeApprover
  ) {
    throw new Error("Prime Approver cannot be saved until the SQL schema update succeeds.");
  }
  if (!projectAppColumnsAvailable && projectFieldsChanged(input, current, designProjectFieldKeys)) {
    throw new Error("Design project details cannot be saved until the SQL schema update succeeds.");
  }
  const projectAppAssignments = projectAppColumnsAvailable
    ? ", Form1Status=@Form1Status, Form2Status=@Form2Status, Form3Status=@Form3Status, Form4Status=@Form4Status, FederalProjectNumber=@FederalProjectNumber, DavisBaconDetermination=@DavisBaconDetermination, FederalSetupInLcp=@FederalSetupInLcp, FederalNotes=@FederalNotes, FederalActive=@FederalActive, PrimeApprover=@PrimeApprover, DesignProjectManager=@DesignProjectManager, DesignProjectManagerEmail=@DesignProjectManagerEmail, DesignWeekStart=@DesignWeekStart, DesignWeekEnd=@DesignWeekEnd, DesignPwcrExpirationDate=@DesignPwcrExpirationDate, DesignPwcrExpirationDateEdited=@DesignPwcrExpirationDateEdited, RegistrationBypass=@RegistrationBypass, RegistrationBypassStatus=@RegistrationBypassStatus, PayrollFormsBypass=@PayrollFormsBypass, PayrollFormsBypassStatus=@PayrollFormsBypassStatus"
    : "";
  const projectAppInsertColumns = projectAppColumnsAvailable
    ? ", Form1Status, Form2Status, Form3Status, Form4Status, FederalProjectNumber, DavisBaconDetermination, FederalSetupInLcp, FederalNotes, FederalActive, PrimeApprover, DesignProjectManager, DesignProjectManagerEmail, DesignWeekStart, DesignWeekEnd, DesignPwcrExpirationDate, DesignPwcrExpirationDateEdited, RegistrationBypass, RegistrationBypassStatus, PayrollFormsBypass, PayrollFormsBypassStatus"
    : "";
  const projectAppInsertValues = projectAppColumnsAvailable
    ? ", @Form1Status, @Form2Status, @Form3Status, @Form4Status, @FederalProjectNumber, @DavisBaconDetermination, @FederalSetupInLcp, @FederalNotes, @FederalActive, @PrimeApprover, @DesignProjectManager, @DesignProjectManagerEmail, @DesignWeekStart, @DesignWeekEnd, @DesignPwcrExpirationDate, @DesignPwcrExpirationDateEdited, @RegistrationBypass, @RegistrationBypassStatus, @PayrollFormsBypass, @PayrollFormsBypassStatus"
    : "";
  const request = pool.request();
  addInputs(request, values);
  request.input("recordId", sql.Int, isNewEntityId(id) ? rawNewEntityId(id) : id);
  request.input("updatedAtUtc", sql.DateTime2, new Date());
  request.input("fieldMask", sql.BigInt, fullFieldMask);
  request.input("historyRecordType", sql.NVarChar(40), "project");
  request.input("historyRecordId", sql.NVarChar(120), String(id));
  request.input("historyActorId", sql.NVarChar(255), actorId.slice(0, 255));
  request.input("historyChangesJson", sql.NVarChar(sql.MAX), JSON.stringify(changes));
  if (isNewEntityId(id)) {
    await safeQuery(
      request,
      `SET XACT_ABORT ON;
       BEGIN TRY
         BEGIN TRANSACTION;
         UPDATE labor_compliance_excel_app.NewProjects SET
         ProjectKey=@ProjectKey, ProjectNumber=@ProjectNumber, ProjectNumbers=@ProjectNumbers,
         DIRNumber=@DIRNumber, DIRNumbers=@DIRNumbers, ProjectName=@ProjectName,
         AlternateNames=@AlternateNames, Classification=@Classification, SourceSheets=@SourceSheets,
         SourceRecordCount=@SourceRecordCount, PrimaryContractor=@PrimaryContractor,
         IntakeDate=@IntakeDate, RegistrationStatus=@RegistrationStatus,
         RegistrationCheckedOn=@RegistrationCheckedOn, PayrollFormsStatus=@PayrollFormsStatus,
         PayrollFormsCheckedOn=@PayrollFormsCheckedOn, FormsStatus=@FormsStatus${projectAppAssignments},
         PaymentDueDate=@PaymentDueDate, PaymentDate=@PaymentDate, ComplianceNotes=@ComplianceNotes,
         ProjectInitiationDate=@ProjectInitiationDate, ProjectFinishDate=@ProjectFinishDate,
         PWC100=@PWC100, PWC100RegisteredDate=@PWC100RegisteredDate,
         PWC100ExpirationDate=@PWC100ExpirationDate, FederalProject=@FederalProject,
         DesignProject=@DesignProject, OnCall=@OnCall
         WHERE Id=@recordId;
         IF @historyChangesJson <> N'[]'
           INSERT INTO labor_compliance_excel_app.RecordHistory
             (RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc)
           VALUES
             (@historyRecordType, @historyRecordId, @historyActorId,
               @historyChangesJson, SYSUTCDATETIME());
         COMMIT TRANSACTION;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
         THROW;
       END CATCH;`
    );
  } else {
    await safeQuery(
      request,
      `SET XACT_ABORT ON;
       BEGIN TRY
         BEGIN TRANSACTION;
         UPDATE labor_compliance_excel_app.ProjectEdits SET
         UpdatedAtUtc=@updatedAtUtc, FieldMask=@fieldMask, ProjectKey=@ProjectKey,
         ProjectNumber=@ProjectNumber, ProjectNumbers=@ProjectNumbers, DIRNumber=@DIRNumber,
         DIRNumbers=@DIRNumbers, ProjectName=@ProjectName, AlternateNames=@AlternateNames,
         Classification=@Classification, SourceSheets=@SourceSheets,
         SourceRecordCount=@SourceRecordCount, PrimaryContractor=@PrimaryContractor,
         IntakeDate=@IntakeDate, RegistrationStatus=@RegistrationStatus,
         RegistrationCheckedOn=@RegistrationCheckedOn, PayrollFormsStatus=@PayrollFormsStatus,
         PayrollFormsCheckedOn=@PayrollFormsCheckedOn, FormsStatus=@FormsStatus${projectAppAssignments},
         PaymentDueDate=@PaymentDueDate, PaymentDate=@PaymentDate, ComplianceNotes=@ComplianceNotes,
         ProjectInitiationDate=@ProjectInitiationDate, ProjectFinishDate=@ProjectFinishDate,
         PWC100=@PWC100, PWC100RegisteredDate=@PWC100RegisteredDate,
         PWC100ExpirationDate=@PWC100ExpirationDate, FederalProject=@FederalProject,
         DesignProject=@DesignProject, OnCall=@OnCall
         WHERE RecordId=@recordId;
         IF @@ROWCOUNT=0
           INSERT INTO labor_compliance_excel_app.ProjectEdits (
           RecordId, UpdatedAtUtc, FieldMask, ProjectKey, ProjectNumber, ProjectNumbers,
           DIRNumber, DIRNumbers, ProjectName, AlternateNames, Classification, SourceSheets,
           SourceRecordCount, PrimaryContractor, IntakeDate, RegistrationStatus,
           RegistrationCheckedOn, PayrollFormsStatus, PayrollFormsCheckedOn, FormsStatus,
           ${projectAppInsertColumns.replace(/^, /, "")}${projectAppColumnsAvailable ? "," : ""}
           PaymentDueDate, PaymentDate, ComplianceNotes, ProjectInitiationDate,
           ProjectFinishDate, PWC100, PWC100RegisteredDate, PWC100ExpirationDate,
           FederalProject, DesignProject, OnCall
         ) VALUES (
           @recordId, @updatedAtUtc, @fieldMask, @ProjectKey, @ProjectNumber, @ProjectNumbers,
           @DIRNumber, @DIRNumbers, @ProjectName, @AlternateNames, @Classification, @SourceSheets,
           @SourceRecordCount, @PrimaryContractor, @IntakeDate, @RegistrationStatus,
           @RegistrationCheckedOn, @PayrollFormsStatus, @PayrollFormsCheckedOn, @FormsStatus,
           ${projectAppInsertValues.replace(/^, /, "")}${projectAppColumnsAvailable ? "," : ""}
           @PaymentDueDate, @PaymentDate, @ComplianceNotes, @ProjectInitiationDate,
           @ProjectFinishDate, @PWC100, @PWC100RegisteredDate, @PWC100ExpirationDate,
           @FederalProject, @DesignProject, @OnCall
         );
         IF @historyChangesJson <> N'[]'
           INSERT INTO labor_compliance_excel_app.RecordHistory
             (RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc)
           VALUES
             (@historyRecordType, @historyRecordId, @historyActorId,
               @historyChangesJson, SYSUTCDATETIME());
         COMMIT TRANSACTION;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
         THROW;
       END CATCH;`
    );
  }
  invalidateWorkspaceCache();
  return reloadProject(id);
}

export async function createContractor(input: DataInput, actorId: string): Promise<Contractor> {
  const name = text(input.name).trim();
  if (!name) throw new Error("A contractor name is required.");
  const pool = await getSqlPool();
  const subcontractor = input.subcontractor && typeof input.subcontractor === "object"
    ? input.subcontractor as DbRow
    : null;
  let id: number;
  if (!subcontractor) {
    await ensureRecordHistoryStorage(pool);
    const request = pool
      .request()
      .input("createdAtUtc", sql.DateTime2, new Date())
      .input("name", sql.NVarChar(1000), name)
      .input("aliases", sql.NVarChar(sql.MAX), text(input.aliases))
      .input("normalizedKey", sql.NVarChar(1000), normalizedKey(name))
      .input("sourceCount", sql.Int, 0)
      .input("sourceSheets", sql.NVarChar(sql.MAX), "[]")
      .input("historyActorId", sql.NVarChar(255), actorId.slice(0, 255))
      .input("historyChangesJson", sql.NVarChar(sql.MAX), JSON.stringify(buildRecordCreatedChange("contractor")));
    const result = await safeQuery(
      request,
      `SET XACT_ABORT ON;
       BEGIN TRY
         BEGIN TRANSACTION;
         DECLARE @CreatedContractorIds TABLE (Id int NOT NULL);
         DECLARE @ContractorId int;
         INSERT INTO labor_compliance_excel_app.NewContractors
         (CreatedAtUtc, Name, Aliases, NormalizedKey, SourceCount, SourceSheets)
         OUTPUT INSERTED.Id INTO @CreatedContractorIds
         VALUES (@createdAtUtc, @name, @aliases, @normalizedKey, @sourceCount, @sourceSheets);
         SELECT TOP (1) @ContractorId = Id FROM @CreatedContractorIds;
         INSERT INTO labor_compliance_excel_app.RecordHistory
           (RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc)
         VALUES
           (N'contractor', CONVERT(nvarchar(120), @ContractorId + ${newRecordIdOffset}),
             @historyActorId, @historyChangesJson, SYSUTCDATETIME());
         COMMIT TRANSACTION;
         SELECT @ContractorId AS Id;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
         THROW;
       END CATCH;`
    );
    id = newEntityId(number((result.recordset[0] as DbRow).Id));
  } else {
    const subName = text(subcontractor.name).trim();
    const selectedSubcontractorId = nullableNumber(subcontractor.contractorId);
    const projectId = number(subcontractor.projectId);
    const projectType = text(subcontractor.projectType).trim();
    const validProjectTypes = new Set(["Federal", "Design", "On Call", "PAS CIP+DPW"]);
    if (selectedSubcontractorId === null && !subName) {
      throw new Error("Select an existing subcontractor or enter a new subcontractor name.");
    }
    if (selectedSubcontractorId !== null && (!Number.isSafeInteger(selectedSubcontractorId) || selectedSubcontractorId <= 0)) {
      throw new Error("Select an existing subcontractor.");
    }
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Select an existing project for the subcontractor.");
    }
    if (!validProjectTypes.has(projectType)) {
      throw new Error("Select one project type for the subcontractor.");
    }
    const workspace = await getWorkspaceData(true);
    const project = workspace.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("Select a project that exists in the dashboard.");
    const primaryContractor = workspace.contractors.find(
      (contractor) => contractor.id === project.contractorId,
    );
    if (!primaryContractor) {
      throw new ContractorSubcontractorLinkInputError(
        "Assign a primary contractor to the project before adding its subcontractor.",
      );
    }
    const primaryNameMatches = resolvePrimaryContractorId(
      { contractorId: null, contractorName: name },
      [primaryContractor],
    ) === primaryContractor.id;
    if (!primaryNameMatches) {
      throw new ContractorSubcontractorLinkInputError(
        `This project is assigned to ${primaryContractor.name}. Use that primary contractor name when adding its subcontractor.`,
      );
    }
    if (
      selectedSubcontractorId !== null &&
      !workspace.contractors.some((contractor) => contractor.id === selectedSubcontractorId)
    ) {
      throw new Error("Select a contractor that exists in the dashboard.");
    }
    const availableTypes = projectTypeLabels(project);
    if (availableTypes.length && !availableTypes.includes(projectType)) {
      throw new Error("Choose a project type assigned to the selected project.");
    }

    const tableCheck = await safeQuery(
      pool.request(),
      `SELECT OBJECT_ID(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'U') AS tableId`,
    );
    if (!number((tableCheck.recordset[0] as DbRow | undefined)?.tableId)) {
      throw new ContractorSubcontractorStorageUnavailable();
    }
    if (selectedSubcontractorId === null) {
      await ensureRecordHistoryStorage(pool);
    }

    const createdAtUtc = new Date();
    const result = await safeQuery(
      pool.request()
        .input("primaryContractorId", sql.Int, primaryContractor.id)
        .input("createdAtUtc", sql.DateTime2, createdAtUtc)
        .input("subcontractorName", sql.NVarChar(1000), subName)
        .input("subcontractorNormalizedKey", sql.NVarChar(1000), normalizedKey(subName))
        .input("selectedSubcontractorId", sql.Int, selectedSubcontractorId)
        .input("sourceCount", sql.Int, 0)
        .input("sourceSheets", sql.NVarChar(sql.MAX), "[]")
        .input("projectId", sql.Int, projectId)
        .input("projectType", sql.NVarChar(40), projectType)
        .input("historyActorId", sql.NVarChar(255), actorId.slice(0, 255))
        .input("historyChangesJson", sql.NVarChar(sql.MAX), JSON.stringify(buildRecordCreatedChange("contractor"))),
      `SET XACT_ABORT ON;
       BEGIN TRY
         BEGIN TRANSACTION;
         DECLARE @SubcontractorIds TABLE (Id int NOT NULL);
         DECLARE @SubcontractorId int = @selectedSubcontractorId;

         IF @SubcontractorId IS NULL
         BEGIN
           INSERT INTO labor_compliance_excel_app.NewContractors
             (CreatedAtUtc, Name, Aliases, NormalizedKey, SourceCount, SourceSheets)
           OUTPUT INSERTED.Id INTO @SubcontractorIds
           VALUES (@createdAtUtc, @subcontractorName, N'', @subcontractorNormalizedKey, @sourceCount, @sourceSheets);
           SELECT @SubcontractorId = Id + ${newRecordIdOffset} FROM @SubcontractorIds;
           INSERT INTO labor_compliance_excel_app.RecordHistory
             (RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc)
           VALUES
             (N'contractor', CONVERT(nvarchar(120), @SubcontractorId),
               @historyActorId, @historyChangesJson, SYSUTCDATETIME());
         END;

         IF EXISTS (
           SELECT 1
           FROM labor_compliance_excel_app.ContractorSubcontractorLinks
           WHERE PrimaryContractorId = @primaryContractorId
             AND SubcontractorId = @SubcontractorId
             AND ProjectId = @projectId
         )
         BEGIN
           ROLLBACK TRANSACTION;
           SELECT CAST(1 AS bit) AS conflict, @primaryContractorId AS primaryId;
         END
         ELSE
         BEGIN
           INSERT INTO labor_compliance_excel_app.ContractorSubcontractorLinks
             (PrimaryContractorId, SubcontractorId, ProjectId, ProjectType)
            VALUES (@primaryContractorId, @SubcontractorId, @projectId, @projectType);

           COMMIT TRANSACTION;
           SELECT CAST(0 AS bit) AS conflict, @primaryContractorId AS primaryId;
         END
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
         THROW;
       END CATCH;`,
    );
     if (number((result.recordset[0] as DbRow | undefined)?.conflict) === 1) {
       throw new ContractorSubcontractorLinkConflictError();
     }
    id = number((result.recordset[0] as DbRow).primaryId);
  }
  invalidateWorkspaceCache();
  return (await getWorkspaceData(true)).contractors.find((row) => row.id === id)!;
}

export async function updateContractorSubcontractorLink(
  id: number,
  input: DataInput,
): Promise<ContractorSubcontractor> {
  const projectId = number(input.projectId);
  const projectType = text(input.projectType).trim();
  const validProjectTypes = new Set(["Federal", "Design", "On Call", "PAS CIP+DPW"]);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new ContractorSubcontractorLinkInputError("Select an existing project for the subcontractor.");
  }
  if (!validProjectTypes.has(projectType)) {
    throw new ContractorSubcontractorLinkInputError("Select one project type for the subcontractor.");
  }

  const workspace = await getWorkspaceData(true);
  const project = workspace.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new ContractorSubcontractorLinkInputError("Select a project that exists in the dashboard.");
  }
  const currentPrimaryContractorId =
    project.contractorId !== null &&
    workspace.contractors.some((contractor) => contractor.id === project.contractorId)
      ? project.contractorId
      : null;
  const availableTypes = projectTypeLabels(project);
  if (availableTypes.length && !availableTypes.includes(projectType)) {
    throw new ContractorSubcontractorLinkInputError("Choose a project type assigned to the selected project.");
  }

  const pool = await getSqlPool();
  await ensureContractorSubcontractorLinkStorage(pool);
  const result = await safeQuery(
    pool.request()
      .input("id", sql.Int, id)
      .input("projectId", sql.Int, projectId)
      .input("primaryContractorId", sql.Int, currentPrimaryContractorId)
      .input("projectType", sql.NVarChar(40), projectType),
    `IF EXISTS (
         SELECT 1
         FROM labor_compliance_excel_app.ContractorSubcontractorLinks currentLink
         JOIN labor_compliance_excel_app.ContractorSubcontractorLinks duplicateLink
           ON duplicateLink.PrimaryContractorId = COALESCE(@primaryContractorId, currentLink.PrimaryContractorId)
          AND duplicateLink.SubcontractorId = currentLink.SubcontractorId
          AND duplicateLink.ProjectId = @projectId
          AND duplicateLink.Id <> currentLink.Id
         WHERE currentLink.Id = @id
       )
       BEGIN
         SELECT CAST(1 AS bit) AS conflict;
       END
       ELSE
       BEGIN
         UPDATE labor_compliance_excel_app.ContractorSubcontractorLinks
          SET PrimaryContractorId = COALESCE(@primaryContractorId, PrimaryContractorId),
              ProjectId = @projectId, ProjectType = @projectType
         OUTPUT INSERTED.Id AS id, INSERTED.PrimaryContractorId AS primaryContractorId
         WHERE Id = @id;
       END`,
  );
  if (number((result.recordset[0] as DbRow | undefined)?.conflict) === 1) {
    throw new ContractorSubcontractorLinkConflictError();
  }
  const updated = result.recordset[0] as DbRow | undefined;
  if (!updated) throw new ContractorSubcontractorLinkNotFoundError();

  invalidateWorkspaceCache();
  const refreshed = await getWorkspaceData(true);
  const link = refreshed.contractors
    .flatMap((contractor) => contractor.subcontractors)
    .find((subcontractor) => subcontractor.linkId === number(updated.id));
  if (!link) throw new ContractorSubcontractorLinkNotFoundError();
  return link;
}

export async function updateContractorRecord(
  id: number,
  input: DataInput,
  actorId: string,
): Promise<Contractor> {
  const current = (await getWorkspaceData()).contractors.find((row) => row.id === id);
  if (!current) throw new Error("Contractor record not found.");
  const changes = buildContractorChanges(input, current);
  const name = text(input.name ?? current.name).trim();
  const aliases = text(input.aliases ?? current.aliases);
  const recordId = isNewEntityId(id) ? rawNewEntityId(id) : id;
  const pool = await getSqlPool();
  await ensureRecordHistoryStorage(pool);
  const request = pool
    .request()
    .input("recordId", sql.Int, recordId)
    .input("updatedAtUtc", sql.DateTime2, new Date())
    .input("fieldMask", sql.BigInt, fullFieldMask)
    .input("name", sql.NVarChar(1000), name)
    .input("aliases", sql.NVarChar(sql.MAX), aliases)
    .input("normalizedKey", sql.NVarChar(1000), normalizedKey(name))
    .input("sourceCount", sql.Int, current.sourceCount)
    .input("sourceSheets", sql.NVarChar(sql.MAX), current.sourceSheets ?? "")
    .input("historyRecordType", sql.NVarChar(40), "contractor")
    .input("historyRecordId", sql.NVarChar(120), String(id))
    .input("historyActorId", sql.NVarChar(255), actorId.slice(0, 255))
    .input("historyChangesJson", sql.NVarChar(sql.MAX), JSON.stringify(changes));
  if (isNewEntityId(id)) {
    await safeQuery(
      request,
      `SET XACT_ABORT ON;
       BEGIN TRY
         BEGIN TRANSACTION;
         UPDATE labor_compliance_excel_app.NewContractors
       SET Name=@name, Aliases=@aliases, NormalizedKey=@normalizedKey
         WHERE Id=@recordId;
         IF @historyChangesJson <> N'[]'
           INSERT INTO labor_compliance_excel_app.RecordHistory
             (RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc)
           VALUES
             (@historyRecordType, @historyRecordId, @historyActorId,
               @historyChangesJson, SYSUTCDATETIME());
         COMMIT TRANSACTION;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
         THROW;
       END CATCH;`
    );
  } else {
    await safeQuery(
      request,
      `SET XACT_ABORT ON;
       BEGIN TRY
         BEGIN TRANSACTION;
         UPDATE labor_compliance_excel_app.ContractorEdits
       SET UpdatedAtUtc=@updatedAtUtc, FieldMask=@fieldMask, Name=@name,
           Aliases=@aliases, NormalizedKey=@normalizedKey,
           SourceCount=@sourceCount, SourceSheets=@sourceSheets
         WHERE RecordId=@recordId;
         IF @@ROWCOUNT=0
           INSERT INTO labor_compliance_excel_app.ContractorEdits
           (RecordId, UpdatedAtUtc, FieldMask, Name, Aliases, NormalizedKey, SourceCount, SourceSheets)
         VALUES
           (@recordId, @updatedAtUtc, @fieldMask, @name, @aliases, @normalizedKey, @sourceCount, @sourceSheets);
         IF @historyChangesJson <> N'[]'
           INSERT INTO labor_compliance_excel_app.RecordHistory
             (RecordType, RecordId, ActorId, ChangesJson, OccurredAtUtc)
           VALUES
             (@historyRecordType, @historyRecordId, @historyActorId,
               @historyChangesJson, SYSUTCDATETIME());
         COMMIT TRANSACTION;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
         THROW;
       END CATCH;`
    );
  }
  invalidateWorkspaceCache();
  const saved = (await getWorkspaceData(true)).contractors.find((row) => row.id === id);
  if (!saved) throw new Error("The contractor was saved but could not be reloaded.");
  return saved;
}

function withholdingWriteValues(input: DataInput, current?: Withholding): DbRow {
  const merged = { ...current, ...input } as Record<string, unknown>;
  return {
    Project: nullableNumber(merged.projectId),
    Contractor: nullableNumber(merged.contractorId),
    ProjectNameOriginal: text(merged.projectName),
    ContractorNameOriginal: text(merged.contractorName),
    ProjectNumberOriginal: text(merged.projectNumberOriginal),
    ProjectMatch: text(merged.projectMatch),
    InvoiceReference: text(merged.invoiceReference),
    AmountWithheld: Number(merged.amountWithheld ?? 0),
    NotificationDate: date(merged.notificationDate),
    NotificationDateText: text(merged.notificationDateText),
    Reason: text(merged.reason),
    ReleaseDate: date(merged.releaseDate),
    ReleaseDateText: text(merged.releaseDateText),
    ReleaseReference: text(merged.releaseReference),
    Notes: text(merged.notes),
  };
}

function mapWriteWithholding(id: number, values: DbRow): Withholding {
  return mapSqlWithholding({
    id,
    projectId: values.Project,
    contractorId: values.Contractor,
    projectName: values.ProjectNameOriginal,
    contractorName: values.ContractorNameOriginal,
    projectNumberOriginal: values.ProjectNumberOriginal,
    projectMatch: values.ProjectMatch,
    invoiceReference: values.InvoiceReference,
    amountWithheld: values.AmountWithheld,
    notificationDate: values.NotificationDate,
    notificationDateText: values.NotificationDateText,
    reason: values.Reason,
    releaseDate: values.ReleaseDate,
    releaseDateText: values.ReleaseDateText,
    releaseReference: values.ReleaseReference,
    notes: values.Notes,
  });
}

export async function createWithholding(input: DataInput): Promise<Withholding> {
  const values = withholdingWriteValues(input);
  const pool = await getSqlPool();
  const request = pool.request();
  for (const [key, value] of Object.entries(values)) {
    request.input(
      key,
      key === "AmountWithheld"
        ? sql.Decimal(19, 4)
        : key === "Project" || key === "Contractor"
          ? sql.Int
          : key === "NotificationDate" || key === "ReleaseDate"
            ? sql.Date
            : sql.NVarChar(sql.MAX),
      value,
    );
  }
  request.input("createdAtUtc", sql.DateTime2, new Date());
  const result = await safeQuery(
    request,
    `INSERT INTO labor_compliance_excel_app.NewWithholdings (
       CreatedAtUtc, Project, Contractor, ProjectNameOriginal, ContractorNameOriginal,
       ProjectNumberOriginal, ProjectMatch, InvoiceReference, AmountWithheld, NotificationDate,
       NotificationDateText, Reason, ReleaseDate, ReleaseDateText, ReleaseReference, Notes
     ) OUTPUT INSERTED.Id
     VALUES (
       @createdAtUtc, @Project, @Contractor, @ProjectNameOriginal, @ContractorNameOriginal,
       @ProjectNumberOriginal, @ProjectMatch, @InvoiceReference, @AmountWithheld, @NotificationDate,
       @NotificationDateText, @Reason, @ReleaseDate, @ReleaseDateText, @ReleaseReference, @Notes
     )`
  );
  const id = newEntityId(number((result.recordset[0] as DbRow).Id));
  invalidateWorkspaceCache();
  return mapWriteWithholding(id, values);
}

export async function updateWithholdingRecord(
  id: number,
  input: DataInput,
): Promise<Withholding> {
  const current = (await getWorkspaceData()).withholdings.find((row) => row.id === id);
  if (!current) throw new Error("Withholding record not found.");
  const values = withholdingWriteValues(input, current);
  const pool = await getSqlPool();
  const request = pool.request();
  for (const [key, value] of Object.entries(values)) {
    request.input(
      key,
      key === "AmountWithheld"
        ? sql.Decimal(19, 4)
        : key === "Project" || key === "Contractor"
          ? sql.Int
          : key === "NotificationDate" || key === "ReleaseDate"
            ? sql.Date
            : sql.NVarChar(sql.MAX),
      value,
    );
  }
  request
    .input("recordId", sql.Int, isNewEntityId(id) ? rawNewEntityId(id) : id)
    .input("updatedAtUtc", sql.DateTime2, new Date())
    .input("fieldMask", sql.BigInt, fullFieldMask);
  if (isNewEntityId(id)) {
    await safeQuery(
      request,
      `UPDATE labor_compliance_excel_app.NewWithholdings SET
         Project=@Project, Contractor=@Contractor, ProjectNameOriginal=@ProjectNameOriginal,
         ContractorNameOriginal=@ContractorNameOriginal, ProjectNumberOriginal=@ProjectNumberOriginal,
         ProjectMatch=@ProjectMatch, InvoiceReference=@InvoiceReference, AmountWithheld=@AmountWithheld,
         NotificationDate=@NotificationDate, NotificationDateText=@NotificationDateText,
         Reason=@Reason, ReleaseDate=@ReleaseDate, ReleaseDateText=@ReleaseDateText,
         ReleaseReference=@ReleaseReference, Notes=@Notes
       WHERE Id=@recordId`
    );
  } else {
    await safeQuery(
      request,
      `UPDATE labor_compliance_excel_app.WithholdingEdits SET
         UpdatedAtUtc=@updatedAtUtc, FieldMask=@fieldMask, Project=@Project,
         Contractor=@Contractor, ProjectNameOriginal=@ProjectNameOriginal,
         ContractorNameOriginal=@ContractorNameOriginal, ProjectNumberOriginal=@ProjectNumberOriginal,
         ProjectMatch=@ProjectMatch, InvoiceReference=@InvoiceReference, AmountWithheld=@AmountWithheld,
         NotificationDate=@NotificationDate, NotificationDateText=@NotificationDateText,
         Reason=@Reason, ReleaseDate=@ReleaseDate, ReleaseDateText=@ReleaseDateText,
         ReleaseReference=@ReleaseReference, Notes=@Notes
       WHERE RecordId=@recordId;
       IF @@ROWCOUNT=0
         INSERT INTO labor_compliance_excel_app.WithholdingEdits (
           RecordId, UpdatedAtUtc, FieldMask, Project, Contractor, ProjectNameOriginal,
           ContractorNameOriginal, ProjectNumberOriginal, ProjectMatch, InvoiceReference,
           AmountWithheld, NotificationDate, NotificationDateText, Reason, ReleaseDate,
           ReleaseDateText, ReleaseReference, Notes
         ) VALUES (
           @recordId, @updatedAtUtc, @fieldMask, @Project, @Contractor, @ProjectNameOriginal,
           @ContractorNameOriginal, @ProjectNumberOriginal, @ProjectMatch, @InvoiceReference,
           @AmountWithheld, @NotificationDate, @NotificationDateText, @Reason, @ReleaseDate,
           @ReleaseDateText, @ReleaseReference, @Notes
         )`
    );
  }
  invalidateWorkspaceCache();
  const saved = (await getWorkspaceData(true)).withholdings.find((row) => row.id === id);
  if (!saved) throw new Error("The withholding was saved but could not be reloaded.");
  return saved;
}
