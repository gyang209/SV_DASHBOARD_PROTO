import assert from "node:assert/strict";
import test from "node:test";
import { sortRows } from "./sorting";

test("sorts text naturally without mutating the input", () => {
  const rows = [{ name: "Project 10" }, { name: "Project 2" }, { name: "Alpha" }];
  const result = sortRows(rows, "name:asc", { name: (row) => row.name });

  assert.deepEqual(result.map((row) => row.name), ["Alpha", "Project 2", "Project 10"]);
  assert.deepEqual(rows.map((row) => row.name), ["Project 10", "Project 2", "Alpha"]);
});

test("sorts numbers and dates and keeps empty values at the end", () => {
  const rows = [
    { amount: 100, due: "2026-03-10" },
    { amount: null, due: null },
    { amount: 20, due: "2026-02-01" },
  ];

  assert.deepEqual(
    sortRows(rows, "amount:desc", { amount: (row) => row.amount }).map((row) => row.amount),
    [100, 20, null],
  );
  assert.deepEqual(
    sortRows(rows, "due:asc", { due: (row) => row.due }).map((row) => row.due),
    ["2026-02-01", "2026-03-10", null],
  );
});
