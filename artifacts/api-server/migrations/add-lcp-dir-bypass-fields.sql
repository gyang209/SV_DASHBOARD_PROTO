-- Store the LCP and DIR bypass selections separately from each project's source status.
-- Existing records start with bypass disabled; their current status values are unchanged.
-- Run in the dashboard API database with ALTER permission on both app-owned tables.
SET XACT_ABORT ON;

SELECT
  DB_NAME() AS CurrentDatabase,
  OBJECT_ID(N'labor_compliance_excel_app.ProjectEdits', N'U') AS ProjectEditsTableId,
  OBJECT_ID(N'labor_compliance_excel_app.NewProjects', N'U') AS NewProjectsTableId;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'labor_compliance_excel_app.ProjectEdits', N'U') IS NULL
    THROW 51000, 'ProjectEdits is not visible as a table in the current database. Check database context, object type, and permissions.', 1;
  IF OBJECT_ID(N'labor_compliance_excel_app.NewProjects', N'U') IS NULL
    THROW 51001, 'NewProjects is not visible as a table in the current database. Check database context, object type, and permissions.', 1;

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
    ALTER TABLE labor_compliance_excel_app.NewProjects ADD PayrollFormsBypassStatus nvarchar(20) NULL;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
