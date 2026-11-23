import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSqlConfig,
  quoteSqlIdentifier,
  SqlServerError,
} from "./sqlServer";

test("SQL connection string settings are parsed with encrypted Azure defaults", () => {
  const config = buildSqlConfig({
    AZURE_CONNECTION_STRING:
      "Server=tcp:example.database.windows.net,1433;Initial Catalog=MIS119ATEMP;User ID=sql_user;Password=test-password;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;",
  });

  assert.equal(config.server, "example.database.windows.net");
  assert.equal(config.port, 1433);
  assert.equal(config.database, "MIS119ATEMP");
  assert.equal(config.user, "sql_user");
  assert.equal(config.password, "test-password");
  assert.equal(config.options?.encrypt, true);
  assert.equal(config.options?.trustServerCertificate, false);
  assert.equal(config.connectionTimeout, 15_000);
  assert.equal(config.requestTimeout, 30_000);
});

test("Entra service principal settings override SQL credentials in the connection string", () => {
  const config = buildSqlConfig({
    AZURE_AUTH_MODE: "service-principal",
    AZURE_CONNECTION_STRING:
      "Server=tcp:example.database.windows.net,1433;Initial Catalog=MIS119ATEMP;Encrypt=True;TrustServerCertificate=False;",
    AZURE_ENTRA_TENANT_ID: "tenant-id",
    AZURE_ENTRA_CLIENT_ID: "client-id",
    AZURE_ENTRA_CLIENT_SECRET: "client-secret",
  });

  assert.equal(config.server, "example.database.windows.net");
  assert.equal(config.port, 1433);
  assert.equal(config.database, "MIS119ATEMP");
  assert.equal(
    config.authentication?.type,
    "azure-active-directory-service-principal-secret",
  );
  assert.equal(config.user, undefined);
  assert.equal(config.password, undefined);
  assert.equal(config.options?.encrypt, true);
  assert.equal(config.options?.trustServerCertificate, false);
});

test("Entra service principal mode requires all identity secrets", () => {
  assert.throws(
    () =>
      buildSqlConfig({
        AZURE_AUTH_MODE: "service-principal",
        AZURE_CONNECTION_STRING:
          "Server=tcp:example.database.windows.net,1433;Initial Catalog=MIS119ATEMP;",
        AZURE_ENTRA_TENANT_ID: "tenant-id",
        AZURE_ENTRA_CLIENT_ID: "client-id",
      }),
    SqlServerError,
  );
});

test("legacy SQL settings remain supported when no connection string is set", () => {
  const config = buildSqlConfig({
    AZURE_DB_SERVER: "example.database.windows.net",
    AZURE_DB_PORT: "1433",
    AZURE_DB_NAME: "MIS119ATEMP",
    AZURE_DB_USER: "sql_user",
    AZURE_DB_PW: "test-password",
  });

  assert.equal(config.server, "example.database.windows.net");
  assert.equal(config.port, 1433);
  assert.equal(config.database, "MIS119ATEMP");
  assert.equal(config.user, "sql_user");
  assert.equal(config.password, "test-password");
});

test("invalid or incomplete SQL connection strings fail without exposing details", () => {
  assert.throws(
    () => buildSqlConfig({ AZURE_CONNECTION_STRING: "not a connection string" }),
    SqlServerError,
  );
  assert.throws(
    () =>
      buildSqlConfig({
        AZURE_CONNECTION_STRING:
          "Server=example.database.windows.net;Database=MIS119ATEMP;Encrypt=True;",
      }),
    SqlServerError,
  );
});

test("SQL identifiers are quoted only after strict name validation", () => {
  assert.equal(quoteSqlIdentifier("labor_compliance_excel_stage"), "[labor_compliance_excel_stage]");
  assert.equal(quoteSqlIdentifier("ProjectContractors"), "[ProjectContractors]");
  assert.throws(() => quoteSqlIdentifier("Projects]; DROP TABLE Users;--"), SqlServerError);
  assert.throws(() => quoteSqlIdentifier(""), SqlServerError);
});
