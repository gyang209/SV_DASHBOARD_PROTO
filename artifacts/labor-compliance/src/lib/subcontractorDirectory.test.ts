import assert from "node:assert/strict";
import test from "node:test";
import type { Contractor, ContractorSubcontractor, Project } from "@workspace/api-client-react";
import { buildSubcontractorDirectory } from "./subcontractorDirectory";

const project = (
  id: number,
  contractorId: number | null,
  projectName: string,
  overrides: Partial<Project> = {},
): Project => ({
  id,
  projectKey: `key-${id}`,
  projectNumber: `number-${id}`,
  projectName,
  dirNumber: "",
  classification: "",
  contractorId,
  contractorName: contractorId === null ? "" : `Prime ${contractorId}`,
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
  ...overrides,
});

const detail = (projectId: number, subcontractorId: number, subcontractorName: string): ContractorSubcontractor => ({
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

const contractor = (id: number, subcontractors: ContractorSubcontractor[]): Contractor => ({
  id,
  name: `Prime ${id}`,
  aliases: "",
  sourceCount: 1,
  projectCount: 1,
  subcontractorCount: subcontractors.length,
  subcontractors,
});

test("lists distinct linked subcontractors alphabetically with unique linked projects", () => {
  const result = buildSubcontractorDirectory([
    contractor(1, [detail(10, 30, "Zeta"), detail(10, 20, "Alpha"), detail(10, 20, "Alpha"), detail(11, 20, "Alpha")]),
    contractor(2, [detail(12, 40, "Beta")]),
  ], [
    project(10, 1, "Project 10", {
      federalProject: true,
      registrationStatus: "Registered",
      payrollFormsStatus: "Complete",
    }),
    project(11, 1, "Project 11"),
    project(12, 2, "Project 12"),
  ]);

  assert.deepEqual(result.map(({ name, projects }) => [name, projects.length]), [
    ["Alpha", 2],
    ["Beta", 1],
    ["Zeta", 1],
  ]);
  assert.deepEqual(result[0].projects.map(({ primaryContractorName }) => primaryContractorName), [
    "Prime 1",
    "Prime 1",
  ]);
  assert.deepEqual(
    [result[0].projects[0].projectType, result[0].projects[0].lcpStatus, result[0].projects[0].dirStatus],
    ["Federal project", "Registered", "Complete"],
  );
});

test("omits subcontractor project links without a matching primary contractor project", () => {
  const result = buildSubcontractorDirectory([
    contractor(1, [detail(10, 20, "Linked"), detail(11, 21, "No primary")]),
  ], [
    project(10, 1, "Valid"),
    project(11, null, "Unassigned"),
  ]);

  assert.deepEqual(result.map(({ name, projects }) => [name, projects.length]), [["Linked", 1]]);
});
