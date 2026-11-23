/*
  Creates the SQL-backed Restitution records table.
  Run this script in the MIS119ATEMP database in SSMS before using the page.
  It is additive and safe to run more than once; it does not alter or delete
  existing project or withholding data.
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

  IF OBJECT_ID(N'labor_compliance_excel_app.NewRestitutions', N'U') IS NULL
  BEGIN
    CREATE TABLE labor_compliance_excel_app.NewRestitutions
    (
      Id int IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_NewRestitutions PRIMARY KEY,
      ProjectId int NULL,
      ProjectName nvarchar(255) NOT NULL
        CONSTRAINT DF_NewRestitutions_ProjectName DEFAULT (N''),
      ContractorId int NULL,
      ContractorName nvarchar(255) NOT NULL
        CONSTRAINT DF_NewRestitutions_ContractorName DEFAULT (N''),
      CaseReference nvarchar(255) NOT NULL
        CONSTRAINT DF_NewRestitutions_CaseReference DEFAULT (N''),
      WorkerReference nvarchar(255) NOT NULL
        CONSTRAINT DF_NewRestitutions_WorkerReference DEFAULT (N''),
      Reason nvarchar(max) NOT NULL
        CONSTRAINT DF_NewRestitutions_Reason DEFAULT (N''),
      AmountOwed decimal(19,4) NOT NULL
        CONSTRAINT DF_NewRestitutions_AmountOwed DEFAULT (0),
      AmountPaid decimal(19,4) NOT NULL
        CONSTRAINT DF_NewRestitutions_AmountPaid DEFAULT (0),
      IdentifiedDate date NULL,
      DueDate date NULL,
      PaidDate date NULL,
      Status nvarchar(40) NOT NULL
        CONSTRAINT DF_NewRestitutions_Status DEFAULT (N'Open'),
      PaymentReference nvarchar(255) NOT NULL
        CONSTRAINT DF_NewRestitutions_PaymentReference DEFAULT (N''),
      Notes nvarchar(max) NOT NULL
        CONSTRAINT DF_NewRestitutions_Notes DEFAULT (N''),
      FirstEmailSentDate date NULL,
      ApprenticeName nvarchar(255) NOT NULL
        CONSTRAINT DF_NewRestitutions_ApprenticeName DEFAULT (N''),
      ApprenticeCraft nvarchar(255) NOT NULL
        CONSTRAINT DF_NewRestitutions_ApprenticeCraft DEFAULT (N''),
      CprWeekEndingDate date NULL,
      UnsupervisedHoursDates nvarchar(max) NOT NULL
        CONSTRAINT DF_NewRestitutions_UnsupervisedHoursDates DEFAULT (N''),
      NumberOfUnsupervisedHours decimal(19,4) NULL,
      PaidForRestitution nvarchar(20) NOT NULL
        CONSTRAINT DF_NewRestitutions_PaidForRestitution DEFAULT (N'Not checked'),
      CheckCopyProvided bit NOT NULL
        CONSTRAINT DF_NewRestitutions_CheckCopyProvided DEFAULT (0),
      ProofOfDepositProvided bit NOT NULL
        CONSTRAINT DF_NewRestitutions_ProofOfDepositProvided DEFAULT (0),
      WageDifferenceCalculationsProvided bit NOT NULL
        CONSTRAINT DF_NewRestitutions_WageDifferenceCalculationsProvided DEFAULT (0),
      UploadedDocsInLcptracker nvarchar(20) NOT NULL
        CONSTRAINT DF_NewRestitutions_UploadedDocsInLcptracker DEFAULT (N'Not checked'),
      ConfidentialNotesAddedToCpr nvarchar(20) NOT NULL
        CONSTRAINT DF_NewRestitutions_ConfidentialNotesAddedToCpr DEFAULT (N'Not checked'),
      CprReviewAccepted nvarchar(20) NOT NULL
        CONSTRAINT DF_NewRestitutions_CprReviewAccepted DEFAULT (N'Not checked'),
      Comments nvarchar(max) NOT NULL
        CONSTRAINT DF_NewRestitutions_Comments DEFAULT (N''),
      CreatedAtUtc datetime2(7) NOT NULL
        CONSTRAINT DF_NewRestitutions_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
      UpdatedAtUtc datetime2(7) NOT NULL
        CONSTRAINT DF_NewRestitutions_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())
    );
  END;

  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'FirstEmailSentDate') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD FirstEmailSentDate date NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'ApprenticeName') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD ApprenticeName nvarchar(255) NOT NULL CONSTRAINT DF_NewRestitutions_ApprenticeName DEFAULT (N'') WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'ApprenticeCraft') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD ApprenticeCraft nvarchar(255) NOT NULL CONSTRAINT DF_NewRestitutions_ApprenticeCraft DEFAULT (N'') WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'CprWeekEndingDate') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD CprWeekEndingDate date NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'UnsupervisedHoursDates') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD UnsupervisedHoursDates nvarchar(max) NOT NULL CONSTRAINT DF_NewRestitutions_UnsupervisedHoursDates DEFAULT (N'') WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'NumberOfUnsupervisedHours') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD NumberOfUnsupervisedHours decimal(19,4) NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'PaidForRestitution') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD PaidForRestitution nvarchar(20) NOT NULL CONSTRAINT DF_NewRestitutions_PaidForRestitution DEFAULT (N'Not checked') WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'CheckCopyProvided') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD CheckCopyProvided bit NOT NULL CONSTRAINT DF_NewRestitutions_CheckCopyProvided DEFAULT (0) WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'ProofOfDepositProvided') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD ProofOfDepositProvided bit NOT NULL CONSTRAINT DF_NewRestitutions_ProofOfDepositProvided DEFAULT (0) WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'WageDifferenceCalculationsProvided') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD WageDifferenceCalculationsProvided bit NOT NULL CONSTRAINT DF_NewRestitutions_WageDifferenceCalculationsProvided DEFAULT (0) WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'UploadedDocsInLcptracker') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD UploadedDocsInLcptracker nvarchar(20) NOT NULL CONSTRAINT DF_NewRestitutions_UploadedDocsInLcptracker DEFAULT (N'Not checked') WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'ConfidentialNotesAddedToCpr') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD ConfidentialNotesAddedToCpr nvarchar(20) NOT NULL CONSTRAINT DF_NewRestitutions_ConfidentialNotesAddedToCpr DEFAULT (N'Not checked') WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'CprReviewAccepted') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD CprReviewAccepted nvarchar(20) NOT NULL CONSTRAINT DF_NewRestitutions_CprReviewAccepted DEFAULT (N'Not checked') WITH VALUES;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'Comments') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewRestitutions ADD Comments nvarchar(max) NOT NULL CONSTRAINT DF_NewRestitutions_Comments DEFAULT (N'') WITH VALUES;

  -- Dynamic SQL defers column binding until after the conditional ALTER TABLE statements.
  EXEC sys.sp_executesql N'
    UPDATE labor_compliance_excel_app.NewRestitutions
      SET PaidForRestitution = N''Yes''
      WHERE Status = N''Paid'' AND PaidForRestitution = N''Not checked'';
  ';

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT
  DB_NAME() AS CurrentDatabase,
  OBJECT_ID(N'labor_compliance_excel_app.NewRestitutions', N'U') AS NewRestitutionsObjectId,
  COL_LENGTH(N'labor_compliance_excel_app.NewRestitutions', N'ApprenticeName') AS ApprenticeNameColumnLength,
  HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.NewRestitutions', N'OBJECT', N'SELECT') AS CanSelect,
  HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.NewRestitutions', N'OBJECT', N'INSERT') AS CanInsert,
  HAS_PERMS_BY_NAME(N'labor_compliance_excel_app.NewRestitutions', N'OBJECT', N'UPDATE') AS CanUpdate;
