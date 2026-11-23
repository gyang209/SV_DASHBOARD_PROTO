import sql from "mssql";
import { logger } from "./logger";

export class SqlServerError extends Error {
  readonly code = "SQL_SERVER_UNAVAILABLE";

  constructor() {
    super("The SQL Server request could not be completed.");
    this.name = "SqlServerError";
  }
}

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function buildSqlConfig(environment: NodeJS.ProcessEnv = process.env): sql.config {
  const authMode = environment.AZURE_AUTH_MODE?.trim().toLowerCase();
  if (authMode === "service-principal") {
    return buildServicePrincipalConfig(environment);
  }

  const connectionString = environment.AZURE_CONNECTION_STRING?.trim();
  if (connectionString) {
    let parsed: sql.config;
    try {
      parsed = sql.ConnectionPool.parseConnectionString(connectionString);
    } catch {
      throw new SqlServerError();
    }

    if (!parsed.server || !parsed.database || !parsed.user || !parsed.password) {
      throw new SqlServerError();
    }

    return {
      ...parsed,
      options: {
        ...parsed.options,
        encrypt: true,
        trustServerCertificate: parsed.options?.trustServerCertificate ?? false,
        enableArithAbort: true,
      },
      connectionTimeout: 15_000,
      requestTimeout: 30_000,
      pool: {
        ...parsed.pool,
        max: 10,
        min: 0,
        idleTimeoutMillis: 30_000,
      },
    };
  }

  const port = Number(requiredSettingFrom(environment, "AZURE_DB_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new SqlServerError();
  }

  return {
    server: requiredSettingFrom(environment, "AZURE_DB_SERVER"),
    port,
    database: requiredSettingFrom(environment, "AZURE_DB_NAME"),
    user: requiredSettingFrom(environment, "AZURE_DB_USER"),
    password: requiredSettingFrom(environment, "AZURE_DB_PW"),
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
  };
}

function buildServicePrincipalConfig(
  environment: NodeJS.ProcessEnv,
): sql.config {
  const connectionString = requiredSettingFrom(
    environment,
    "AZURE_CONNECTION_STRING",
  );
  let parsed: sql.config;
  try {
    parsed = sql.ConnectionPool.parseConnectionString(connectionString);
  } catch {
    throw new SqlServerError();
  }

  if (!parsed.server || !parsed.database) {
    throw new SqlServerError();
  }

  return {
    server: parsed.server,
    port: parsed.port,
    database: parsed.database,
    options: {
      ...parsed.options,
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
    },
    authentication: {
      type: "azure-active-directory-service-principal-secret",
      options: {
        tenantId: requiredSettingFrom(environment, "AZURE_ENTRA_TENANT_ID"),
        clientId: requiredSettingFrom(environment, "AZURE_ENTRA_CLIENT_ID"),
        clientSecret: requiredSettingFrom(
          environment,
          "AZURE_ENTRA_CLIENT_SECRET",
        ),
      },
    },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  };
}

function requiredSettingFrom(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new SqlServerError();
  }
  return value;
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UNKNOWN";
  const record = error as { code?: unknown; originalError?: { code?: unknown } };
  const candidate = record.code ?? record.originalError?.code;
  return typeof candidate === "string" && /^[A-Z0-9_-]+$/i.test(candidate)
    ? candidate
    : "UNKNOWN";
}

function asErrorRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeErrorDetails(error: unknown): Record<string, string | number> {
  const record = asErrorRecord(error);
  const original = asErrorRecord(record?.originalError);
  const info = asErrorRecord(original?.info) ?? asErrorRecord(record?.info);
  const causeCode = safeErrorCode(original);
  const causeName = original?.name;
  const errorNumber = record?.number ?? original?.number ?? info?.number;
  const errorState = record?.state ?? original?.state ?? info?.state;
  const errorClass = record?.class ?? original?.class ?? info?.class;

  return {
    errorCode: safeErrorCode(error),
    ...(causeCode !== "UNKNOWN" ? { causeCode } : {}),
    ...(typeof causeName === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(causeName)
      ? { causeName }
      : {}),
    ...(typeof errorNumber === "number" && Number.isFinite(errorNumber)
      ? { sqlErrorNumber: errorNumber }
      : {}),
    ...(typeof errorState === "number" && Number.isFinite(errorState)
      ? { sqlErrorState: errorState }
      : {}),
    ...(typeof errorClass === "number" && Number.isFinite(errorClass)
      ? { sqlErrorClass: errorClass }
      : {}),
  };
}

export async function getSqlPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const usingConnectionString = Boolean(
      process.env.AZURE_CONNECTION_STRING?.trim(),
    );
    const authMode =
      process.env.AZURE_AUTH_MODE?.trim().toLowerCase() === "service-principal"
        ? "entra-service-principal"
        : usingConnectionString
          ? "sql-connection-string"
          : "legacy-sql-settings";
    const config = buildSqlConfig();
    const connectionTarget = {
      authMode,
      server: config.server,
      database: config.database,
    };
    const pool = new sql.ConnectionPool(config);

    poolPromise = pool.connect().catch((error: unknown) => {
      logger.error(
        { ...connectionTarget, ...safeErrorDetails(error) },
        "SQL Server connection failed",
      );
      poolPromise = null;
      throw new SqlServerError();
    });
  }
  return poolPromise;
}

export async function safeQuery(
  request: sql.Request,
  statement: string,
): Promise<sql.IResult<unknown>> {
  try {
    return await request.query(statement);
  } catch (error) {
    logger.error(safeErrorDetails(error), "SQL Server request failed");
    throw new SqlServerError();
  }
}

export function quoteSqlIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new SqlServerError();
  }
  return `[${identifier.replaceAll("]", "]]")}]`;
}

export { sql };
