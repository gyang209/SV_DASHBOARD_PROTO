/*
  Adds app-owned links between a primary contractor, a subcontractor, and an
  existing dashboard project. This migration is additive and safe to rerun.
  Run it in MIS119ATEMP before creating or maintaining subcontractor links.
*/
SET NOCOUNT ON;

IF DB_NAME() <> N'MIS119ATEMP'
BEGIN
  THROW 51000, 'Run this migration in the MIS119ATEMP database.', 1;
END;

IF SCHEMA_ID(N'labor_compliance_excel_app') IS NULL
BEGIN
  THROW 51001, 'The labor_compliance_excel_app schema was not found in MIS119ATEMP.', 1;
END;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'U') IS NULL
  BEGIN
    CREATE TABLE labor_compliance_excel_app.ContractorSubcontractorLinks
    (
      Id int IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_ContractorSubcontractorLinks PRIMARY KEY,
      PrimaryContractorId int NOT NULL,
      SubcontractorId int NOT NULL,
      ProjectId int NOT NULL,
      ProjectType nvarchar(40) NOT NULL,
      CreatedAtUtc datetime2(7) NOT NULL
        CONSTRAINT DF_ContractorSubcontractorLinks_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT UQ_ContractorSubcontractorLinks_Relationship
        UNIQUE (PrimaryContractorId, SubcontractorId, ProjectId)
    );

    CREATE INDEX IX_ContractorSubcontractorLinks_PrimaryContractor
      ON labor_compliance_excel_app.ContractorSubcontractorLinks (PrimaryContractorId);
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT
  DB_NAME() AS CurrentDatabase,
  OBJECT_ID(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'U') AS ContractorSubcontractorLinksObjectId,
  HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'OBJECT', N'SELECT') AS CanSelect,
  HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'OBJECT', N'INSERT') AS CanInsert,
  HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'OBJECT', N'UPDATE') AS CanUpdate,
  HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.ContractorSubcontractorLinks', N'OBJECT', N'DELETE') AS CanDelete;
