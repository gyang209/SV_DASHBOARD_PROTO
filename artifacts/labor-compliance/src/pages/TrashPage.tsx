import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock3, RotateCcw, Search, Trash2 } from "lucide-react";
import { RowNumberedTable } from "@/components/RowNumberedTable";
import {
  useGetTrash,
  useGetTrashAudit,
  useRestoreTrashRecord,
  type TrashAuditEvent,
  type TrashRecord,
  type TrashRecordType,
} from "@workspace/api-client-react";
import { filterTrashRecords } from "@/lib/trashFilters";

const recordTypeLabels: Record<TrashRecordType, string> = {
  project: "Project",
  contractor: "Contractor",
  withholding: "Withholding",
  restitution: "Restitution",
  subcontractorLink: "Subcontractor link",
  sourceRow: "Workbook row",
};

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "The Trash request failed. Please retry.";
}

function daysRemaining(expiresAt: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function actorLabel(actorId: string | null | undefined): string {
  if (!actorId) return "Not recorded";
  if (actorId === "shared-staff-access") return "Shared staff access";
  return `Staff account · ${actorId}`;
}

function formatTimestamp(value: string | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function describeAction(action: TrashAuditEvent["action"]): string {
  return action === "deleted" ? "Moved to Trash" : "Restored";
}

export function TrashPage() {
  const queryClient = useQueryClient();
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(() => new Set());
  const [search, setSearch] = useState("");
  const [recordType, setRecordType] = useState<TrashRecordType | "all">("all");
  const [deletedFrom, setDeletedFrom] = useState("");
  const [deletedTo, setDeletedTo] = useState("");
  const query = useGetTrash({ query: { retry: false, refetchInterval: 60_000 } });
  const auditQuery = useGetTrashAudit({ query: { retry: false, refetchInterval: 60_000 } });
  const restore = useRestoreTrashRecord();
  const records = query.data ?? [];
  const auditEvents = auditQuery.data ?? [];
  const filteredRecords = useMemo(
    () => filterTrashRecords(records, { search, recordType, deletedFrom, deletedTo }, recordTypeLabels),
    [records, search, recordType, deletedFrom, deletedTo],
  );
  const hasFilters = Boolean(search.trim() || recordType !== "all" || deletedFrom || deletedTo);

  return <div className="trash-page" data-testid="page-trash">
    <div className="page-heading">
      <div>
        <div className="eyebrow">Recover deleted entries</div>
        <h1>Trash</h1>
        <p className="subheading">Deleted entries can be restored for 30 days. After that, their original data remains hidden, while the activity history below is retained.</p>
      </div>
      <span className="panel-kicker">{records.length} recoverable {records.length === 1 ? "entry" : "entries"}</span>
    </div>

    {query.isLoading && <div className="panel loading-state">Loading Trash…</div>}
    {query.isError && <div className="error-state" role="alert">
      <strong>Trash is unavailable.</strong>
      <p>{errorMessage(query.error)}</p>
      <button type="button" className="btn" onClick={() => void query.refetch()}>Retry</button>
    </div>}
    {auditQuery.isError && <div className="alert-message" role="alert">
      Trash activity is unavailable. {errorMessage(auditQuery.error)}
      <button type="button" className="btn" onClick={() => void auditQuery.refetch()}>Retry</button>
    </div>}
    {restore.isError && <div className="alert-message" role="alert">{errorMessage(restore.error)}</div>}

    {!query.isLoading && !query.isError && !records.length && <div className="panel empty-state">
      <div className="empty-mark"><Trash2 /></div>
      <strong>Trash is empty</strong>
      <p>Deleted entries will appear here for recovery.</p>
    </div>}

    {!query.isLoading && !query.isError && records.length > 0 && <>
      <section className="panel trash-filter-panel" aria-label="Search and filter Trash">
        <label className="trash-search">
          <Search aria-hidden="true" />
          <input
            className="field"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search entries, projects, contractors, or numbers…"
            aria-label="Search Trash"
            data-testid="input-search-trash"
          />
        </label>
        <label className="trash-filter">
          <span>Record type</span>
          <select
            className="field select-field"
            value={recordType}
            onChange={(event) => setRecordType(event.target.value as TrashRecordType | "all")}
            aria-label="Filter Trash by record type"
            data-testid="select-filter-trash-type"
          >
            <option value="all">All record types</option>
            {Object.entries(recordTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="trash-date-filter">
          <span>Deleted from</span>
          <input
            className="field"
            type="date"
            value={deletedFrom}
            onChange={(event) => setDeletedFrom(event.target.value)}
            aria-label="Deleted from date"
            data-testid="input-trash-deleted-from"
          />
        </label>
        <label className="trash-date-filter">
          <span>Deleted to</span>
          <input
            className="field"
            type="date"
            value={deletedTo}
            onChange={(event) => setDeletedTo(event.target.value)}
            aria-label="Deleted to date"
            data-testid="input-trash-deleted-to"
          />
        </label>
        {hasFilters && <button
          type="button"
          className="btn trash-clear-filters"
          onClick={() => {
            setSearch("");
            setRecordType("all");
            setDeletedFrom("");
            setDeletedTo("");
          }}
          data-testid="button-clear-trash-filters"
        >Clear filters</button>}
        <span className="panel-kicker trash-result-count" data-testid="text-trash-result-count">
          {filteredRecords.length} of {records.length} entries
        </span>
      </section>

    {filteredRecords.length === 0
      ? <div className="panel empty-state trash-filter-empty" data-testid="empty-trash-results">
        <strong>No Trash entries match</strong>
        <p>Try a different search or adjust the filters.</p>
      </div>
      : <section className="panel table-wrap trash-table-wrap">
      <RowNumberedTable className="data-table" data-testid="table-trash">
        <thead><tr><th>Entry</th><th>Record type</th><th>Deleted</th><th>Deleted by</th><th>Recovery ends</th><th /></tr></thead>
        <tbody>{filteredRecords.map((record: TrashRecord) => {
          const expiresAt = new Date(record.expiresAt);
          const expanded = expandedRecords.has(record.id);
          const affectedRecordsId = `trash-affected-records-${record.id}`;
          return <Fragment key={record.id}>
            <tr data-testid={`row-trash-${record.id}`}>
              <td>
                <div className="trash-entry-cell">
                  <span className="table-primary">{record.title}</span>
                  <button
                    type="button"
                    className="trash-affected-toggle"
                    aria-expanded={expanded}
                    aria-controls={affectedRecordsId}
                    data-testid={`button-view-affected-${record.id}`}
                    onClick={() => setExpandedRecords((current) => {
                      const next = new Set(current);
                      if (next.has(record.id)) next.delete(record.id);
                      else next.add(record.id);
                      return next;
                    })}
                  >
                    <ChevronDown aria-hidden="true" className={expanded ? "is-expanded" : ""} />
                    View affected records
                  </button>
                </div>
              </td>
              <td>{recordTypeLabels[record.recordType]}</td>
              <td>{formatTimestamp(record.deletedAt)}</td>
              <td title={record.deletedBy ?? undefined}>{actorLabel(record.deletedBy)}</td>
              <td><span className="trash-expiry"><Clock3 aria-hidden="true" /> {daysRemaining(expiresAt)} days left</span></td>
              <td><button
                type="button"
                className="btn"
                data-testid={`button-restore-trash-${record.id}`}
                disabled={restore.isPending}
                onClick={() => {
                  restore.reset();
                  restore.mutate({ id: record.id }, {
                    onSuccess: () => { void queryClient.invalidateQueries(); },
                  });
                }}
              ><RotateCcw aria-hidden="true" /> Restore</button></td>
            </tr>
            <tr
              className="trash-affected-row"
              data-testid={`row-affected-${record.id}`}
              hidden={!expanded}
            >
              <td colSpan={6}>
                <div
                  id={affectedRecordsId}
                  className="trash-affected-panel"
                  role="region"
                  aria-label={`Records affected by ${record.title}`}
                >
                  <strong>Records connected to this entry</strong>
                  {record.affectedRecords.length > 0
                    ? <ul className="trash-affected-list">
                      {record.affectedRecords.map((affected, index) => (
                        <li key={`${affected.recordType}:${affected.recordId}:${index}`}>
                          <div className="trash-affected-description">
                            <strong>{recordTypeLabels[affected.recordType]} · {affected.title}</strong>
                            <span>{affected.impact}</span>
                          </div>
                          <span className="trash-affected-id">ID {affected.recordId}</span>
                        </li>
                      ))}
                    </ul>
                    : <p className="trash-affected-empty">No connected records were affected.</p>}
                </div>
              </td>
            </tr>
          </Fragment>;
        })}</tbody>
      </RowNumberedTable>
    </section>}
    </>}

    <section className="panel table-wrap trash-table-wrap" aria-labelledby="trash-activity-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Accountability</div>
          <h2 id="trash-activity-heading">Recent activity</h2>
        </div>
      </div>
      {auditQuery.isLoading && <div className="loading-state">Loading activity…</div>}
      {!auditQuery.isLoading && !auditQuery.isError && auditEvents.length === 0 && (
        <div className="empty-state"><p>No delete or restore activity has been recorded yet.</p></div>
      )}
      {!auditQuery.isLoading && !auditQuery.isError && auditEvents.length > 0 && (
        <RowNumberedTable className="data-table" data-testid="table-trash-audit">
          <thead><tr><th>Action</th><th>Entry</th><th>Record type</th><th>Staff identity</th><th>Time</th></tr></thead>
          <tbody>{auditEvents.map((event) => (
            <tr key={event.id} data-testid={`row-trash-audit-${event.id}`}>
              <td>{describeAction(event.action)}</td>
              <td className="table-primary">{event.title}</td>
              <td>{recordTypeLabels[event.recordType]}</td>
              <td title={event.actorId}>{actorLabel(event.actorId)}</td>
              <td>{formatTimestamp(event.occurredAt)}</td>
            </tr>
          ))}</tbody>
        </RowNumberedTable>
      )}
    </section>
  </div>;
}
