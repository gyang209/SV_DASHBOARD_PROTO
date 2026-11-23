import assert from "node:assert/strict";
import test from "node:test";
import {
  hasConflictingActiveFederalSourceIdentity,
  getActiveFederalProjectDisplay,
  isFederalProjectName,
  joinActiveFederalRows,
  parseActiveFederalSourceRows,
  stripFederalProjectSuffix,
  type FederalProjectMatchRecord,
} from "./activeFederalProjects";

type TestProject = FederalProjectMatchRecord & { federalProject?: boolean };

function project(
  id: number,
  values: Partial<Omit<TestProject, "id">> = {},
): TestProject {
  return {
    id,
    projectName: `Project ${id}`,
    projectNumber: `PN-${id}`,
    projectKey: `KEY-${id}`,
    dirNumber: `DIR-${id}`,
    contractorName: `Contractor ${id}`,
    ...values,
  };
}

function source(id: number, cells: Record<string, { value?: string | null; formula?: string | null }>) {
  return { id, excelRow: id + 1, cells };
}

test("joins by project number, including the alternate project key", () => {
  const primary = project(1, { projectNumber: "AB-123" });
  const alternate = project(2, { projectNumber: "", projectKey: "KEY-2" });
  const rows = joinActiveFederalRows([
    source(1, { B2: { value: "ab 123" } }),
    source(2, { B3: { value: "key-2" } }),
  ], [primary, alternate], []);

  assert.deepEqual(rows.map((row) => row.project?.id), [1, 2]);
});

test("falls back to DIR number and then project name", () => {
  const dirMatch = project(1);
  const nameMatch = project(2);
  const rows = joinActiveFederalRows([
    source(1, { C2: { value: "dir-1" } }),
    source(2, { A3: { value: " project 2 " } }),
  ], [dirMatch, nameMatch], []);

  assert.deepEqual(rows.map((row) => row.project?.id), [1, 2]);
});

test("uses name and contractor to disambiguate duplicate identifier candidates", () => {
  const first = project(1, { projectNumber: "SHARED", projectName: "North Park", contractorName: "Acme" });
  const second = project(2, { projectNumber: "SHARED", projectName: "South Park", contractorName: "BuildCo" });
  const rows = joinActiveFederalRows([
    source(1, {
      A2: { value: "South Park" },
      B2: { value: "SHARED" },
      D2: { value: "BuildCo" },
    }),
    source(2, { B3: { value: "SHARED" } }),
  ], [first, second], []);

  assert.deepEqual(rows.map((row) => row.project?.id), [2, undefined]);
  assert.deepEqual(rows.map((row) => row.matchState), ["matched", "ambiguous"]);
});

test("new SQL project records link back to their matching worksheet row", () => {
  const sourceRow = source(7, {
    A8: { value: "Federal Site Preparation" },
    B8: { value: "PA2592" },
  });
  const created = project(88, {
    projectName: "Federal Site Preparation",
    projectNumber: "PA - 0002592",
  });

  const rows = joinActiveFederalRows([sourceRow], [created], []);

  assert.equal(rows[0].project?.id, created.id);
  assert.equal(rows[0].matchState, "matched");
});

test("source rows with conflicting details are held for review before linking", () => {
  const first = source(1, {
    A2: { value: "North Park" },
    B2: { value: "SHARED" },
    D2: { value: "Acme" },
  });
  const second = source(2, {
    A3: { value: "South Park" },
    B3: { value: "SHARED" },
    D3: { value: "BuildCo" },
  });

  assert.equal(hasConflictingActiveFederalSourceIdentity([first, second], first), true);
});

test("Active Federal display removes only a trailing Federal label", () => {
  assert.equal(
    stripFederalProjectSuffix("SCWP - Site Preparation Package (Federal)"),
    "SCWP - Site Preparation Package",
  );
  assert.equal(isFederalProjectName("SCWP - Site Preparation Package (Federal)"), true);
  assert.equal(isFederalProjectName("Project (Federal) Phase 2"), false);
  assert.equal(stripFederalProjectSuffix("Project (Federal) Phase 2"), "Project (Federal) Phase 2");
  assert.equal(stripFederalProjectSuffix("Project (Federal) (Federal)"), "Project");
});

test("Federal overview values use the same workbook-aware fields as the Federal page", () => {
  const row = joinActiveFederalRows([
    source(8, {
      A9: { value: "Workbook name (Federal)" },
      B9: { value: "PA 0002592" },
      C9: { value: "DIR-42" },
      D9: { value: "Workbook Contractor" },
    }),
  ], [project(8, { projectNumber: "PA 0002592" })], [project(8, { projectNumber: "PA 0002592" })])[0];

  assert.equal(row.project?.id, 8);
  assert.deepEqual(getActiveFederalProjectDisplay(row), {
    projectName: "Project 8",
    projectNumber: "PA - 0002592",
    dirNumber: "DIR-8",
    contractorName: "Contractor 8",
  });

  const sourceOnly = joinActiveFederalRows([
    source(9, {
      A10: { value: "Workbook name (Federal)" },
      B10: { value: "PA 0002592" },
      C10: { value: "DIR-42" },
      D10: { value: "Workbook Contractor" },
    }),
  ], [], [])[0];
  assert.deepEqual(getActiveFederalProjectDisplay(sourceOnly), {
    projectName: "Workbook name",
    projectNumber: "PA - 0002592",
    dirNumber: "DIR-42",
    contractorName: "Workbook Contractor",
  });
});

test("malformed or non-object worksheet JSON keeps the source row with empty cells", () => {
  const rows = parseActiveFederalSourceRows([
    { id: 1, excelRow: 2, cellsJson: "{" },
    { id: 2, excelRow: 3, cellsJson: "null" },
    { id: 3, excelRow: 4, cellsJson: "[]" },
    { id: 4, excelRow: 1, cellsJson: "{}" },
  ]);

  assert.deepEqual(rows.map(({ id, cells }) => ({ id, cells })), [
    { id: 1, cells: {} },
    { id: 2, cells: {} },
    { id: 3, cells: {} },
  ]);
});

test("keeps every unmatched Excel row once and appends SQL-only federal projects", () => {
  const linked = project(1);
  const federalOnly = project(2, { federalProject: true });
  const unmatched = source(10, { A11: { value: "No project record" } });
  const sourceRows = [source(9, { B10: { value: "PN-1" } }), unmatched];
  const rows = joinActiveFederalRows(sourceRows, [linked, federalOnly], [linked, federalOnly]);

  assert.deepEqual(rows.map((row) => row.key), ["excel-9", "excel-10", "project-2"]);
  assert.deepEqual(rows.map((row) => row.source?.id ?? null), [9, 10, null]);
  assert.deepEqual(rows.map((row) => row.project?.id ?? null), [1, null, 2]);
});

test("shows a linked federal project once when multiple source rows match it", () => {
  const linked = project(1, { projectNumber: "PA2592" });
  const rows = joinActiveFederalRows([
    source(10, { A11: { value: "Federal Site" }, B11: { value: "PA2592" } }),
    source(11, { A12: { value: "Federal Site" }, B12: { value: "PA2592" } }),
  ], [linked], [linked]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].project?.id, linked.id);
  assert.equal(rows[0].source?.id, 10);
});
