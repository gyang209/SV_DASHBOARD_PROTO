export type SortOption = {
  value: string;
  label: string;
};

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);

  const leftText = String(left);
  const rightText = String(right);
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value);
  if (isDate(leftText) && isDate(rightText)) {
    const leftDate = Date.parse(leftText);
    const rightDate = Date.parse(rightText);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  }
  return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
}

export function sortRows<T>(
  rows: readonly T[],
  sortBy: string,
  accessors: Record<string, (row: T) => unknown>,
): T[] {
  const separator = sortBy.lastIndexOf(":");
  const key = separator < 0 ? sortBy : sortBy.slice(0, separator);
  const descending = separator >= 0 && sortBy.slice(separator + 1) === "desc";
  const accessor = accessors[key];
  if (!accessor) return [...rows];

  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((left, right) => {
      const leftEmpty = isEmpty(left.value);
      const rightEmpty = isEmpty(right.value);
      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      const comparison = compareValues(left.value, right.value);
      if (comparison) return descending ? -comparison : comparison;
      return left.index - right.index;
    })
    .map(({ row }) => row);
}
