import assert from "node:assert/strict";
import test from "node:test";
import { coerceFields, formatProjectNumberForDisplay, isValidDirNumber } from "./projectForm";

test("DIR numbers accept exactly six or eleven digits", () => {
  assert.equal(isValidDirNumber("123456"), true);
  assert.equal(isValidDirNumber("12345678901"), true);
  assert.equal(isValidDirNumber(""), true);
  assert.equal(isValidDirNumber("12345"), false);
  assert.equal(isValidDirNumber("1234567"), false);
  assert.equal(isValidDirNumber("123456789012"), false);
});

test("Active Federal DIR number coercion preserves six digits", () => {
  const payload = coerceFields({ dirNumber: "123456" }, [
    { key: "dirNumber", type: "dirNumberEither" },
  ]);
  assert.deepEqual(payload, { dirNumber: "123456" });
});

test("project edit form submits directory dates, statuses, and PWC-100 dates", () => {
  const values = {
    projectInitiationDate: "2025-02-03",
    projectFinishDate: "2025-11-30",
    registrationStatus: "Yes",
    registrationCheckedOn: "2025-03-12",
    payrollFormsStatus: "No",
    payrollFormsCheckedOn: "",
    pwc100: true,
    pwc100RegisteredDate: "2025-04-05",
    pwc100ExpirationDate: "2026-04-05",
  };

  const payload = coerceFields(values, [
    { key: "registrationStatus", type: "lcpStatus" },
    { key: "payrollFormsStatus", type: "dirStatus" },
    { key: "projectInitiationDate", type: "date" },
    { key: "projectFinishDate", type: "date" },
    { key: "pwc100", type: "pwc100" },
  ]);

  assert.deepEqual(payload, {
    registrationStatus: "Registered",
    registrationCheckedOn: "2025-03-12",
    payrollFormsStatus: "Missing",
    payrollFormsCheckedOn: null,
    projectInitiationDate: "2025-02-03",
    projectFinishDate: "2025-11-30",
    pwc100: true,
    pwc100RegisteredDate: "2025-04-05",
    pwc100ExpirationDate: "2026-04-05",
  });
});

test("project number form preserves leading zeros in seven-digit codes", () => {
  const payload = coerceFields(
    {
      projectCodeType: "PA",
      projectNumberSingle: "0002592",
      projectNumber: "PA0002592",
    },
    [{ key: "projectNumber", type: "projectCode" }],
  );

  assert.equal(payload.projectNumber, "PA - 0002592");
});

test("existing project numbers display in the standard project-code format", () => {
  assert.equal(formatProjectNumberForDisplay("PA2592"), "PA - 0002592");
  assert.equal(formatProjectNumberForDisplay("TR1234"), "TR - 12 - 34");
  assert.equal(formatProjectNumberForDisplay("ST-2-3"), "ST - 02 - 03");
  assert.equal(formatProjectNumberForDisplay("legacy-42"), "legacy-42");
});

test("clearing the PWC-100 toggle clears both dates from the update payload", () => {
  const payload = coerceFields(
    {
      pwc100: false,
      pwc100RegisteredDate: "2025-04-05",
      pwc100ExpirationDate: "2026-04-05",
    },
    [{ key: "pwc100", type: "pwc100" }],
  );

  assert.deepEqual(payload, {
    pwc100: false,
    pwc100RegisteredDate: null,
    pwc100ExpirationDate: null,
  });
});

test("federal project edits preserve displayed compliance dates when statuses are No", () => {
  const payload = coerceFields(
    {
      registrationStatus: "No",
      registrationCheckedOn: "2025-03-12",
      payrollFormsStatus: "No",
      payrollFormsCheckedOn: "2025-03-13",
      pwc100: false,
      pwc100RegisteredDate: "2025-04-05",
      pwc100ExpirationDate: "2026-04-05",
    },
    [
      { key: "registrationStatus", type: "lcpStatus", keepStatusDate: true },
      { key: "payrollFormsStatus", type: "dirStatus", keepStatusDate: true },
      { key: "pwc100", type: "pwc100", keepPwcDates: true },
    ],
  );

  assert.deepEqual(payload, {
    registrationStatus: "Missing",
    registrationCheckedOn: "2025-03-12",
    payrollFormsStatus: "Missing",
    payrollFormsCheckedOn: "2025-03-13",
    pwc100: false,
    pwc100RegisteredDate: "2025-04-05",
    pwc100ExpirationDate: "2026-04-05",
  });
});

test("federal project edits keep each form status independent", () => {
  const payload = coerceFields(
    {
      formsStatus: "Projects with missing forms",
      form1Status: "Complete",
      form2Status: "Missing",
      form3Status: "Not checked",
      form4Status: "Not tracked",
    },
    [
      { key: "formsStatus" },
      { key: "form1Status", type: "formStatus" },
      { key: "form2Status", type: "formStatus" },
      { key: "form3Status", type: "formStatus" },
      { key: "form4Status", type: "formStatus" },
    ],
  );

  assert.deepEqual(payload, {
    formsStatus: "Projects with missing forms",
    form1Status: "Complete",
    form2Status: "Missing",
    form3Status: "Not checked",
    form4Status: "Not tracked",
  });
});

test("Active Federal form fields preserve their worksheet-matched values", () => {
  const payload = coerceFields(
    {
      projectName: "Federal Projects as of 1/10/2024",
      projectNumber: "ST-12-34",
      dirNumber: "12345678901",
      contractorId: "42",
      federalProjectNumber: "FP-2030",
      davisBaconDetermination: "WA20260001 · Mod 2",
      federalSetupInLcp: "Yes",
      federalNotes: "Verify wage determination",
      federalActive: "Active",
    },
    [
      { key: "projectName" },
      { key: "projectNumber" },
      { key: "dirNumber" },
      { key: "contractorId", type: "contractor" },
      { key: "federalProjectNumber" },
      { key: "davisBaconDetermination" },
      { key: "federalSetupInLcp" },
      { key: "federalNotes" },
      { key: "federalActive" },
    ],
  );

  assert.deepEqual(payload, {
    projectName: "Federal Projects as of 1/10/2024",
    projectNumber: "ST-12-34",
    dirNumber: "12345678901",
    contractorId: 42,
    federalProjectNumber: "FP-2030",
    davisBaconDetermination: "WA20260001 · Mod 2",
    federalSetupInLcp: "Yes",
    federalNotes: "Verify wage determination",
    federalActive: "Active",
  });
});

test("Project Type selections remain independent across pages", () => {
  const payload = coerceFields(
    {
      federalProject: true,
      designProject: true,
      onCall: false,
      pasCipDpw: true,
    },
    [{ key: "projectFlags", type: "projectFlags" }],
  );

  assert.deepEqual(payload, {
    federalProject: true,
    designProject: true,
    onCall: false,
    pasCipDpw: true,
  });
});

test("full project editor preserves shared Design, Federal, and On Call fields", () => {
  const payload = coerceFields(
    {
      projectName: "Multidiscipline project",
      federalProject: true,
      designProject: true,
      onCall: true,
      pasCipDpw: false,
      designProjectManager: "Jordan Lee",
      designProjectManagerEmail: "jordan@example.org",
      designWeekStart: "2026-11-02",
      designWeekEnd: "2026-11-08",
      designPwcrExpirationDate: "2026-12-31",
      primeApprover: "Taylor Smith",
      federalProjectNumber: "FP-2040",
      formsStatus: "Projects with all forms",
      form1Status: "Complete",
      form2Status: "Missing",
    },
    [
      { key: "projectName" },
      { key: "projectFlags", type: "projectFlags" },
      { key: "designProjectManager" },
      { key: "designProjectManagerEmail", type: "email" },
      { key: "designWeekStart", type: "date" },
      { key: "designWeekEnd", type: "date" },
      { key: "designPwcrExpirationDate", type: "date" },
      { key: "primeApprover" },
      { key: "federalProjectNumber" },
      { key: "formsStatus" },
      { key: "form1Status", type: "formStatus" },
      { key: "form2Status", type: "formStatus" },
    ],
  );

  assert.deepEqual(payload, {
    projectName: "Multidiscipline project",
    federalProject: true,
    designProject: true,
    onCall: true,
    pasCipDpw: false,
    designProjectManager: "Jordan Lee",
    designProjectManagerEmail: "jordan@example.org",
    designWeekStart: "2026-11-02",
    designWeekEnd: "2026-11-08",
    designPwcrExpirationDate: "2026-12-31",
    primeApprover: "Taylor Smith",
    federalProjectNumber: "FP-2040",
    formsStatus: "Projects with all forms",
    form1Status: "Complete",
    form2Status: "Missing",
  });
});
