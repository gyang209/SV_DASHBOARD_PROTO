import assert from "node:assert/strict";
import test from "node:test";
import type { ContractorSubcontractor, Project } from "@workspace/api-client-react";
import { groupContractorProjects, sortContractorProjectGroups } from "./contractorProjectGroups";

const project = (id: number, contractorId: number | null, projectName: string): Project => ({
  id,
  projectKey: `key-${id}`,
  projectNumber: `number-${id}`,
  projectName,
  dirNumber: "",
  classification: "",
  contractorId,
  contractorName: "",
  intakeDate: null,
  registrationStatus: "Not checked",
  payrollFormsStatus: "Not checked",
  formsStatus: "Not tracked",
  form1Status: "Not tracked",
  form2Status: "Not tracked",
  form3Status: "Not tracked",
  form4Status: "Not tracked",
  paymentDueDate: null,
  paymentDate: null,
  complianceNotes: "",
  projectInitiationDate: null,
  projectFinishDate: null,
  pwc100: false,
  pwc100RegisteredDate: null,
  pwc100ExpirationDate: null,
  designProjectManager: "",
  designProjectManagerEmail: "",
  designWeekStart: null,
  designWeekEnd: null,
  designPwcrExpirationDate: null,
  primeApprover: "",
  federalProject: false,
  federalProjectNumber: null,
  davisBaconDetermination: null,
  federalSetupInLcp: null,
  federalNotes: null,
  federalActive: null,
  designProject: false,
  onCall: false,
  pasCipDpw: false,
  latePayment: false,
  daysUntilDue: null,
});

const detail = (
  projectId: number,
  subcontractorId: number,
  subcontractorName: string,
): ContractorSubcontractor => ({
  id: `${projectId}:${subcontractorId}`,
  linkId: null,
  projectId,
  projectName: `Project ${projectId}`,
  projectNumber: `number-${projectId}`,
  projectType: "Design",
  subcontractorId,
  subcontractorName,
  lcpStatus: "Complete",
  dirStatus: "Not checked",
  completionStatus: "Incomplete",
});

test("groups details under their project and includes primary projects with no links", () => {
  const groups = groupContractorProjects(
    10,
    [project(2, 10, "Second"), project(1, 10, "First"), project(3, 11, "Other")],
    [detail(2, 20, "Sub B"), detail(2, 21, "Sub C"), detail(1, 22, "Sub A")],
  );

  assert.deepEqual(
    groups.map(({ projectId, projectName, subcontractors }) => ({
      projectId,
      projectName,
      subcontractorIds: subcontractors.map((row) => row.subcontractorId),
    })),
    [
      { projectId: 1, projectName: "First", subcontractorIds: [22] },
      { projectId: 2, projectName: "Second", subcontractorIds: [20, 21] },
    ],
  );
});

test("counts distinct subcontractors and omits projects without a linked primary", () => {
  const groups = groupContractorProjects(10, [
    project(7, null, "No primary"),
    project(8, 10, "Linked"),
  ], [
    detail(7, 30, "Sub A"),
    { ...detail(8, 30, "Sub A"), id: "duplicate-row" },
    detail(8, 31, "Sub B"),
    detail(9, 32, "Missing project"),
  ]);

  assert.deepEqual(groups.map(({ projectId, projectName, subcontractors }) => [
    projectId,
    projectName,
    subcontractors.length,
  ]), [[8, "Linked", 2]]);
});

test("returns an empty list when the contractor has no project details", () => {
  assert.deepEqual(groupContractorProjects(10, [project(1, 11, "Other")], []), []);
});

test("sorts project summaries by name, number, and distinct subcontractor count without changing details", () => {
  const groups = groupContractorProjects(10, [
    project(1, 10, "Project 10"),
    project(2, 10, "Project 2"),
    project(3, 10, "Alpha"),
  ], [
    detail(1, 20, "Sub A"),
    detail(1, 20, "Sub A"),
    detail(1, 21, "Sub B"),
    detail(2, 22, "Sub C"),
  ]);
  const originalGroups = groups.map((group) => ({
    ...group,
    subcontractors: [...group.subcontractors],
  }));

  assert.deepEqual(sortContractorProjectGroups(groups, "name:asc").map((group) => group.projectName), [
    "Alpha", "Project 2", "Project 10",
  ]);
  assert.deepEqual(sortContractorProjectGroups(groups, "name:desc").map((group) => group.projectName), [
    "Project 10", "Project 2", "Alpha",
  ]);
  assert.deepEqual(sortContractorProjectGroups(groups, "number:asc").map((group) => group.projectNumber), [
    "number-1", "number-2", "number-3",
  ]);
  assert.deepEqual(sortContractorProjectGroups(groups, "number:desc").map((group) => group.projectNumber), [
    "number-3", "number-2", "number-1",
  ]);
  assert.deepEqual(sortContractorProjectGroups(groups, "subcontractors:desc").map((group) => group.projectId), [
    1, 2, 3,
  ]);
  assert.deepEqual(sortContractorProjectGroups(groups, "subcontractors:asc").map((group) => group.projectId), [
    3, 2, 1,
  ]);
  assert.deepEqual(groups, originalGroups);
  assert.deepEqual(groups.map((group) => group.subcontractors.length), [0, 1, 2]);
});
