import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSqlRestitution, restitutionWriteValues } from "./restitutions";

test("restitution SQL mapping matches the worksheet fields and preserves links", () => {
  const record = mapSqlRestitution({
    Id: 41,
    ProjectId: 12,
    ProjectName: "Civic Center Improvements",
    ContractorId: 6,
    ContractorName: "Example Contractor",
    Status: "In progress",
    FirstEmailSentDate: new Date("2026-05-03T00:00:00.000Z"),
    ApprenticeName: "Apprentice Example",
    ApprenticeCraft: "Electrician",
    CprWeekEndingDate: "2026-04-25",
    UnsupervisedHoursDates: "2026-04-20, 2026-04-21",
    NumberOfUnsupervisedHours: "7.5",
    AmountOwed: "1250.50",
    PaidForRestitution: "No",
    CheckCopyProvided: 1,
    ProofOfDepositProvided: false,
    WageDifferenceCalculationsProvided: true,
    UploadedDocsInLcptracker: "Yes",
    ConfidentialNotesAddedToCpr: "Not checked",
    CprReviewAccepted: "No",
    Comments: "Second notice sent",
  });

  assert.deepEqual(record, {
    id: 41,
    projectId: 12,
    projectName: "Civic Center Improvements",
    contractorId: 6,
    contractorName: "Example Contractor",
    status: "In progress",
    firstEmailSentDate: "2026-05-03",
    apprenticeName: "Apprentice Example",
    apprenticeCraft: "Electrician",
    cprWeekEndingDate: "2026-04-25",
    unsupervisedHoursDates: "2026-04-20, 2026-04-21",
    numberOfUnsupervisedHours: 7.5,
    amountOwed: 1250.5,
    paidForRestitution: "No",
    checkCopyProvided: true,
    proofOfDepositProvided: false,
    wageDifferenceCalculationsProvided: true,
    uploadedDocsInLcptracker: "Yes",
    confidentialNotesAddedToCpr: "Not checked",
    cprReviewAccepted: "No",
    comments: "Second notice sent",
  });
});

test("restitution SQL mapping defaults unknown status to Open and keeps nullable links", () => {
  const record = mapSqlRestitution({
    Id: 42,
    Status: "Unexpected",
    ProjectId: null,
    ContractorId: null,
  });

  assert.equal(record.status, "Open");
  assert.equal(record.projectId, null);
  assert.equal(record.contractorId, null);
  assert.equal(record.amountOwed, 0);
  assert.equal(record.paidForRestitution, "Not checked");
  assert.equal(record.checkCopyProvided, false);
  assert.equal(record.proofOfDepositProvided, false);
});

test("restitution write mapping supplies safe defaults and uses selected record names", () => {
  const values = restitutionWriteValues(
    {
      amountOwed: 800,
      firstEmailSentDate: new Date("2026-01-10T00:00:00.000Z"),
      apprenticeName: "Worker A",
    },
    {
      projectId: 9,
      projectName: "Roadway Rehabilitation",
      contractorId: null,
      contractorName: "",
    },
  );

  assert.equal(values.projectName, "Roadway Rehabilitation");
  assert.equal(values.apprenticeName, "Worker A");
  assert.equal(values.amountOwed, 800);
  assert.equal(values.firstEmailSentDate instanceof Date, true);
  assert.equal(values.status, "Open");
  assert.equal(values.paidForRestitution, "Not checked");
  assert.equal(values.checkCopyProvided, false);
  assert.equal(values.comments, "");
});
