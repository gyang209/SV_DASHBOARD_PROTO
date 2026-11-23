export function incompleteSubcontractorsFirst<T extends { completionStatus: string }>(
  subcontractors: readonly T[],
): T[] {
  return [...subcontractors].sort(
    (left, right) =>
      Number(left.completionStatus === "Complete") -
      Number(right.completionStatus === "Complete"),
  );
}
