-- Run this in the same SQL Server database used by the dashboard.
-- Adds an optional app-owned Prime Approver field without changing source tables.
IF OBJECT_ID(N'labor_compliance_excel_app.ProjectEdits', N'U') IS NULL
  THROW 51000, 'labor_compliance_excel_app.ProjectEdits was not found in the current database.', 1;

IF OBJECT_ID(N'labor_compliance_excel_app.NewProjects', N'U') IS NULL
  THROW 51000, 'labor_compliance_excel_app.NewProjects was not found in the current database.', 1;

IF COL_LENGTH(N'labor_compliance_excel_app.ProjectEdits', N'PrimeApprover') IS NULL
  ALTER TABLE labor_compliance_excel_app.ProjectEdits ADD PrimeApprover nvarchar(1000) NULL;

IF COL_LENGTH(N'labor_compliance_excel_app.NewProjects', N'PrimeApprover') IS NULL
  ALTER TABLE labor_compliance_excel_app.NewProjects ADD PrimeApprover nvarchar(1000) NULL;
