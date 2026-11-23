import assert from "node:assert/strict";
import test from "node:test";
import type { TrashRecord, TrashRecordType } from "@workspace/api-client-react";
import { filterTrashRecords } from "./trashFilters";

const labels: Record<TrashRecordType, string> = {
  project: "Project",
  contractor: "Contractor",
  withholding: "Withholding",
  restitution: "Restitution",
  subcontractorLink: "Subcontractor link",
  sourceRow: "Workbook row",
};

function record(overrides: Partial<TrashRecord> = {}): TrashRecord {
  return {
    id: 1,
    recordType: "contractor",
    recordId: "402",
    title: "Northstar Builders",
    payloadJson: null,
    deletedAt: "2026-04-15T12:00:00.000Z",
    expiresAt: "2026-05-15T12:00:00.000Z",
    deletedBy: null,
    affectedRecords: [{
      recordType: "project",
      recordId: "77",
      title: "Civic Center · PW-2026-04",
      impact: "The project remains active.",
    }],
    ...overrides,
  };
}

test("searches entry and connected-record names and numbers case-insensitively", () => {
  const records = [record(), record({
    id: 2,
    recordType: "project",
    title: "River Park",
    recordId: "88",
    affectedRecords: [],
  })];

  assert.deepEqual(filterTrashRecords(records, {
    search: "northstar", recordType: "all", deletedFrom: "", deletedTo: "",
  }, labels).map((item) => item.id), [1]);
  assert.deepEqual(filterTrashRecords(records, {
    search: "PW-2026-04", recordType: "all", deletedFrom: "", deletedTo: "",
  }, labels).map((item) => item.id), [1]);
  assert.deepEqual(filterTrashRecords(records, {
    search: "402", recordType: "all", deletedFrom: "", deletedTo: "",
  }, labels).map((item) => item.id), [1]);
});

test("searches deleted and connected contractors by saved alternate names", () => {
  const deletedContractor = record({
    payloadJson: JSON.stringify({ aliases: "Northstar Construction; NS Builders" }),
  });
  const connectedContractor = record({
    id: 2,
    recordType: "project",
    title: "River Park",
    recordId: "88",
    affectedRecords: [{
      recordType: "contractor",
      recordId: "403",
      title: "Harbor Electric",
      impact: "The contractor remains active.",
      alternateNames: "Harbor Power; H.E. Services",
    }],
  });
  const search = (records: TrashRecord[], term: string) => filterTrashRecords(records, {
    search: term, recordType: "all", deletedFrom: "", deletedTo: "",
  }, labels).map((item) => item.id);

  assert.deepEqual(search([deletedContractor], "ns builders"), [1]);
  assert.deepEqual(search([deletedContractor], "northstar construction"), [1]);
  assert.deepEqual(search([connectedContractor], "harbor power"), [2]);
  assert.deepEqual(search([connectedContractor], "h.e. services"), [2]);
});

test("filters by record type and inclusive local deletion dates", () => {
  const records = [
    record({ id: 1, deletedAt: new Date(2026, 3, 15, 12).toISOString() }),
    record({ id: 2, recordType: "project", deletedAt: new Date(2026, 3, 16, 12).toISOString() }),
    record({ id: 3, deletedAt: new Date(2026, 3, 17, 12).toISOString() }),
  ];

  assert.deepEqual(filterTrashRecords(records, {
    search: "", recordType: "project", deletedFrom: "", deletedTo: "",
  }, labels).map((item) => item.id), [2]);
  assert.deepEqual(filterTrashRecords(records, {
    search: "", recordType: "all", deletedFrom: "2026-04-15", deletedTo: "2026-04-16",
  }, labels).map((item) => item.id), [1, 2]);
});

test("does not mutate the 30-day result set when filters are cleared", () => {
  const records = [record()];
  const filtered = filterTrashRecords(records, {
    search: "", recordType: "all", deletedFrom: "", deletedTo: "",
  }, labels);

  assert.deepEqual(filtered, records);
  assert.notEqual(filtered, records);
});
