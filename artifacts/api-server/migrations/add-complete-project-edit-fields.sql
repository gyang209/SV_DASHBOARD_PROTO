/*
  Add independently editable Design details to the app-owned project overlays.
  Run in the same database used by the dashboard's Azure SQL connection.
  The script is additive and safe to rerun.
*/
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'labor_compliance_excel_app.ProjectEdits', N'U') IS NULL
    THROW 51000, 'labor_compliance_excel_app.ProjectEdits was not found in the current database.', 1;
  IF OBJECT_ID(N'labor_compliance_excel_app.NewProjects', N'U') IS NULL
    THROW 51001, 'labor_compliance_excel_app.NewProjects was not found in the current database.', 1;

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
    ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD DesignPwcrExpirationDateEdited bit NOT NULL
      CONSTRAINT DF_LCEA_ProjectEdits_DesignPwcrExpirationDateEdited DEFAULT (0);

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
    ALTER TABLE labor_compliance_excel_app.NewProjects ADD DesignPwcrExpirationDateEdited bit NOT NULL
      CONSTRAINT DF_LCEA_NewProjects_DesignPwcrExpirationDateEdited DEFAULT (0);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
