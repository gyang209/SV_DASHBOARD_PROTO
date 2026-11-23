import assert from "node:assert/strict";
import test from "node:test";
import type {
  ContractorSubcontractor,
  Project,
  TrashRecordType,
  Withholding,
  WorkspaceData,
} from "@workspace/api-zod";
import { buildTrashAffectedRecordsFromData } from "./trashImpact";
import type { RestitutionRecord } from "./restitutions";
import type { WorkbookSourceRowRelation } from "./sqlCompliance";

const project = {
  id: 101,
  projectName: "Library Renovation",
  projectNumber: "0001234",
  contractorId: 1,
  contractorName: "Prime Build",
} as Project;

const link = {
  id: "source-link-1",
  linkId: 201,
  projectId: 101,
  projectName: "Library Renovation",
  projectNumber: "0001234",
  projectType: "Federal",
  subcontractorId: 2,
  subcontractorName: "ABC Electric",
  lcpStatus: "No",
  dirStatus: "Yes",
  projectRegistrationBypass: false,
  projectRegistrationBypassStatus: "",
  projectPayrollFormsBypass: false,
  projectPayrollFormsBypassStatus: "",
  completionStatus: "Incomplete",
} satisfies ContractorSubcontractor;

const withholding = {
  id: 301,
  projectId: 101,
  contractorId: 1,
  contractorName: "Prime Build",
} as Withholding;

const restitution = {
  id: 401,
  projectId: 101,
  projectName: "Library Renovation",
  contractorId: 2,
  contractorName: "ABC Electric",
} as RestitutionRecord;

const sourceRelation: WorkbookSourceRowRelation = {
  id: 501,
  sourceSheet: "Federal Projects",
  excelRow: 42,
  projectId: 101,
  projectName: "Library Renovation",
  contractorId: 2,
  contractorName: "ABC Electric",
  relationshipRole: "Subcontractor",
};

const projectSourceRelation: WorkbookSourceRowRelation = {
  ...sourceRelation,
  id: 502,
  relationshipRole: "project source",
};

const workspace = {
  projects: [project],
  contractors: [
    { id: 1, name: "Prime Build", aliases: "Prime Construction", subcontractors: [link] },
    { id: 2, name: "ABC Electric", aliases: "ABC Power; A.B.C. Electric", subcontractors: [] },
  ],
  withholdings: [withholding],
  summary: {},
} as unknown as WorkspaceData;

function affectedTypes(
  type: TrashRecordType,
  id: number,
  snapshot: unknown,
  sourceRelations: WorkbookSourceRowRelation[] = [sourceRelation],
) {
  return buildTrashAffectedRecordsFromData(
    type,
    id,
    snapshot,
    workspace,
    [restitution],
    sourceRelations,
  );
}

test("project Trash snapshots its contractor, links, payment records, and source row", () => {
  const affected = affectedTypes("project", 101, project, [projectSourceRelation]);

  assert.deepEqual(
    new Set(affected.map((item) => item.recordType)),
    new Set(["contractor", "subcontractorLink", "withholding", "restitution", "sourceRow"]),
  );
  assert.equal(affected.some((item) => item.recordId === "101"), false);
});

test("contractor Trash snapshots its projects and records without deleting them", () => {
  const primaryAffected = affectedTypes("contractor", 1, workspace.contractors[0]);
  const subcontractorAffected = affectedTypes("contractor", 2, workspace.contractors[1]);

  assert.deepEqual(
    new Set(primaryAffected.map((item) => item.recordType)),
    new Set(["project", "contractor", "subcontractorLink", "withholding"]),
  );
  assert.deepEqual(
    new Set(subcontractorAffected.map((item) => item.recordType)),
    new Set(["project", "contractor", "subcontractorLink", "restitution"]),
  );
  assert.equal(
    subcontractorAffected.find((item) => item.recordType === "contractor")?.alternateNames,
    "Prime Construction",
  );
  assert.match(primaryAffected.find((item) => item.recordType === "project")?.impact ?? "", /remains stored/i);
});

test("withholding and restitution Trash snapshots retain their linked project and contractor", () => {
  const withholdingAffected = affectedTypes("withholding", 301, withholding);
  const restitutionAffected = affectedTypes("restitution", 401, restitution);

  assert.deepEqual(
    new Set(withholdingAffected.map((item) => item.recordType)),
    new Set(["project", "contractor"]),
  );
  assert.deepEqual(
    new Set(restitutionAffected.map((item) => item.recordType)),
    new Set(["project", "contractor"]),
  );
});

test("subcontractor-link Trash snapshots its project and both contractors", () => {
  const affected = affectedTypes("subcontractorLink", 201, link);

  assert.deepEqual(
    new Set(affected.map((item) => item.recordType)),
    new Set(["project", "contractor"]),
  );
  assert.equal(affected.filter((item) => item.recordType === "contractor").length, 2);
});

test("source-row Trash snapshots linked records and explains the hidden relationship", () => {
  const affected = affectedTypes("sourceRow", 501, sourceRelation);

  assert.deepEqual(
    new Set(affected.map((item) => item.recordType)),
    new Set(["project", "contractor"]),
  );
  assert.ok(affected.every((item) => item.impact.includes("source row is in Trash")));
});
