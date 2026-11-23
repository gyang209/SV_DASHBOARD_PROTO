import assert from "node:assert/strict";
import test from "node:test";
import type { Contractor, Project } from "@workspace/api-zod";
import {
  buildContractorChanges,
  buildProjectChanges,
  buildRecordCreatedChange,
} from "./recordHistory";

const project = {
  projectName: "Library Renovation",
  projectNumber: "TR - 12 - 34",
  dirNumber: "123456",
  classification: "Public Works",
  contractorId: 1,
  intakeDate: null,
  registrationStatus: "Registered",
  registrationCheckedOn: null,
  payrollFormsStatus: "Not checked",
  payrollFormsCheckedOn: null,
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
} as Project;

test("project history includes actual editable value differences only", () => {
  const changes = buildProjectChanges(
    {
      projectName: "Library and Civic Center",
      contractorId: 2,
      registrationStatus: "Registered",
      sourceSheets: "Imported data must not appear",
      sourceSheet: "Imported data must not appear",
      contractorName: "Derived value must not appear",
    },
    project,
    [{ id: 1, name: "Old Builder" }, { id: 2, name: "New Builder" }],
  );

  assert.deepEqual(changes, [
    { field: "Project name", before: "Library Renovation", after: "Library and Civic Center" },
    { field: "Primary contractor", before: "Old Builder", after: "New Builder" },
  ]);
});

test("project history normalizes dates, booleans, and empty linked values", () => {
  const changes = buildProjectChanges(
    { intakeDate: "2026-11-19T00:00:00.000Z", pwc100: true, contractorId: null },
    project,
  );

  assert.deepEqual(changes, [
    { field: "Primary contractor", before: "Contractor 1", after: "Not set" },
    { field: "Intake date", before: "Not set", after: "2026-11-19" },
    { field: "PWC-100", before: "No", after: "Yes" },
  ]);
});

test("contractor history records changed directory values and excludes source metadata", () => {
  const current = { name: "Northstar", aliases: "NS" } as Contractor;
  assert.deepEqual(
    buildContractorChanges(
      { name: "Northstar Construction", aliases: "", sourceCount: 10 },
      current,
    ),
    [
      { field: "Contractor name", before: "Northstar", after: "Northstar Construction" },
      { field: "Aliases", before: "NS", after: "(empty)" },
    ],
  );
});

test("creation history identifies the newly created record type", () => {
  assert.deepEqual(buildRecordCreatedChange("project"), [
    { field: "Record created", before: "", after: "Project" },
  ]);
  assert.deepEqual(buildRecordCreatedChange("contractor"), [
    { field: "Record created", before: "", after: "Contractor" },
  ]);
});
