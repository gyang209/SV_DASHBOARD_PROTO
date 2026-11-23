import type {
  TrashAffectedRecord,
  TrashAuditEvent,
  TrashRecord,
  TrashRecordType,
} from "@workspace/api-zod";
import { getSqlPool, safeQuery, sql } from "./sqlServer";

type DbRow = Record<string, unknown>;

let ensureStoragePromise: Promise<void> | null = null;

async function ensureStorage(): Promise<void> {
  if (!ensureStoragePromise) {
    ensureStoragePromise = (async () => {
      const pool = await getSqlPool();
      await safeQuery(
        pool.request(),
        `IF OBJECT_ID(N'labor_compliance_excel_app.Trash', N'U') IS NULL
         BEGIN
           CREATE TABLE labor_compliance_excel_app.Trash
           (
             Id int IDENTITY(1,1) NOT NULL
               CONSTRAINT PK_LaborComplianceTrash PRIMARY KEY,
             RecordType nvarchar(40) NOT NULL,
             RecordId nvarchar(120) NOT NULL,
             Title nvarchar(1000) NOT NULL,
             PayloadJson nvarchar(max) NULL,
              AffectedRecordsJson nvarchar(max) NULL,
             DeletedAtUtc datetime2(7) NOT NULL
               CONSTRAINT DF_LaborComplianceTrash_DeletedAtUtc DEFAULT (SYSUTCDATETIME()),
             ExpiresAtUtc datetime2(7) NOT NULL,
             CONSTRAINT UQ_LaborComplianceTrash_Record UNIQUE (RecordType, RecordId)
           );
           CREATE INDEX IX_LaborComplianceTrash_Expiry
             ON labor_compliance_excel_app.Trash (ExpiresAtUtc);
          END;
           IF COL_LENGTH(N'labor_compliance_excel_app.Trash', N'AffectedRecordsJson') IS NULL
             ALTER TABLE labor_compliance_excel_app.Trash
               ADD AffectedRecordsJson nvarchar(max) NULL;
          IF OBJECT_ID(N'labor_compliance_excel_app.TrashAudit', N'U') IS NULL
          BEGIN
            CREATE TABLE labor_compliance_excel_app.TrashAudit
            (
              Id bigint IDENTITY(1,1) NOT NULL
                CONSTRAINT PK_LaborComplianceTrashAudit PRIMARY KEY,
              RecordType nvarchar(40) NOT NULL,
              RecordId nvarchar(120) NOT NULL,
              Title nvarchar(1000) NOT NULL,
              ActionType nvarchar(20) NOT NULL,
              ActorId nvarchar(255) NOT NULL,
              OccurredAtUtc datetime2(7) NOT NULL,
              CONSTRAINT CK_LaborComplianceTrashAudit_Action
                CHECK (ActionType IN (N'deleted', N'restored'))
            );
            CREATE INDEX IX_LaborComplianceTrashAudit_Record
              ON labor_compliance_excel_app.TrashAudit
                (RecordType, RecordId, OccurredAtUtc DESC);
          END;`,
      );
    })().catch((error) => {
      ensureStoragePromise = null;
      throw error;
    });
  }
  await ensureStoragePromise;
}

function mapTrashRow(row: DbRow): TrashRecord {
  const rawAffectedRecords = row.affectedRecordsJson;
  let affectedRecords: TrashAffectedRecord[] = [];
  if (rawAffectedRecords !== null && rawAffectedRecords !== undefined) {
    const parsed: unknown = JSON.parse(String(rawAffectedRecords));
    if (!Array.isArray(parsed) || parsed.some((record) =>
      !record || typeof record !== "object"
      || typeof (record as Record<string, unknown>).recordType !== "string"
      || typeof (record as Record<string, unknown>).recordId !== "string"
      || typeof (record as Record<string, unknown>).title !== "string"
      || typeof (record as Record<string, unknown>).impact !== "string"
    )) {
      throw new Error("Trash affected-record history is invalid.");
    }
    affectedRecords = parsed as TrashAffectedRecord[];
  }
  return {
    id: Number(row.id),
    recordType: String(row.recordType) as TrashRecordType,
    recordId: String(row.recordId),
    title: String(row.title),
    payloadJson: row.payloadJson === null ? null : String(row.payloadJson),
    deletedAt: new Date(row.deletedAt as string | Date),
    expiresAt: new Date(row.expiresAt as string | Date),
    deletedBy: row.deletedBy === null || row.deletedBy === undefined
      ? null
      : String(row.deletedBy),
    affectedRecords,
  };
}

function mapAuditRow(row: DbRow): TrashAuditEvent {
  return {
    id: Number(row.id),
    recordType: String(row.recordType) as TrashRecordType,
    recordId: String(row.recordId),
    title: String(row.title),
    action: String(row.action) as TrashAuditEvent["action"],
    actorId: String(row.actorId),
    occurredAt: new Date(row.occurredAt as string | Date),
  };
}

export async function addTrashRecord(input: {
  recordType: TrashRecordType;
  recordId: number;
  title: string;
  payloadJson?: string | null;
  actorId: string;
  affectedRecords?: TrashAffectedRecord[];
}): Promise<TrashRecord> {
  await ensureStorage();
  const pool = await getSqlPool();
  const result = await safeQuery(
    pool
      .request()
      .input("recordType", sql.NVarChar(40), input.recordType)
      .input("recordId", sql.NVarChar(120), String(input.recordId))
      .input("title", sql.NVarChar(1000), input.title.slice(0, 1000))
      .input("payloadJson", sql.NVarChar(sql.MAX), input.payloadJson ?? null)
      .input("actorId", sql.NVarChar(255), input.actorId.slice(0, 255))
      .input("affectedRecordsJson", sql.NVarChar(sql.MAX), JSON.stringify(input.affectedRecords ?? []))
      .input("retentionDays", sql.Int, 30),
    `SET XACT_ABORT ON;
     DECLARE @now datetime2(7) = SYSUTCDATETIME();
     BEGIN TRANSACTION;
     INSERT INTO labor_compliance_excel_app.Trash
        (RecordType, RecordId, Title, PayloadJson, AffectedRecordsJson, DeletedAtUtc, ExpiresAtUtc)
     OUTPUT INSERTED.Id AS id, INSERTED.RecordType AS recordType,
       INSERTED.RecordId AS recordId, INSERTED.Title AS title,
       INSERTED.PayloadJson AS payloadJson, INSERTED.DeletedAtUtc AS deletedAt,
        INSERTED.AffectedRecordsJson AS affectedRecordsJson,
        INSERTED.ExpiresAtUtc AS expiresAt, @actorId AS deletedBy
       VALUES (@recordType, @recordId, @title, @payloadJson, @affectedRecordsJson, @now,
        DATEADD(day, @retentionDays, @now));
      INSERT INTO labor_compliance_excel_app.TrashAudit
        (RecordType, RecordId, Title, ActionType, ActorId, OccurredAtUtc)
      VALUES (@recordType, @recordId, @title, N'deleted', @actorId, @now);
      COMMIT TRANSACTION;`,
  );
  const row = result.recordset[0] as DbRow | undefined;
  if (!row) throw new Error("The record could not be moved to Trash.");
  return mapTrashRow(row);
}

export async function getTrashRecords(): Promise<TrashRecord[]> {
  await ensureStorage();
  const pool = await getSqlPool();
  await safeQuery(
    pool.request(),
    `UPDATE labor_compliance_excel_app.Trash
        SET PayloadJson = NULL, AffectedRecordsJson = NULL
      WHERE ExpiresAtUtc <= SYSUTCDATETIME()
        AND (PayloadJson IS NOT NULL OR AffectedRecordsJson IS NOT NULL);`,
  );
  const result = await safeQuery(
    pool.request(),
    `SELECT Id AS id, RecordType AS recordType, RecordId AS recordId,
        Title AS title, PayloadJson AS payloadJson,
        AffectedRecordsJson AS affectedRecordsJson, DeletedAtUtc AS deletedAt,
        ExpiresAtUtc AS expiresAt, deletion.ActorId AS deletedBy
      FROM labor_compliance_excel_app.Trash trash
      OUTER APPLY
      (
        SELECT TOP (1) ActorId
        FROM labor_compliance_excel_app.TrashAudit audit
        WHERE audit.RecordType = trash.RecordType
          AND audit.RecordId = trash.RecordId
          AND audit.ActionType = N'deleted'
        ORDER BY audit.OccurredAtUtc DESC, audit.Id DESC
      ) deletion
      WHERE trash.ExpiresAtUtc > SYSUTCDATETIME()
      ORDER BY trash.DeletedAtUtc DESC, trash.Id DESC;`,
  );
  return (result.recordset as DbRow[]).map(mapTrashRow);
}

export async function getTrashAuditEvents(): Promise<TrashAuditEvent[]> {
  await ensureStorage();
  const pool = await getSqlPool();
  const result = await safeQuery(
    pool.request(),
    `SELECT TOP (500)
        Id AS id, RecordType AS recordType, RecordId AS recordId,
        Title AS title, ActionType AS action, ActorId AS actorId,
        OccurredAtUtc AS occurredAt
      FROM labor_compliance_excel_app.TrashAudit
      ORDER BY OccurredAtUtc DESC, Id DESC;`,
  );
  return (result.recordset as DbRow[]).map(mapAuditRow);
}

export async function restoreTrashRecord(id: number, actorId: string): Promise<void> {
  await ensureStorage();
  const pool = await getSqlPool();
  const result = await safeQuery(
    pool.request()
      .input("id", sql.Int, id)
      .input("actorId", sql.NVarChar(255), actorId.slice(0, 255)),
    `SET XACT_ABORT ON;
     DECLARE @now datetime2(7) = SYSUTCDATETIME();
     DECLARE @restoredRecord TABLE
     (
       RecordType nvarchar(40) NOT NULL,
       RecordId nvarchar(120) NOT NULL,
       Title nvarchar(1000) NOT NULL
     );
     DECLARE @restored int = 0;
     BEGIN TRANSACTION;
     -- SQL Server disallows OUTPUT INTO tables with enabled CHECK constraints.
     DELETE FROM labor_compliance_excel_app.Trash
     OUTPUT DELETED.RecordType, DELETED.RecordId, DELETED.Title
     INTO @restoredRecord (RecordType, RecordId, Title)
     WHERE Id = @id AND ExpiresAtUtc > @now;
     SET @restored = @@ROWCOUNT;
     INSERT INTO labor_compliance_excel_app.TrashAudit
       (RecordType, RecordId, Title, ActionType, ActorId, OccurredAtUtc)
     SELECT RecordType, RecordId, Title, N'restored', @actorId, @now
     FROM @restoredRecord;
     COMMIT TRANSACTION;
     SELECT @restored AS restored;`,
  );
  if (Number((result.recordset[0] as DbRow | undefined)?.restored ?? 0) === 0) {
    throw new Error("This Trash item is missing or its 30-day recovery period has ended.");
  }
}

export async function ensureTrashStorageForReads(): Promise<void> {
  await ensureStorage();
  const pool = await getSqlPool();
  await safeQuery(
    pool.request(),
    `UPDATE labor_compliance_excel_app.Trash
        SET PayloadJson = NULL, AffectedRecordsJson = NULL
      WHERE ExpiresAtUtc <= SYSUTCDATETIME()
        AND (PayloadJson IS NOT NULL OR AffectedRecordsJson IS NOT NULL);`,
  );
}
