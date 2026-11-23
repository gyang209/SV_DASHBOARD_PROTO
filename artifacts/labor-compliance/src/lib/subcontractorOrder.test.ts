import assert from "node:assert/strict";
import test from "node:test";
import { incompleteSubcontractorsFirst } from "./subcontractorOrder";

test("lists incomplete and unchecked subcontractors before completed ones", () => {
  const rows = [
    { name: "Completed B", completionStatus: "Complete" },
    { name: "Incomplete A", completionStatus: "Incomplete" },
    { name: "Unchecked", completionStatus: "Not checked" },
    { name: "Completed A", completionStatus: "Complete" },
  ];

  assert.deepEqual(
    incompleteSubcontractorsFirst(rows).map((row) => row.name),
    ["Incomplete A", "Unchecked", "Completed B", "Completed A"],
  );
  assert.deepEqual(rows.map((row) => row.name), [
    "Completed B",
    "Incomplete A",
    "Unchecked",
    "Completed A",
  ]);
});
