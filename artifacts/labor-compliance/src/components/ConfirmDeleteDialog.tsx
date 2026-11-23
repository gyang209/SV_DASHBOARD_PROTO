import { useEffect } from "react";
import { Trash2 } from "lucide-react";

export function ConfirmDeleteDialog({
  heading = "Delete this record?",
  recordTitle,
  description = "The record will move to Trash and can be restored for 30 days.",
  confirmLabel = "Move to Trash",
  pending = false,
  error,
  onCancel,
  onConfirm,
}: {
  heading?: string;
  recordTitle: string;
  description?: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, pending]);

  return (
    <div
      className="modal-backdrop confirm-delete-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <section
        className="modal confirm-delete-modal"
        role="alertdialog"
        data-testid="dialog-confirm-delete"
        aria-modal="true"
        aria-labelledby="confirm-delete-heading"
        aria-describedby="confirm-delete-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div className="confirm-delete-title">
            <span className="confirm-delete-icon"><Trash2 aria-hidden="true" /></span>
            <div>
              <h2 className="modal-title" id="confirm-delete-heading">{heading}</h2>
              <p className="confirm-delete-record" title={recordTitle}>{recordTitle}</p>
            </div>
          </div>
        </div>
        <div className="modal-body">
          <p className="confirm-delete-description" id="confirm-delete-description">{description}</p>
          {error && <div className="alert-message" role="alert">{error}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" data-testid="button-cancel-delete" autoFocus disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-trash" data-testid="button-confirm-delete" disabled={pending} onClick={onConfirm}>
            <Trash2 aria-hidden="true" /> {pending ? "Moving…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
