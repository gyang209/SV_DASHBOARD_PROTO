import assert from "node:assert/strict";
import test from "node:test";
import type { Contractor, Project } from "@workspace/api-client-react";
import { auditContractorRelationships, type WorkbookContractorRelationship } from "./contractorRelationshipAudit";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 10,
    projectKey: "PW-20-03",
    projectNumber: "PW-20-03",
    projectName: "Washington Community Swim Center",
    dirNumber: "123456",
    contractorId: 1,
    contractorName: "Prime Co",
    ...overrides,
  } as Project;
}

function contractor(overrides: Partial<Contractor> = {}): Contractor {
  return {
    id: 1,
    name: "Prime Co",
    aliases: "",
    sourceCount: 1,
    projectCount: 1,
    subcontractorCount: 1,
    subcontractors: [],
    ...overrides,
  } as Contractor;
}

function relationship(overrides: Partial<WorkbookContractorRelationship> = {}): WorkbookContractorRelationship {
  return {
    sourceSheet: "1. LCP & DIR - PAS CIP+DPW",
    sourceRow: 5,
    projectAnchorRow: 5,
    projectName: "Washington Community Swim Center",
    projectNumbers: ["PW-20-03"],
    role: "primary",
    contractorName: "Prime Co",
    sourceValue: "Prime Co",
    ...overrides,
  };
}

test("counts exact primary and subcontractor matches without changing source data", () => {
  const prime = contractor({
    subcontractorCount: 1,
    subcontractors: [{
      id: "10:2",
      linkId: 9,
      projectId: 10,
      projectName: "Washington Community Swim Center",
      projectNumber: "PW-20-03",
      projectType: "PAS CIP+DPW",
      subcontractorId: 2,
      subcontractorName: "Sub Co",
      lcpStatus: "Complete",
      dirStatus: "Complete",
      completionStatus: "Complete",
    }],
  });
  const sub = contractor({ id: 2, name: "Sub Co", subcontractors: [], projectCount: 0, subcontractorCount: 0 });
  const records = [
    relationship(),
    relationship({ sourceRow: 6, role: "subcontractor", contractorName: "Sub Co", sourceValue: "Sub Co" }),
  ];

  const result = auditContractorRelationships(records, [project()], [prime, sub]);

  assert.equal(result.inSyncCount, 2);
  assert.deepEqual(result.reviewRows, []);
});

test("places unmatched names and conflicting primary links in review", () => {
  const result = auditContractorRelationships([
    relationship({ contractorName: "Unknown Prime", sourceValue: "Unknown Prime" }),
    relationship({ sourceRow: 6, role: "primary", contractorName: "Other Co", sourceValue: "Other Co" }),
    relationship({ sourceRow: 7, role: "subcontractor", contractorName: "Sub Co", sourceValue: "Sub Co" }),
  ], [project()], [
    contractor(),
    contractor({ id: 2, name: "Sub Co", subcontractors: [], projectCount: 0, subcontractorCount: 0 }),
    contractor({ id: 3, name: "Other Co", subcontractors: [] }),
  ]);

  assert.equal(result.inSyncCount, 0);
  assert.equal(result.reviewRows.length, 4);
  assert.match(result.reviewRows[0].reason, /No exact app contractor/);
  assert.match(result.reviewRows[1].reason, /currently lists Prime Co as primary/);
  assert.match(result.reviewRows[2].reason, /does not have this subcontractor linked/);
  assert.equal(result.reviewRows[3].sourceRole, "App-only primary");
  assert.match(result.reviewRows[3].reason, /app lists this primary-contractor relationship/);
});

test("shows every contractor record when an alias makes the workbook name ambiguous", () => {
  const result = auditContractorRelationships(
    [relationship()],
    [project()],
    [
      contractor(),
      contractor({ id: 4, name: "Alternate Company Record", aliases: "Prime Co", subcontractors: [] }),
    ],
  );

  assert.equal(result.reviewRows.length, 1);
  assert.match(result.reviewRows[0].reason, /More than one app contractor/);
  assert.deepEqual(result.reviewRows[0].appContractorCandidates, [
    { id: 1, name: "Prime Co" },
    { id: 4, name: "Alternate Company Record" },
  ]);
});

test("groups duplicate source rows and keeps unclassified federal contractors for review", () => {
  const result = auditContractorRelationships([
    relationship({ sourceRow: 5 }),
    relationship({ sourceRow: 8 }),
    relationship({ sourceSheet: "Active Federal Projects", sourceRow: 16, role: "unclassified", contractorName: "Prime Co", sourceValue: "Prime Co" }),
  ], [project()], [contractor()]);

  assert.equal(result.inSyncCount, 1);
  assert.equal(result.reviewRows.length, 1);
  assert.deepEqual(result.reviewRows[0].sourceRows, [16]);
  assert.match(result.reviewRows[0].reason, /does not identify a prime\/sub role/);
});

test("lists app-only subcontractor links for review", () => {
  const prime = contractor({
    subcontractors: [{
      id: "10:2",
      linkId: 9,
      projectId: 10,
      projectName: "Washington Community Swim Center",
      projectNumber: "PW-20-03",
      projectType: "PAS CIP+DPW",
      subcontractorId: 2,
      subcontractorName: "Sub Co",
      lcpStatus: "Complete",
      dirStatus: "Complete",
      completionStatus: "Complete",
    }],
  });
  const result = auditContractorRelationships([relationship()], [project()], [
    prime,
    contractor({ id: 2, name: "Sub Co", subcontractors: [], projectCount: 0, subcontractorCount: 0 }),
  ]);

  assert.equal(result.inSyncCount, 1);
  assert.equal(result.reviewRows.length, 1);
  assert.equal(result.reviewRows[0].sourceRole, "App-only subcontractor");
  assert.match(result.reviewRows[0].reason, /no exact matching subcontractor entry/);
});

test("requires a review when a source project number matches but its name differs", () => {
  const result = auditContractorRelationships([
    relationship({ projectName: "A different project name" }),
  ], [project()], [contractor()]);

  assert.equal(result.inSyncCount, 0);
  assert.equal(result.reviewRows.length, 1);
  assert.match(result.reviewRows[0].reason, /project names differ/);
});
