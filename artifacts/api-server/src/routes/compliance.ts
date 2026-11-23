import { getAuth } from "@clerk/express";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateContractorBody,
  CreateContractorResponse,
  DeleteContractorSubcontractorLinkParams,
  CreateProjectBody,
  CreateProjectResponse,
  CreateRestitutionBody,
  CreateRestitutionResponse,
  CreateWithholdingBody,
  CreateWithholdingResponse,
  GetTrashResponse,
  GetTrashAuditResponse,
  GetRecordHistoryParams,
  GetRecordHistoryResponse,
  GetDatabaseTablesResponse,
  GetReferenceOnlyResponse,
  GetRestitutionsResponse,
  QueryDatabaseTableRowsParams,
  GetWorkspaceResponse,
  GetWorkbookSheetRowsParams,
  GetWorkbookSheetRowsResponse,
  MoveRecordToTrashParams,
  MoveRecordToTrashResponse,
  RestoreTrashRecordParams,
  RestoreTrashRecordResponse,
  QueryDatabaseTableRowsBody,
  QueryDatabaseTableRowsResponse,
  UpdateDatabaseTableRowBody,
  UpdateDatabaseTableRowParams,
  UpdateDatabaseTableRowResponse,
  UpdateContractorBody,
  UpdateContractorParams,
  UpdateContractorResponse,
  UpdateContractorSubcontractorLinkBody,
  UpdateContractorSubcontractorLinkParams,
  UpdateContractorSubcontractorLinkResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
  UpdateRestitutionBody,
  UpdateRestitutionParams,
  UpdateRestitutionResponse,
  UpdateWithholdingBody,
  UpdateWithholdingParams,
  UpdateWithholdingResponse,
} from "@workspace/api-zod";
import {
  createContractor,
  ContractorSubcontractorStorageUnavailable,
  ContractorSubcontractorLinkConflictError,
  ContractorSubcontractorLinkInputError,
  ContractorSubcontractorLinkNotFoundError,
  createProject,
  createWithholding,
  getWorkbookSheetRows,
  getWorkspaceData,
  invalidateWorkspaceCache,
  updateContractorRecord,
  updateContractorSubcontractorLink,
  updateProjectRecord,
  updateWithholdingRecord,
  getWorkbookSourceRowById,
  getRecordHistory as readRecordHistory,
} from "../lib/sqlCompliance";
import {
  DatabaseRowUpdateError,
  getDatabaseCatalog,
  getDatabaseTableRows,
  updateDatabaseTableRow,
} from "../lib/databaseExplorer";
import { getReferenceOnlyData, invalidateReferenceOnlyCache } from "../lib/referenceOnly";
import {
  createRestitution,
  getRestitutions,
  RestitutionInputError,
  RestitutionNotFoundError,
  RestitutionStorageUnavailableError,
  updateRestitution,
} from "../lib/restitutions";
import {
  addTrashRecord,
  getTrashAuditEvents,
  getTrashRecords,
  restoreTrashRecord,
} from "../lib/trash";
import { buildTrashAffectedRecords } from "../lib/trashImpact";

const router: IRouter = Router();

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function staffActorId(req: Request): string {
  const userId = getAuth(req).userId;
  if (userId) return userId;
  if (process.env.NODE_ENV === "production") return "shared-staff-access";
  throw new Error("Authenticated staff identity is unavailable.");
}

function handleRestitutionError(error: unknown, res: Response): boolean {
  if (error instanceof RestitutionStorageUnavailableError) {
    res.status(503).json({ error: error.message });
    return true;
  }
  if (error instanceof RestitutionInputError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof RestitutionNotFoundError) {
    res.status(404).json({ error: error.message });
    return true;
  }
  return false;
}

function handleContractorSubcontractorLinkError(error: unknown, res: Response): boolean {
  if (error instanceof ContractorSubcontractorStorageUnavailable) {
    res.status(503).json({ error: error.message });
    return true;
  }
  if (error instanceof ContractorSubcontractorLinkInputError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof ContractorSubcontractorLinkConflictError) {
    res.status(409).json({ error: error.message });
    return true;
  }
  if (error instanceof ContractorSubcontractorLinkNotFoundError) {
    res.status(404).json({ error: error.message });
    return true;
  }
  return false;
}

router.get("/workspace", async (_req, res): Promise<void> => {
  const data = await getWorkspaceData();
  res.json(GetWorkspaceResponse.parse(data));
});

router.get("/trash", async (_req, res): Promise<void> => {
  const records = await getTrashRecords();
  res.json(GetTrashResponse.parse(records));
});

router.get("/trash/audit", async (_req, res): Promise<void> => {
  const events = await getTrashAuditEvents();
  res.json(GetTrashAuditResponse.parse(events));
});

router.get("/record-history/:recordType/:id", async (req, res): Promise<void> => {
  const params = GetRecordHistoryParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const events = await readRecordHistory(params.data.recordType, params.data.id);
  res.json(GetRecordHistoryResponse.parse(events));
});

router.delete("/trash/:recordType/:recordId", async (req, res): Promise<void> => {
  const params = MoveRecordToTrashParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }

  const { recordType, recordId } = params.data;
  const workspace = await getWorkspaceData();
  let snapshot: unknown = null;
  let title = "";
  let payloadJson: string | null = null;
  if (recordType === "project") {
    snapshot = workspace.projects.find((record) => record.id === recordId)
      ?? (await getReferenceOnlyData()).records.find((record) => record.id === recordId)
      ?? null;
    const projectSnapshot = snapshot as { projectName?: string; projectNumber?: string } | null;
    title = projectSnapshot?.projectName || `Project ${recordId}`;
    if (projectSnapshot?.projectNumber?.trim()) {
      title = `${title} · ${projectSnapshot.projectNumber.trim()}`;
    }
  } else if (recordType === "contractor") {
    snapshot = workspace.contractors.find((record) => record.id === recordId) ?? null;
    const contractorSnapshot = snapshot as { name?: string; aliases?: string } | null;
    title = contractorSnapshot?.name || `Contractor ${recordId}`;
    if (contractorSnapshot?.aliases?.trim()) {
      payloadJson = JSON.stringify({ aliases: contractorSnapshot.aliases });
    }
  } else if (recordType === "withholding") {
    snapshot = workspace.withholdings.find((record) => record.id === recordId) ?? null;
    const row = snapshot as { invoiceReference?: string; projectName?: string } | null;
    title = row?.invoiceReference
      ? `Withholding ${row.invoiceReference}`
      : `Withholding for ${row?.projectName || `record ${recordId}`}`;
  } else if (recordType === "restitution") {
    const records = await getRestitutions();
    snapshot = records.find((record) => record.id === recordId) ?? null;
    const row = snapshot as { apprenticeName?: string; projectName?: string } | null;
    title = row?.apprenticeName || `Restitution for ${row?.projectName || `record ${recordId}`}`;
  } else if (recordType === "subcontractorLink") {
    const link = workspace.contractors
      .flatMap((contractor) => contractor.subcontractors)
      .find((record) => record.linkId === recordId);
    snapshot = link ?? null;
    title = link
      ? `${link.subcontractorName} · ${link.projectName}`
      : `Subcontractor link ${recordId}`;
  } else if (recordType === "sourceRow") {
    snapshot = await getWorkbookSourceRowById(recordId);
    const row = snapshot as { sourceSheet?: string; excelRow?: number } | null;
    title = row ? `${row.sourceSheet} · Excel row ${row.excelRow}` : `Source row ${recordId}`;
  }

  if (!snapshot) {
    res.status(404).json({ error: "Record not found or it is already in Trash." });
    return;
  }

  try {
    const affectedRecords = await buildTrashAffectedRecords(
      recordType,
      recordId,
      snapshot,
      workspace,
    );
    const item = await addTrashRecord({
      recordType,
      recordId,
      title,
      payloadJson,
      actorId: staffActorId(req),
      affectedRecords,
    });
    invalidateWorkspaceCache();
    invalidateReferenceOnlyCache();
    res.status(200).json(MoveRecordToTrashResponse.parse(item));
  } catch (error) {
    const errorNumber = (error as { number?: number }).number;
    if (errorNumber === 2601 || errorNumber === 2627) {
      res.status(409).json({ error: "This record is already in Trash." });
      return;
    }
    throw error;
  }
});

router.post("/trash/:id/restore", async (req, res): Promise<void> => {
  const params = RestoreTrashRecordParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  try {
    await restoreTrashRecord(params.data.id, staffActorId(req));
    invalidateWorkspaceCache();
    invalidateReferenceOnlyCache();
    res.status(204).end();
  } catch (error) {
    if (error instanceof Error && error.message.includes("30-day recovery period")) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/reference-only", async (_req, res): Promise<void> => {
  const data = await getReferenceOnlyData();
  res.json(GetReferenceOnlyResponse.parse(data));
});

router.get("/workbook-sheets/:sheetName", async (req, res): Promise<void> => {
  const params = GetWorkbookSheetRowsParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const rows = await getWorkbookSheetRows(params.data.sheetName);
  res.json(GetWorkbookSheetRowsResponse.parse(rows));
});

router.get("/database/tables", async (_req, res): Promise<void> => {
  const catalog = await getDatabaseCatalog();
  res.json(GetDatabaseTablesResponse.parse(catalog));
});

router.post(
  "/database/tables/:schemaName/:tableName/rows",
  async (req, res): Promise<void> => {
    const params = QueryDatabaseTableRowsParams.safeParse(req.params);
    if (!params.success) {
      badRequest(res, params.error.message);
      return;
    }
    const body = QueryDatabaseTableRowsBody.safeParse(req.body);
    if (!body.success) {
      badRequest(res, body.error.message);
      return;
    }
    const rows = await getDatabaseTableRows(
      params.data.schemaName,
      params.data.tableName,
      body.data,
    );
    res.json(QueryDatabaseTableRowsResponse.parse(rows));
  },
);

router.patch(
  "/database/tables/:schemaName/:tableName/rows",
  async (req, res): Promise<void> => {
    const params = UpdateDatabaseTableRowParams.safeParse(req.params);
    if (!params.success) {
      badRequest(res, params.error.message);
      return;
    }
    const body = UpdateDatabaseTableRowBody.safeParse(req.body);
    if (!body.success) {
      badRequest(res, body.error.message);
      return;
    }
    let result: Awaited<ReturnType<typeof updateDatabaseTableRow>>;
    try {
      result = await updateDatabaseTableRow(
        params.data.schemaName,
        params.data.tableName,
        body.data,
      );
    } catch (error) {
      if (error instanceof DatabaseRowUpdateError) {
        badRequest(res, error.message);
        return;
      }
      throw error;
    }
    invalidateWorkspaceCache();
    invalidateReferenceOnlyCache();
    res.json(UpdateDatabaseTableRowResponse.parse(result));
  },
);

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  const project = await createProject(parsed.data, staffActorId(req));
  res.status(201).json(CreateProjectResponse.parse(project));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  const project = await updateProjectRecord(params.data.id, parsed.data, staffActorId(req));
  res.json(UpdateProjectResponse.parse(project));
});

router.post("/contractors", async (req, res): Promise<void> => {
  const parsed = CreateContractorBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  try {
    const contractor = await createContractor(parsed.data, staffActorId(req));
    res.status(201).json(CreateContractorResponse.parse(contractor));
  } catch (error) {
    if (error instanceof ContractorSubcontractorStorageUnavailable) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.patch("/contractors/:id", async (req, res): Promise<void> => {
  const params = UpdateContractorParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const parsed = UpdateContractorBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  const contractor = await updateContractorRecord(
    params.data.id,
    parsed.data,
    staffActorId(req),
  );
  res.json(UpdateContractorResponse.parse(contractor));
});

router.patch("/contractor-subcontractor-links/:id", async (req, res): Promise<void> => {
  const params = UpdateContractorSubcontractorLinkParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const parsed = UpdateContractorSubcontractorLinkBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  try {
    const link = await updateContractorSubcontractorLink(params.data.id, parsed.data);
    res.json(UpdateContractorSubcontractorLinkResponse.parse(link));
  } catch (error) {
    if (!handleContractorSubcontractorLinkError(error, res)) throw error;
  }
});

router.delete("/contractor-subcontractor-links/:id", async (req, res): Promise<void> => {
  const params = DeleteContractorSubcontractorLinkParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  try {
    const workspace = await getWorkspaceData();
    const link = workspace.contractors
      .flatMap((contractor) => contractor.subcontractors)
      .find((record) => record.linkId === params.data.id);
    if (!link) {
      res.status(404).json({ error: "Subcontractor link not found." });
      return;
    }
    await addTrashRecord({
      recordType: "subcontractorLink",
      recordId: params.data.id,
      title: `${link.subcontractorName} · ${link.projectName}`,
      actorId: staffActorId(req),
      affectedRecords: await buildTrashAffectedRecords(
        "subcontractorLink",
        params.data.id,
        link,
        workspace,
      ),
    });
    invalidateWorkspaceCache();
    invalidateReferenceOnlyCache();
    res.sendStatus(204);
  } catch (error) {
    if (!handleContractorSubcontractorLinkError(error, res)) throw error;
  }
});

router.post("/withholdings", async (req, res): Promise<void> => {
  const parsed = CreateWithholdingBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  const withholding = await createWithholding(parsed.data);
  res.status(201).json(CreateWithholdingResponse.parse(withholding));
});

router.patch("/withholdings/:id", async (req, res): Promise<void> => {
  const params = UpdateWithholdingParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const parsed = UpdateWithholdingBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  const withholding = await updateWithholdingRecord(
    params.data.id,
    parsed.data,
  );
  res.json(UpdateWithholdingResponse.parse(withholding));
});

router.get("/restitutions", async (_req, res): Promise<void> => {
  try {
    const records = await getRestitutions();
    res.json(GetRestitutionsResponse.parse(records));
  } catch (error) {
    if (!handleRestitutionError(error, res)) throw error;
  }
});

router.post("/restitutions", async (req, res): Promise<void> => {
  const parsed = CreateRestitutionBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  try {
    const record = await createRestitution(parsed.data);
    res.status(201).json(CreateRestitutionResponse.parse(record));
  } catch (error) {
    if (!handleRestitutionError(error, res)) throw error;
  }
});

router.patch("/restitutions/:id", async (req, res): Promise<void> => {
  const params = UpdateRestitutionParams.safeParse(req.params);
  if (!params.success) {
    badRequest(res, params.error.message);
    return;
  }
  const parsed = UpdateRestitutionBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }
  try {
    const record = await updateRestitution(params.data.id, parsed.data);
    res.json(UpdateRestitutionResponse.parse(record));
  } catch (error) {
    if (!handleRestitutionError(error, res)) throw error;
  }
});

export default router;
