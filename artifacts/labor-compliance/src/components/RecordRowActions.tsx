import React from "react";
import { SlidersHorizontal, Trash2 } from "lucide-react";
import type { TrashRecordType } from "@workspace/api-client-react";

export type RecordRowActionsProps = {
  recordType: TrashRecordType;
  recordId: number;
  title: string;
  onEdit: () => void;
  onDelete: (recordType: TrashRecordType, id: number, title: string) => void;
  editTestId?: string;
  deleteTestId?: string;
  editLabel?: string;
  deleteLabel?: string;
  placement?: "left" | "right";
};

export function RecordRowActions({
  recordType,
  recordId,
  title,
  onEdit,
  onDelete,
  editTestId,
  deleteTestId,
  editLabel,
  deleteLabel,
  placement,
}: RecordRowActionsProps) {
  const placementSuffix = placement === "right" ? "-right" : "";
  return <div className="record-row-actions">
    <button
      type="button"
      className="table-action"
      aria-label={editLabel ?? `Edit ${title}`}
      title={editLabel ?? `Edit ${title}`}
      data-testid={`${editTestId ?? `button-edit-${recordType}-${recordId}`}${placementSuffix}`}
      onClick={onEdit}
    ><SlidersHorizontal aria-hidden="true" /></button>
    <button
      type="button"
      className="table-action table-delete-action"
      aria-label={deleteLabel ?? `Delete ${title}`}
      title={deleteLabel ?? `Delete ${title}`}
      data-testid={`${deleteTestId ?? `button-delete-${recordType}-${recordId}`}${placementSuffix}`}
      onClick={() => onDelete(recordType, recordId, title)}
    ><Trash2 aria-hidden="true" /></button>
  </div>;
}
