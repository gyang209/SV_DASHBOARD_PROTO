import assert from "node:assert/strict";
import { test } from "node:test";
import { readSubcontractorSourceStatus } from "./subcontractorSource";

test("subcontractor source status reads only LCP/DIR cells from its linked row", () => {
  const headers = JSON.stringify({
    A: { value: "Sub Contractor" },
    B: { value: "LCP" },
    C: { value: "DIR" },
    D: { value: "Completion Status" },
  });
  const source = JSON.stringify({
    A: { value: "Subcontractor One" },
    B: { value: "2026-01-12" },
    C: { value: "2026-01-19" },
    D: { value: "Complete" },
  });

  assert.deepEqual(readSubcontractorSourceStatus(headers, source), {
    lcpStatus: "2026-01-12",
    dirStatus: "2026-01-19",
    completionStatus: "Complete",
  });
});

test("subcontractor source status does not inherit project statuses when cells are absent", () => {
  const headers = JSON.stringify({
    A: { value: "Project" },
    B: { value: "Sub Contractor" },
    C: { value: "LCP" },
    D: { value: "DIR" },
  });
  const source = JSON.stringify({
    A: { value: "Project A" },
    B: { value: "Subcontractor One" },
    C: { value: "" },
    D: { value: "" },
  });

  assert.deepEqual(readSubcontractorSourceStatus(headers, source), {
    lcpStatus: "Not checked",
    dirStatus: "Not checked",
    completionStatus: "Not checked",
  });
});

test("subcontractor source status marks partial source data incomplete", () => {
  const headers = JSON.stringify({ A: { value: "LCP" }, B: { value: "DIR" } });
  const source = JSON.stringify({ A: { value: "2026-01-12" }, B: { value: "" } });

  assert.deepEqual(readSubcontractorSourceStatus(headers, source), {
    lcpStatus: "2026-01-12",
    dirStatus: "Not checked",
    completionStatus: "Incomplete",
  });
});

test("subcontractor source does not call pending values complete and formats Excel date cells", () => {
  const headers = JSON.stringify({ A: { value: "LCP status" }, B: { value: "DIR date" } });
  const source = JSON.stringify({
    A: { value: "Pending" },
    B: { value: 46034, type: "date" },
  });

  assert.deepEqual(readSubcontractorSourceStatus(headers, source), {
    lcpStatus: "Pending",
    dirStatus: "2026-01-12",
    completionStatus: "Incomplete",
  });
});
