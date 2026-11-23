import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";

type PopoverPosition = {
  top: number;
  left: number;
  right: number;
  maxHeight: number;
};

export function CommentsPopover({
  projectId,
  projectName,
  comments,
}: {
  projectId: number;
  projectName: string;
  comments?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const titleId = `project-comments-title-${projectId}`;
  const popoverId = `project-comments-${projectId}`;
  const savedComments = comments?.trim();

  const updatePosition = () => {
    const button = buttonRef.current;
    const cell = button?.closest("td");
    const row = cell?.parentElement;
    const tableBody = row?.parentElement;
    if (!button || !(cell instanceof HTMLTableCellElement) || !(row instanceof HTMLTableRowElement)) return;

    const buttonBounds = button.getBoundingClientRect();
    const firstCoveredCell = row.cells[Math.max(0, cell.cellIndex - 3)];
    const left = Math.max(8, firstCoveredCell?.getBoundingClientRect().left ?? buttonBounds.left);
    const right = Math.max(0, window.innerWidth - buttonBounds.right);
    const rows = tableBody instanceof HTMLTableSectionElement ? Array.from(tableBody.rows) : [];
    const rowIndex = rows.indexOf(row);
    const twoRecordsHeight = rows
      .slice(rowIndex + 1, rowIndex + 3)
      .reduce((height, nextRow) => height + nextRow.getBoundingClientRect().height, 0);
    const top = Math.min(buttonBounds.bottom + 4, window.innerHeight - 8);

    setPosition({
      top,
      left,
      right,
      maxHeight: Math.max(1, Math.min(
        twoRecordsHeight || 160,
        window.innerHeight - top - 8,
      )),
    });
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div className="comments-preview" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`comments-preview-trigger ${savedComments ? "has-comments" : "no-comments"}`}
        aria-label={`View comments for ${projectName}`}
        aria-controls={popoverId}
        aria-expanded={open}
        title="View comments"
        data-testid={`button-project-comments-${projectId}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          updatePosition();
          setOpen(true);
        }}
      >
        <MessageSquare aria-hidden="true" />
      </button>
      {open && position && (
        <div
          id={popoverId}
          className="comments-preview-tooltip"
          role="region"
          aria-labelledby={titleId}
          style={position}
        >
          <div id={titleId} className="comments-preview-title">Comments</div>
          <div className="comments-preview-body">{savedComments || "No comments available"}</div>
        </div>
      )}
    </div>
  );
}
