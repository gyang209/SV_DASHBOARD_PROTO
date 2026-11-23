import type { TrashRecord, TrashRecordType } from "@workspace/api-client-react";

export interface TrashFilters {
  search: string;
  recordType: TrashRecordType | "all";
  deletedFrom: string;
  deletedTo: string;
}

function localDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function searchText(record: TrashRecord, labels: Record<TrashRecordType, string>): string {
  let deletedAlternateNames = "";
  if (record.recordType === "contractor" && record.payloadJson) {
    try {
      const payload: unknown = JSON.parse(record.payloadJson);
      if (payload && typeof payload === "object" && "aliases" in payload) {
        const aliases = (payload as { aliases?: unknown }).aliases;
        if (typeof aliases === "string") deletedAlternateNames = aliases;
      }
    } catch {
      // Legacy or non-JSON payloads remain searchable as raw text below.
    }
  }

  return [
    record.title,
    record.recordId,
    labels[record.recordType],
    record.payloadJson ?? "",
    deletedAlternateNames,
    ...record.affectedRecords.flatMap((affected) => [
      affected.title,
      affected.recordId,
      labels[affected.recordType],
      affected.impact,
      affected.alternateNames ?? "",
    ]),
  ].join(" ").toLocaleLowerCase();
}

export function filterTrashRecords(
  records: readonly TrashRecord[],
  filters: TrashFilters,
  labels: Record<TrashRecordType, string>,
): TrashRecord[] {
  const term = filters.search.trim().toLocaleLowerCase();

  return records.filter((record) => {
    if (filters.recordType !== "all" && record.recordType !== filters.recordType) return false;
    if (term && !searchText(record, labels).includes(term)) return false;

    if (filters.deletedFrom || filters.deletedTo) {
      const deletedDate = localDate(record.deletedAt);
      if (!deletedDate) return false;
      if (filters.deletedFrom && deletedDate < filters.deletedFrom) return false;
      if (filters.deletedTo && deletedDate > filters.deletedTo) return false;
    }
    return true;
  });
}
