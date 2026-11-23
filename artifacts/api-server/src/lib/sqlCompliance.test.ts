import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CreateContractorBody,
  UpdateProjectBody,
  UpdateContractorSubcontractorLinkResponse,
  UpdateContractorSubcontractorLinkBody,
} from "@workspace/api-zod";
import {
  mapSqlContractor,
  mapSqlProject,
  mapSqlWithholding,
  projectWriteValues,
  resolvePrimaryContractorId,
} from "./sqlCompliance";

test("SQL project mapping does not infer form completion without source data", () => {
  const project = mapSqlProject({
    id: 17,
    projectKey: "LC-17",
    projectNumber: "PA-1234567",
    projectName: "Example public works project",
    category: "CIP_DPW",
    sourceSheets: '["1. LCP & DIR - PAS CIP+DPW"]',
  });

  assert.equal(project.id, 17);
  assert.equal(project.pasCipDpw, true);
  assert.equal(project.formsStatus, "Not tracked");
  assert.equal(project.form1Status, "Not tracked");
  assert.equal(project.federalProject, false);
});

test("SQL project mapping respects an edited source-sheet list", () => {
  const project = mapSqlProject({
    id: 18,
    projectKey: "LC-18",
    projectNumber: "ST-12-34",
    projectName: "Another project",
    category: "CIP_DPW",
    sourceSheets: "[]",
  });

  assert.equal(project.pasCipDpw, false);
});

test("SQL project mapping keeps selected project types independent", () => {
  const project = mapSqlProject({
    id: 181,
    projectName: "Federal design and CIP project",
    federalProject: true,
    designProject: true,
    onCall: false,
    category: "Design",
    sourceSheets: '["Active Federal Projects","2. LCP & DIR - DESIGN","1. LCP & DIR - PAS CIP+DPW"]',
  });

  assert.deepEqual(
    [project.federalProject, project.designProject, project.onCall, project.pasCipDpw],
    [true, true, false, true],
  );
});

test("SQL project mapping honors explicit false type overrides", () => {
  const project = mapSqlProject({
    id: 182,
    projectName: "Federal-only project",
    category: "Design",
    designProject: false,
    onCall: false,
    sourceSheet: "2. LCP & DIR - DESIGN",
    sourceSheets: '["Active Federal Projects"]',
  });

  assert.equal(project.designProject, false);
  assert.equal(project.onCall, false);
  assert.equal(project.pasCipDpw, false);
});

test("SQL project mapping reads independently editable form statuses", () => {
  const project = mapSqlProject({
    id: 19,
    projectName: "Federal project",
    form1Status: "Complete",
    form2Status: "Missing",
    form3Status: "Not checked",
    form4Status: "Unknown",
  });

  assert.deepEqual(
    [project.form1Status, project.form2Status, project.form3Status, project.form4Status],
    ["Complete", "Missing", "Not checked", "Not tracked"],
  );
});

test("SQL project mapping keeps Federal-only fields available to the page", () => {
  const project = mapSqlProject({
    id: 20,
    projectName: "Federal project",
    federalProjectNumber: "FP-2030",
    davisBaconDetermination: "WA20260001 · Mod 2",
    federalSetupInLcp: "Yes",
    federalNotes: "Verify wage determination",
    federalActive: "Active",
  });

  assert.deepEqual(
    [
      project.federalProjectNumber,
      project.davisBaconDetermination,
      project.federalSetupInLcp,
      project.federalNotes,
      project.federalActive,
    ],
    [
      "FP-2030",
      "WA20260001 · Mod 2",
      "Yes",
      "Verify wage determination",
      "Active",
    ],
  );
});

test("SQL project mapping keeps the optional Prime Approver independent", () => {
  const project = mapSqlProject({
    id: 29,
    projectKey: "LC-29",
    projectNumber: "PA-12-34",
    projectName: "On-call project",
    category: "OnCall_NonPAS",
    primeApprover: "Casey Reviewer",
  });

  assert.equal(project.primeApprover, "Casey Reviewer");
  assert.equal(project.designProjectManager, "Casey Reviewer");
  assert.equal(project.onCall, true);
});

test("project edit API accepts and SQL mapping round-trips all Design edit fields", () => {
  const input = {
    designProjectManager: "Jordan Lee",
    designProjectManagerEmail: "jordan@example.org",
    designWeekStart: "2026-11-02",
    designWeekEnd: "2026-11-08",
    designPwcrExpirationDate: "2026-12-31",
  };
  assert.equal(UpdateProjectBody.safeParse(input).success, true);

  const values = projectWriteValues({
    projectName: "Design project",
    ...input,
  });
  assert.deepEqual(
    [
      values.DesignProjectManager,
      values.DesignProjectManagerEmail,
      values.DesignWeekStart,
      values.DesignWeekEnd,
      values.DesignPwcrExpirationDate,
      values.DesignPwcrExpirationDateEdited,
    ],
    [
      "Jordan Lee",
      "jordan@example.org",
      "2026-11-02",
      "2026-11-08",
      "2026-12-31",
      true,
    ],
  );

  const project = mapSqlProject({
    id: 30,
    projectName: "Design project",
    primeApprover: "Primary approver",
    designProjectManager: values.DesignProjectManager,
    designProjectManagerEmail: values.DesignProjectManagerEmail,
    designWeekStart: values.DesignWeekStart,
    designWeekEnd: values.DesignWeekEnd,
    designPwcrExpirationDate: values.DesignPwcrExpirationDate,
  });
  assert.deepEqual(
    [
      project.designProjectManager,
      project.designProjectManagerEmail,
      project.designWeekStart,
      project.designWeekEnd,
      project.designPwcrExpirationDate,
    ],
    [
      "Jordan Lee",
      "jordan@example.org",
      "2026-11-02",
      "2026-11-08",
      "2026-12-31",
    ],
  );
});

test("project LCP and DIR bypass selections persist independently", () => {
  const input = {
    registrationBypass: true,
    registrationBypassStatus: "OK",
    payrollFormsBypass: true,
    payrollFormsBypassStatus: "Completed",
  };
  assert.equal(UpdateProjectBody.safeParse(input).success, true);

  const values = projectWriteValues({ projectName: "Bypass test", ...input });
  assert.deepEqual([
    values.RegistrationBypass,
    values.RegistrationBypassStatus,
    values.PayrollFormsBypass,
    values.PayrollFormsBypassStatus,
  ], [true, "OK", true, "Completed"]);

  const project = mapSqlProject({
    id: 31,
    projectName: "Bypass test",
    registrationBypass: values.RegistrationBypass,
    registrationBypassStatus: values.RegistrationBypassStatus,
    payrollFormsBypass: values.PayrollFormsBypass,
    payrollFormsBypassStatus: values.PayrollFormsBypassStatus,
  });
  assert.equal(project.registrationBypass, true);
  assert.equal(project.registrationBypassStatus, "OK");
  assert.equal(project.payrollFormsBypass, true);
  assert.equal(project.payrollFormsBypassStatus, "Completed");
});

test("an explicitly cleared Design Project Manager does not fall back to Prime Approver", () => {
  const project = mapSqlProject({
    id: 31,
    projectName: "Design project",
    primeApprover: "Primary approver",
    designProjectManager: "",
  });
  assert.equal(project.designProjectManager, "");
});

test("SQL contractor mapping normalizes nullable source values", () => {
  assert.deepEqual(
    mapSqlContractor({
      id: 9,
      name: "Example Contractor",
      aliases: null,
      sourceCount: null,
      sourceSheets: null,
    }),
    {
      id: 9,
      name: "Example Contractor",
      aliases: "",
      sourceCount: 0,
      sourceSheets: "",
      projectCount: 0,
      subcontractorCount: 0,
      subcontractors: [],
    },
  );
});

test("primary project links resolve by contractor ID or a unique name alias", () => {
  const contractors = [
    { id: 10, name: "Acme Builders", aliases: "Acme; A.B. Construction" },
    { id: 11, name: "North Works", aliases: "" },
  ];

  assert.equal(
    resolvePrimaryContractorId({ contractorId: 11, contractorName: "Acme" }, contractors),
    11,
  );
  assert.equal(
    resolvePrimaryContractorId({ contractorId: null, contractorName: "A.B. Construction" }, contractors),
    10,
  );
  assert.equal(
    resolvePrimaryContractorId({ contractorId: 999, contractorName: "North Works" }, contractors),
    11,
  );
});

test("ambiguous contractor aliases do not create an automatic project link", () => {
  const contractors = [
    { id: 10, name: "Acme Builders", aliases: "Acme" },
    { id: 11, name: "Acme Services", aliases: "Acme" },
  ];

  assert.equal(
    resolvePrimaryContractorId({ contractorId: null, contractorName: "Acme" }, contractors),
    null,
  );
});

test("SQL contractor mapping preserves project and subcontractor totals", () => {
  assert.deepEqual(
    mapSqlContractor({
      id: 12,
      name: "Example Prime",
      aliases: "",
      sourceCount: 0,
      sourceSheets: "",
      projectCount: 4,
      subcontractorCount: 7,
    }),
    {
      id: 12,
      name: "Example Prime",
      aliases: "",
      sourceCount: 0,
      sourceSheets: "",
      projectCount: 4,
      subcontractorCount: 7,
      subcontractors: [],
    },
  );
});

test("contractor creation validates an optional linked subcontractor", () => {
  assert.equal(CreateContractorBody.safeParse({
    name: "Prime Contractor",
    subcontractor: {
      name: "Subcontractor One",
      projectId: 22,
      projectType: "Design",
    },
  }).success, true);
  assert.equal(CreateContractorBody.safeParse({
    name: "Prime Contractor",
    subcontractor: {
      contractorId: 41,
      projectId: 22,
      projectType: "Design",
    },
  }).success, true);
  assert.equal(CreateContractorBody.safeParse({
    name: "Prime Contractor",
    subcontractor: {
      projectId: 22,
      projectType: "Design",
    },
  }).success, false);
  assert.equal(CreateContractorBody.safeParse({
    name: "Prime Contractor",
    subcontractor: {
      name: "Subcontractor One",
      projectId: 22,
      projectType: "Multiple",
    },
  }).success, false);
});

test("subcontractor link updates accept one project and one project type", () => {
  assert.equal(UpdateContractorSubcontractorLinkBody.safeParse({
    projectId: 22,
    projectType: "Design",
  }).success, true);
  assert.equal(UpdateContractorSubcontractorLinkBody.safeParse({
    projectId: 0,
    projectType: "Design",
  }).success, false);
  assert.equal(UpdateContractorSubcontractorLinkBody.safeParse({
    projectId: 22,
    projectType: "Multiple",
  }).success, false);
});

test("subcontractor details distinguish editable links from imported relationships", () => {
  const detail = {
    id: "22:41",
    linkId: null,
    projectId: 22,
    projectName: "Example project",
    projectNumber: "PA-1234567",
    projectType: "Design",
    subcontractorId: 41,
    subcontractorName: "Subcontractor One",
    lcpStatus: "Not checked",
    dirStatus: "Not checked",
    projectRegistrationBypass: false,
    projectRegistrationBypassStatus: "",
    projectPayrollFormsBypass: false,
    projectPayrollFormsBypassStatus: "",
    completionStatus: "Not checked",
  };

  assert.equal(UpdateContractorSubcontractorLinkResponse.safeParse(detail).success, true);
  assert.equal(UpdateContractorSubcontractorLinkResponse.safeParse({ ...detail, linkId: 17 }).success, true);
  assert.equal(UpdateContractorSubcontractorLinkResponse.safeParse({ ...detail, linkId: undefined }).success, false);
});

test("withholding release status requires a confirmed release date", () => {
  const unconfirmed = mapSqlWithholding({
    id: 4,
    amountWithheld: 100,
    releaseDate: null,
    releaseDateText: "text needs review",
  });
  const released = mapSqlWithholding({
    id: 5,
    amountWithheld: 200,
    releaseDate: new Date("2026-01-15T00:00:00Z"),
    releaseDateText: "",
  });

  assert.equal(unconfirmed.released, false);
  assert.equal(released.released, true);
  assert.equal(released.releaseDate, "2026-01-15");
});
