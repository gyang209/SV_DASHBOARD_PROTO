import { getWorkspaceData } from "./sqlCompliance";
import { getSqlPool, safeQuery, sql } from "./sqlServer";
import { ensureTrashStorageForReads } from "./trash";

type RestitutionStatus =
  | "Open"
  | "Notice sent"
  | "In progress"
  | "Paid"
  | "Disputed"
  | "Closed";
type RestitutionFlag = "Not checked" | "Yes" | "No";

export type RestitutionRecord = {
  id: number;
  projectId: number | null;
  projectName: string;
  contractorId: number | null;
  contractorName: string;
  status: RestitutionStatus;
  firstEmailSentDate: string | null;
  apprenticeName: string;
  apprenticeCraft: string;
  cprWeekEndingDate: string | null;
  unsupervisedHoursDates: string;
  numberOfUnsupervisedHours: number | null;
  amountOwed: number;
  paidForRestitution: RestitutionFlag;
  checkCopyProvided: boolean;
  proofOfDepositProvided: boolean;
  wageDifferenceCalculationsProvided: boolean;
  uploadedDocsInLcptracker: RestitutionFlag;
  confidentialNotesAddedToCpr: RestitutionFlag;
  cprReviewAccepted: RestitutionFlag;
  comments: string;
};

export type RestitutionWriteInput = {
  projectId?: number | null;
  contractorId?: number | null;
  status?: RestitutionStatus;
  firstEmailSentDate?: Date | null;
  apprenticeName?: string;
  apprenticeCraft?: string;
  cprWeekEndingDate?: Date | null;
  unsupervisedHoursDates?: string;
  numberOfUnsupervisedHours?: number | null;
  amountOwed?: number;
  paidForRestitution?: RestitutionFlag;
  checkCopyProvided?: boolean;
  proofOfDepositProvided?: boolean;
  wageDifferenceCalculationsProvided?: boolean;
  uploadedDocsInLcptracker?: RestitutionFlag;
  confidentialNotesAddedToCpr?: RestitutionFlag;
  cprReviewAccepted?: RestitutionFlag;
  comments?: string;
};

type DbRow = Record<string, unknown>;
type ResolvedLinks = {
  projectId: number | null;
  projectName: string;
  contractorId: number | null;
  contractorName: string;
};

export class RestitutionStorageUnavailableError extends Error {
  constructor(message = "Restitution storage is not ready. Run artifacts/api-server/migrations/add-restitutions.sql in MIS119ATEMP and confirm the application SQL user can SELECT, INSERT, and UPDATE this table.") {
    super(message);
    this.name = "RestitutionStorageUnavailableError";
  }
}

export class RestitutionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestitutionInputError";
  }
}

export class RestitutionNotFoundError extends Error {
  constructor() {
    super("The restitution record was not found.");
    this.name = "RestitutionNotFoundError";
  }
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
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

function dateString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.exec(String(value))?.[0] ?? null;
}

function dateValue(value: Date | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  return value;
}

function flag(value: unknown): RestitutionFlag {
  const normalized = text(value).trim().toLowerCase();
  if (normalized === "yes" || normalized === "1" || normalized === "true") return "Yes";
  if (normalized === "no" || normalized === "0" || normalized === "false") return "No";
  return "Not checked";
}

function bit(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function mapSqlRestitution(row: DbRow): RestitutionRecord {
  const allowedStatuses: RestitutionStatus[] = [
    "Open",
    "Notice sent",
    "In progress",
    "Paid",
    "Disputed",
    "Closed",
  ];
  const rawStatus = text(row.Status ?? row.status);
  return {
    id: number(row.Id ?? row.id),
    projectId: nullableNumber(row.ProjectId ?? row.projectId),
    projectName: text(row.ProjectName ?? row.projectName),
    contractorId: nullableNumber(row.ContractorId ?? row.contractorId),
    contractorName: text(row.ContractorName ?? row.contractorName),
    status: allowedStatuses.includes(rawStatus as RestitutionStatus)
      ? (rawStatus as RestitutionStatus)
      : "Open",
    firstEmailSentDate: dateString(row.FirstEmailSentDate ?? row.firstEmailSentDate),
    apprenticeName: text(row.ApprenticeName ?? row.apprenticeName),
    apprenticeCraft: text(row.ApprenticeCraft ?? row.apprenticeCraft),
    cprWeekEndingDate: dateString(row.CprWeekEndingDate ?? row.cprWeekEndingDate),
    unsupervisedHoursDates: text(row.UnsupervisedHoursDates ?? row.unsupervisedHoursDates),
    numberOfUnsupervisedHours: nullableNumber(
      row.NumberOfUnsupervisedHours ?? row.numberOfUnsupervisedHours,
    ),
    amountOwed: number(row.AmountOwed ?? row.amountOwed),
    paidForRestitution: flag(row.PaidForRestitution ?? row.paidForRestitution),
    checkCopyProvided: bit(row.CheckCopyProvided ?? row.checkCopyProvided),
    proofOfDepositProvided: bit(row.ProofOfDepositProvided ?? row.proofOfDepositProvided),
    wageDifferenceCalculationsProvided: bit(
      row.WageDifferenceCalculationsProvided ?? row.wageDifferenceCalculationsProvided,
    ),
    uploadedDocsInLcptracker: flag(row.UploadedDocsInLcptracker ?? row.uploadedDocsInLcptracker),
    confidentialNotesAddedToCpr: flag(
      row.ConfidentialNotesAddedToCpr ?? row.confidentialNotesAddedToCpr,
    ),
    cprReviewAccepted: flag(row.CprReviewAccepted ?? row.cprReviewAccepted),
    comments: text(row.Comments ?? row.comments),
  };
}

export function restitutionWriteValues(
  input: RestitutionWriteInput,
  links: ResolvedLinks,
): Record<string, unknown> {
  return {
    ...links,
    status: input.status ?? "Open",
    firstEmailSentDate: dateValue(input.firstEmailSentDate),
    apprenticeName: input.apprenticeName ?? "",
    apprenticeCraft: input.apprenticeCraft ?? "",
    cprWeekEndingDate: dateValue(input.cprWeekEndingDate),
    unsupervisedHoursDates: input.unsupervisedHoursDates ?? "",
    numberOfUnsupervisedHours: input.numberOfUnsupervisedHours ?? null,
    amountOwed: input.amountOwed ?? 0,
    paidForRestitution: input.paidForRestitution ?? "Not checked",
    checkCopyProvided: input.checkCopyProvided ?? false,
    proofOfDepositProvided: input.proofOfDepositProvided ?? false,
    wageDifferenceCalculationsProvided: input.wageDifferenceCalculationsProvided ?? false,
    uploadedDocsInLcptracker: input.uploadedDocsInLcptracker ?? "Not checked",
    confidentialNotesAddedToCpr: input.confidentialNotesAddedToCpr ?? "Not checked",
    cprReviewAccepted: input.cprReviewAccepted ?? "Not checked",
    comments: input.comments ?? "",
  };
}

async function ensureStorage(
  pool: Awaited<ReturnType<typeof getSqlPool>>,
  requiredPermissions: Array<"SELECT" | "INSERT" | "UPDATE">,
): Promise<void> {
  const result = await safeQuery(
    pool.request(),
    `SELECT
       OBJECT_ID(N'labor_compliance_excel_app.NewRestitutions', N'U') AS tableId,
       CASE WHEN COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'ApprenticeName') IS NULL
         THEN 0 ELSE 1 END AS sheetFieldsReady,
       HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.NewRestitutions', N'OBJECT', N'SELECT') AS canSelect,
       HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.NewRestitutions', N'OBJECT', N'INSERT') AS canInsert,
       HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.NewRestitutions', N'OBJECT', N'UPDATE') AS canUpdate;`,
  );
  const row = result.recordset[0] as DbRow | undefined;
  const permissionKey = {
    SELECT: "canSelect",
    INSERT: "canInsert",
    UPDATE: "canUpdate",
  } as const;
  if (
    !row?.tableId ||
    Number(row.sheetFieldsReady) !== 1 ||
    requiredPermissions.some((permission) => Number(row[permissionKey[permission]]) !== 1)
  ) {
    throw new RestitutionStorageUnavailableError();
  }
}

async function resolveLinks(
  input: RestitutionWriteInput,
  current?: RestitutionRecord,
): Promise<ResolvedLinks> {
  const projectId = input.projectId === undefined ? current?.projectId ?? null : input.projectId;
  const contractorId =
    input.contractorId === undefined ? current?.contractorId ?? null : input.contractorId;
  const projectChanged = current === undefined || input.projectId !== undefined;
  const contractorChanged = current === undefined || input.contractorId !== undefined;
  if (!projectChanged && !contractorChanged) {
    return {
      projectId,
      projectName: current?.projectName ?? "",
      contractorId,
      contractorName: current?.contractorName ?? "",
    };
  }

  const workspace = await getWorkspaceData();
  let projectName = current?.projectName ?? "";
  if (projectChanged) {
    if (projectId === null) {
      projectName = "";
    } else {
      const project = workspace.projects.find((candidate) => candidate.id === projectId);
      if (!project) {
        throw new RestitutionInputError("Select a project that exists in the dashboard.");
      }
      projectName = project.projectName;
    }
  }

  let contractorName = current?.contractorName ?? "";
  if (contractorChanged) {
    if (contractorId === null) {
      contractorName = "";
    } else {
      const contractor = workspace.contractors.find((candidate) => candidate.id === contractorId);
      if (!contractor) {
        throw new RestitutionInputError("Select a contractor that exists in the dashboard.");
      }
      contractorName = contractor.name;
    }
  }

  return { projectId, projectName, contractorId, contractorName };
}

function bindWriteValues(
  request: ReturnType<Awaited<ReturnType<typeof getSqlPool>>["request"]>,
  values: Record<string, unknown>,
) {
  return request
    .input("projectId", sql.Int, values.projectId as number | null)
    .input("projectName", sql.NVarChar(255), values.projectName as string)
    .input("contractorId", sql.Int, values.contractorId as number | null)
    .input("contractorName", sql.NVarChar(255), values.contractorName as string)
    .input("status", sql.NVarChar(40), values.status as string)
    .input("firstEmailSentDate", sql.Date, values.firstEmailSentDate as Date | null)
    .input("apprenticeName", sql.NVarChar(255), values.apprenticeName as string)
    .input("apprenticeCraft", sql.NVarChar(255), values.apprenticeCraft as string)
    .input("cprWeekEndingDate", sql.Date, values.cprWeekEndingDate as Date | null)
    .input("unsupervisedHoursDates", sql.NVarChar(sql.MAX), values.unsupervisedHoursDates as string)
    .input("numberOfUnsupervisedHours", sql.Decimal(19, 4), values.numberOfUnsupervisedHours as number | null)
    .input("amountOwed", sql.Decimal(19, 4), values.amountOwed as number)
    .input("paidForRestitution", sql.NVarChar(20), values.paidForRestitution as string)
    .input("checkCopyProvided", sql.Bit, values.checkCopyProvided as boolean)
    .input("proofOfDepositProvided", sql.Bit, values.proofOfDepositProvided as boolean)
    .input("wageDifferenceCalculationsProvided", sql.Bit, values.wageDifferenceCalculationsProvided as boolean)
    .input("uploadedDocsInLcptracker", sql.NVarChar(20), values.uploadedDocsInLcptracker as string)
    .input("confidentialNotesAddedToCpr", sql.NVarChar(20), values.confidentialNotesAddedToCpr as string)
    .input("cprReviewAccepted", sql.NVarChar(20), values.cprReviewAccepted as string)
    .input("comments", sql.NVarChar(sql.MAX), values.comments as string);
}

export async function getRestitutions(): Promise<RestitutionRecord[]> {
  const pool = await getSqlPool();
  await ensureTrashStorageForReads();
  await ensureStorage(pool, ["SELECT"]);
  const result = await safeQuery(
    pool.request(),
    `SELECT Id, ProjectId, ProjectName, ContractorId, ContractorName, Status,
       FirstEmailSentDate, ApprenticeName, ApprenticeCraft, CprWeekEndingDate,
       UnsupervisedHoursDates, NumberOfUnsupervisedHours, AmountOwed,
       PaidForRestitution, CheckCopyProvided, ProofOfDepositProvided,
       WageDifferenceCalculationsProvided, UploadedDocsInLcptracker,
       ConfidentialNotesAddedToCpr, CprReviewAccepted, Comments
      FROM labor_compliance_excel_app.NewRestitutions restitution
      WHERE NOT EXISTS (
        SELECT 1 FROM labor_compliance_excel_app.Trash trash
        WHERE trash.RecordType = N'restitution'
          AND trash.RecordId = CONVERT(nvarchar(120), restitution.Id)
      )
     ORDER BY CASE WHEN FirstEmailSentDate IS NULL THEN 1 ELSE 0 END,
       FirstEmailSentDate DESC, Id DESC;`,
  );
  return result.recordset.map((row) => mapSqlRestitution(row as DbRow));
}

export async function createRestitution(
  input: RestitutionWriteInput,
): Promise<RestitutionRecord> {
  const pool = await getSqlPool();
  await ensureStorage(pool, ["SELECT", "INSERT"]);
  const links = await resolveLinks(input);
  const values = restitutionWriteValues(input, links);
  const result = await safeQuery(
    bindWriteValues(pool.request(), values),
    `INSERT INTO labor_compliance_excel_app.NewRestitutions
       (ProjectId, ProjectName, ContractorId, ContractorName, Status, FirstEmailSentDate,
        ApprenticeName, ApprenticeCraft, CprWeekEndingDate, UnsupervisedHoursDates,
        NumberOfUnsupervisedHours, AmountOwed, PaidForRestitution, CheckCopyProvided,
        ProofOfDepositProvided, WageDifferenceCalculationsProvided, UploadedDocsInLcptracker,
        ConfidentialNotesAddedToCpr, CprReviewAccepted, Comments, CreatedAtUtc, UpdatedAtUtc)
     OUTPUT INSERTED.Id AS Id
     VALUES
       (@projectId, @projectName, @contractorId, @contractorName, @status, @firstEmailSentDate,
        @apprenticeName, @apprenticeCraft, @cprWeekEndingDate, @unsupervisedHoursDates,
        @numberOfUnsupervisedHours, @amountOwed, @paidForRestitution, @checkCopyProvided,
        @proofOfDepositProvided, @wageDifferenceCalculationsProvided, @uploadedDocsInLcptracker,
        @confidentialNotesAddedToCpr, @cprReviewAccepted, @comments,
        SYSUTCDATETIME(), SYSUTCDATETIME());`,
  );
  const id = number((result.recordset[0] as DbRow | undefined)?.Id);
  if (!id) throw new Error("The restitution record was not created.");
  return mapSqlRestitution({
    id,
    projectId: values.projectId,
    projectName: values.projectName,
    contractorId: values.contractorId,
    contractorName: values.contractorName,
    status: values.status,
    firstEmailSentDate: values.firstEmailSentDate,
    apprenticeName: values.apprenticeName,
    apprenticeCraft: values.apprenticeCraft,
    cprWeekEndingDate: values.cprWeekEndingDate,
    unsupervisedHoursDates: values.unsupervisedHoursDates,
    numberOfUnsupervisedHours: values.numberOfUnsupervisedHours,
    amountOwed: values.amountOwed,
    paidForRestitution: values.paidForRestitution,
    checkCopyProvided: values.checkCopyProvided,
    proofOfDepositProvided: values.proofOfDepositProvided,
    wageDifferenceCalculationsProvided: values.wageDifferenceCalculationsProvided,
    uploadedDocsInLcptracker: values.uploadedDocsInLcptracker,
    confidentialNotesAddedToCpr: values.confidentialNotesAddedToCpr,
    cprReviewAccepted: values.cprReviewAccepted,
    comments: values.comments,
  });
}

export async function updateRestitution(
  id: number,
  input: RestitutionWriteInput,
): Promise<RestitutionRecord> {
  const pool = await getSqlPool();
  await ensureStorage(pool, ["SELECT", "UPDATE"]);
  const records = await getRestitutions();
  const current = records.find((record) => record.id === id);
  if (!current) throw new RestitutionNotFoundError();
  const links = await resolveLinks(input, current);
  const values = restitutionWriteValues(
    {
      projectId: links.projectId,
      contractorId: links.contractorId,
      status: input.status ?? current.status,
      firstEmailSentDate: input.firstEmailSentDate === undefined
        ? current.firstEmailSentDate
          ? new Date(`${current.firstEmailSentDate}T00:00:00Z`)
          : null
        : input.firstEmailSentDate,
      apprenticeName: input.apprenticeName ?? current.apprenticeName,
      apprenticeCraft: input.apprenticeCraft ?? current.apprenticeCraft,
      cprWeekEndingDate: input.cprWeekEndingDate === undefined
        ? current.cprWeekEndingDate
          ? new Date(`${current.cprWeekEndingDate}T00:00:00Z`)
          : null
        : input.cprWeekEndingDate,
      unsupervisedHoursDates: input.unsupervisedHoursDates ?? current.unsupervisedHoursDates,
      numberOfUnsupervisedHours: input.numberOfUnsupervisedHours === undefined
        ? current.numberOfUnsupervisedHours
        : input.numberOfUnsupervisedHours,
      amountOwed: input.amountOwed ?? current.amountOwed,
      paidForRestitution: input.paidForRestitution ?? current.paidForRestitution,
      checkCopyProvided: input.checkCopyProvided ?? current.checkCopyProvided,
      proofOfDepositProvided: input.proofOfDepositProvided ?? current.proofOfDepositProvided,
      wageDifferenceCalculationsProvided:
        input.wageDifferenceCalculationsProvided ?? current.wageDifferenceCalculationsProvided,
      uploadedDocsInLcptracker: input.uploadedDocsInLcptracker ?? current.uploadedDocsInLcptracker,
      confidentialNotesAddedToCpr:
        input.confidentialNotesAddedToCpr ?? current.confidentialNotesAddedToCpr,
      cprReviewAccepted: input.cprReviewAccepted ?? current.cprReviewAccepted,
      comments: input.comments ?? current.comments,
    },
    links,
  );
  const result = await safeQuery(
    bindWriteValues(pool.request().input("id", sql.Int, id), values),
    `UPDATE labor_compliance_excel_app.NewRestitutions
     SET ProjectId = @projectId,
         ProjectName = @projectName,
         ContractorId = @contractorId,
         ContractorName = @contractorName,
          Status = @status,
          FirstEmailSentDate = @firstEmailSentDate,
          ApprenticeName = @apprenticeName,
          ApprenticeCraft = @apprenticeCraft,
          CprWeekEndingDate = @cprWeekEndingDate,
          UnsupervisedHoursDates = @unsupervisedHoursDates,
          NumberOfUnsupervisedHours = @numberOfUnsupervisedHours,
         AmountOwed = @amountOwed,
          PaidForRestitution = @paidForRestitution,
          CheckCopyProvided = @checkCopyProvided,
          ProofOfDepositProvided = @proofOfDepositProvided,
          WageDifferenceCalculationsProvided = @wageDifferenceCalculationsProvided,
          UploadedDocsInLcptracker = @uploadedDocsInLcptracker,
          ConfidentialNotesAddedToCpr = @confidentialNotesAddedToCpr,
          CprReviewAccepted = @cprReviewAccepted,
          Comments = @comments,
         UpdatedAtUtc = SYSUTCDATETIME()
     OUTPUT INSERTED.Id AS Id
     WHERE Id = @id;`,
  );
  if (!result.recordset.length) throw new RestitutionNotFoundError();
  return mapSqlRestitution({
    Id: id,
    ProjectId: values.projectId,
    ProjectName: values.projectName,
    ContractorId: values.contractorId,
    ContractorName: values.contractorName,
    Status: values.status,
    FirstEmailSentDate: values.firstEmailSentDate,
    ApprenticeName: values.apprenticeName,
    ApprenticeCraft: values.apprenticeCraft,
    CprWeekEndingDate: values.cprWeekEndingDate,
    UnsupervisedHoursDates: values.unsupervisedHoursDates,
    NumberOfUnsupervisedHours: values.numberOfUnsupervisedHours,
    AmountOwed: values.amountOwed,
    PaidForRestitution: values.paidForRestitution,
    CheckCopyProvided: values.checkCopyProvided,
    ProofOfDepositProvided: values.proofOfDepositProvided,
    WageDifferenceCalculationsProvided: values.wageDifferenceCalculationsProvided,
    UploadedDocsInLcptracker: values.uploadedDocsInLcptracker,
    ConfidentialNotesAddedToCpr: values.confidentialNotesAddedToCpr,
    CprReviewAccepted: values.cprReviewAccepted,
    Comments: values.comments,
  });
}
