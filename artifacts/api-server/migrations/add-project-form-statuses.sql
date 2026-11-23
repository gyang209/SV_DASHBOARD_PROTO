-- Add independently editable Form 1–4 statuses and Active Federal fields to
-- the app-owned SQL Server project tables. NULL existing form values are read
-- by the dashboard as "Not tracked"; Federal fields fall back to source cells.
-- Run this in the same database configured for the dashboard API, using an account
-- that can view and alter the labor_compliance_excel_app tables.
SET XACT_ABORT ON;

SELECT
  DB_NAME() AS CurrentDatabase,
  OBJECT_ID(N'labor_compliance_excel_app.ProjectEdits') AS ProjectEditsObjectId,
  OBJECT_ID(N'labor_compliance_excel_app.ProjectEdits', N'U') AS ProjectEditsTableId,
  OBJECT_ID(N'labor_compliance_excel_app.NewProjects') AS NewProjectsObjectId,
  OBJECT_ID(N'labor_compliance_excel_app.NewProjects', N'U') AS NewProjectsTableId;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'labor_compliance_excel_app.ProjectEdits', N'U') IS NULL
    THROW 51000, 'ProjectEdits is not visible as a table in the current database. Check database context, object type, and permissions.', 1;
  IF OBJECT_ID(N'labor_compliance_excel_app.NewProjects', N'U') IS NULL
    THROW 51001, 'NewProjects is not visible as a table in the current database. Check database context, object type, and permissions.', 1;

  IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form1Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form1Status nvarchar(40) NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form2Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form2Status nvarchar(40) NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form3Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form3Status nvarchar(40) NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'Form4Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD Form4Status nvarchar(40) NULL;
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

  IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form1Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form1Status nvarchar(40) NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form2Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form2Status nvarchar(40) NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form3Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form3Status nvarchar(40) NULL;
  IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'Form4Status') IS NULL
    ALTER TABLE labor_compliance_excel_app.NewProjects ADD Form4Status nvarchar(40) NULL;
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

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
