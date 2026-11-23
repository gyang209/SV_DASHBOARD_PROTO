import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form } from "@/components/ui/form";
import { RowNumberedTable } from "@/components/RowNumberedTable";
import { ContractorSelectWithAdd } from "@/components/ContractorSelectWithAdd";
import {
  useCreateRestitution,
  useGetRestitutions,
  useUpdateRestitution,
} from "@workspace/api-client-react";
import type {
  Contractor,
  Project,
  Restitution,
  RestitutionInput,
} from "@workspace/api-client-react";
import { SortByControl } from "@/components/SortByControl";
import { RecordRowActions } from "@/components/RecordRowActions";
import { RequiredFieldLabel, RequiredFieldsNote } from "@/components/RequiredFieldLabel";
import { sortRows } from "@/lib/sorting";

const statuses = ["Open", "Notice sent", "In progress", "Paid", "Disputed", "Closed"] as const;
const triStateOptions = ["Not checked", "Yes", "No"] as const;
type StatusFilter = "All statuses" | (typeof statuses)[number];
const restitutionDraftSchema = z.object({
  projectId: z.string(),
  contractorId: z.string(),
  status: z.enum(statuses),
  firstEmailSentDate: z.string(),
  apprenticeName: z.string(),
  apprenticeCraft: z.string(),
  cprWeekEndingDate: z.string(),
  unsupervisedHoursDates: z.string(),
  numberOfUnsupervisedHours: z.string().refine(
    (value) => !value.trim() || (Number.isFinite(Number(value)) && Number(value) >= 0),
    "Enter a non-negative number of hours.",
  ),
  amountOwed: z.string().refine(
    (value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0,
    "Enter an amount of zero or more.",
  ),
  paidForRestitution: z.enum(triStateOptions),
  checkCopyProvided: z.boolean(),
  proofOfDepositProvided: z.boolean(),
  wageDifferenceCalculationsProvided: z.boolean(),
  uploadedDocsInLcptracker: z.enum(triStateOptions),
  confidentialNotesAddedToCpr: z.enum(triStateOptions),
  cprReviewAccepted: z.enum(triStateOptions),
  comments: z.string(),
});
type RestitutionDraft = z.infer<typeof restitutionDraftSchema>;

function emptyDraft(): RestitutionDraft {
  return {
    projectId: "",
    contractorId: "",
    status: "Open",
    firstEmailSentDate: "",
    apprenticeName: "",
    apprenticeCraft: "",
    cprWeekEndingDate: "",
    unsupervisedHoursDates: "",
    numberOfUnsupervisedHours: "",
    amountOwed: "",
    paidForRestitution: "Not checked",
    checkCopyProvided: false,
    proofOfDepositProvided: false,
    wageDifferenceCalculationsProvided: false,
    uploadedDocsInLcptracker: "Not checked",
    confidentialNotesAddedToCpr: "Not checked",
    cprReviewAccepted: "Not checked",
    comments: "",
  };
}

function draftFromRecord(record?: Restitution): RestitutionDraft {
  if (!record) return emptyDraft();
  return {
    projectId: record.projectId === null ? "" : String(record.projectId),
    contractorId: record.contractorId === null ? "" : String(record.contractorId),
    status: record.status,
    firstEmailSentDate: record.firstEmailSentDate?.slice(0, 10) ?? "",
    apprenticeName: record.apprenticeName,
    apprenticeCraft: record.apprenticeCraft,
    cprWeekEndingDate: record.cprWeekEndingDate?.slice(0, 10) ?? "",
    unsupervisedHoursDates: record.unsupervisedHoursDates,
    numberOfUnsupervisedHours: record.numberOfUnsupervisedHours === null
      ? ""
      : String(record.numberOfUnsupervisedHours),
    amountOwed: String(record.amountOwed),
    paidForRestitution: record.paidForRestitution,
    checkCopyProvided: record.checkCopyProvided,
    proofOfDepositProvided: record.proofOfDepositProvided,
    wageDifferenceCalculationsProvided: record.wageDifferenceCalculationsProvided,
    uploadedDocsInLcptracker: record.uploadedDocsInLcptracker,
    confidentialNotesAddedToCpr: record.confidentialNotesAddedToCpr,
    cprReviewAccepted: record.cprReviewAccepted,
    comments: record.comments,
  };
}

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const data = "data" in error ? error.data : null;
    if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
      return data.error;
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function dateLabel(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusTone(status: string): string {
  if (status === "Paid" || status === "Closed") return "status-done";
  if (status === "Open" || status === "Disputed") return "status-missing";
  if (status === "In progress" || status === "Notice sent") return "status-progress";
  return "status-neutral";
}

function projectLabel(project: Project): string {
  const name = project.projectName.trim();
  return name || project.projectNumber || `Project ${project.id}`;
}

function RestitutionForm({
  record,
  projects,
  contractors,
  saving,
  error,
  onClose,
  onSubmit,
  onCreatePrimaryContractor,
}: {
  record?: Restitution;
  projects: Project[];
  contractors: Contractor[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (data: RestitutionInput) => void;
  onCreatePrimaryContractor: (name: string) => Promise<Contractor>;
}) {
  const form = useForm<RestitutionDraft>({
    resolver: zodResolver(restitutionDraftSchema),
    defaultValues: draftFromRecord(record),
  });

  const submit = form.handleSubmit((draft) => {
    onSubmit({
      projectId: draft.projectId ? Number(draft.projectId) : null,
      contractorId: draft.contractorId ? Number(draft.contractorId) : null,
      status: draft.status,
      firstEmailSentDate: draft.firstEmailSentDate || null,
      apprenticeName: draft.apprenticeName.trim(),
      apprenticeCraft: draft.apprenticeCraft.trim(),
      cprWeekEndingDate: draft.cprWeekEndingDate || null,
      unsupervisedHoursDates: draft.unsupervisedHoursDates.trim(),
      numberOfUnsupervisedHours: draft.numberOfUnsupervisedHours.trim()
        ? Number(draft.numberOfUnsupervisedHours)
        : null,
      amountOwed: Number(draft.amountOwed),
      paidForRestitution: draft.paidForRestitution,
      checkCopyProvided: draft.checkCopyProvided,
      proofOfDepositProvided: draft.proofOfDepositProvided,
      wageDifferenceCalculationsProvided: draft.wageDifferenceCalculationsProvided,
      uploadedDocsInLcptracker: draft.uploadedDocsInLcptracker,
      confidentialNotesAddedToCpr: draft.confidentialNotesAddedToCpr,
      cprReviewAccepted: draft.cprReviewAccepted,
      comments: draft.comments.trim(),
    });
  });

  const field = (
    key: keyof RestitutionDraft,
    label: string,
    type = "text",
    required = false,
    full = false,
  ) => (
    <div className={`form-field ${full ? "full" : ""} ${required ? "required-entry" : ""}`} key={key}>
      {required ? <RequiredFieldLabel htmlFor={`restitution-${key}`}>{label}</RequiredFieldLabel> : <label htmlFor={`restitution-${key}`}>{label}</label>}
      <input
        className="field"
        id={`restitution-${key}`}
        data-testid={`input-restitution-${key}`}
        type={type}
        required={required}
        min={type === "number" ? "0" : undefined}
        step={key === "numberOfUnsupervisedHours" ? "0.01" : type === "number" ? "0.01" : undefined}
        {...form.register(key)}
      />
      {form.formState.errors[key] && <div className="field-error">{form.formState.errors[key]?.message}</div>}
    </div>
  );

  const triStateField = (
    key: "paidForRestitution" | "uploadedDocsInLcptracker" | "confidentialNotesAddedToCpr" | "cprReviewAccepted",
    label: string,
  ) => (
    <div className="form-field" key={key}>
      <label htmlFor={`restitution-${key}`}>{label}</label>
      <select
        className="field"
        id={`restitution-${key}`}
        data-testid={`select-restitution-${key}`}
        {...form.register(key)}
      >
        {triStateOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );

  const documentChecks: {
    key: "checkCopyProvided" | "proofOfDepositProvided" | "wageDifferenceCalculationsProvided";
    label: string;
  }[] = [
    { key: "checkCopyProvided", label: "Copy of check" },
    { key: "proofOfDepositProvided", label: "Proof of deposit" },
    { key: "wageDifferenceCalculationsProvided", label: "Wage-difference calculations paid" },
  ];

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <Form {...form}>
        <form className="modal restitution-modal" onSubmit={submit} aria-labelledby="restitution-form-title">
          <div className="modal-head">
            <div>
              <div className="eyebrow">SQL Server record</div>
              <h2 className="modal-title" id="restitution-form-title">
                {record ? "Edit restitution record" : "Add restitution record"}
              </h2>
            </div>
            <button type="button" className="close-btn" onClick={onClose} aria-label="Close" data-testid="button-close-restitution-form">
              <X />
            </button>
          </div>
          <div className="modal-body">
            <div className="form-warning" role="note">
              Enter only the apprentice details shown here. Do not enter Social Security numbers or unrelated sensitive identifiers.
            </div>
            <RequiredFieldsNote />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="restitution-status">Status of Restitution</label>
                <select className="field" id="restitution-status" data-testid="select-restitution-status" {...form.register("status")}>
                  {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="restitution-projectId">Project Title</label>
                <select className="field" id="restitution-projectId" data-testid="select-restitution-project" {...form.register("projectId")}>
                  <option value="">Not linked</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{projectLabel(project)}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="restitution-contractorId">Primary Contractor</label>
                <ContractorSelectWithAdd
                  id="restitution-contractorId"
                  contractors={contractors}
                  value={form.watch("contractorId")}
                  onChange={(value) => form.setValue("contractorId", value, { shouldDirty: true })}
                  onCreate={onCreatePrimaryContractor}
                  ariaLabel="Primary Contractor"
                  newNameLabel="New primary contractor name"
                />
              </div>
              {field("firstEmailSentDate", "Date of 1st e-Mail Sent to Contractor", "date")}
              {field("apprenticeName", "Apprentice Name")}
              {field("apprenticeCraft", "Apprentice Craft")}
              {field("cprWeekEndingDate", "CPR(s) Week-Ending Date with issue", "date")}
              <div className="form-field full">
                <label htmlFor="restitution-unsupervisedHoursDates">Date(s) of Unsupervised Hours</label>
                <textarea className="field" id="restitution-unsupervisedHoursDates" data-testid="input-restitution-unsupervisedHoursDates" rows={2} {...form.register("unsupervisedHoursDates")} />
              </div>
              {field("numberOfUnsupervisedHours", "Number of Hours Unsupervised", "number")}
              {field("amountOwed", "Amount Owed", "number", true)}
              {triStateField("paidForRestitution", "Paid for Restitution?")}
              <div className="form-field full restitution-docs-field">
                <span className="restitution-field-label">Docs Provided? (need following 3: copy of check, proof of deposit, and calculations of wage difference paid)</span>
                <div className="restitution-doc-checks">
                  {documentChecks.map(({ key, label }) => (
                    <label className="checkbox-control" htmlFor={`restitution-${key}`} key={key}>
                      <input id={`restitution-${key}`} data-testid={`checkbox-restitution-${key}`} type="checkbox" {...form.register(key)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {triStateField("uploadedDocsInLcptracker", "Uploaded Docs in LCPtracker e-Docs?")}
              {triStateField("confidentialNotesAddedToCpr", "Confidential Notes Added to the CPR and Saved")}
              {triStateField("cprReviewAccepted", "CPR in LCPtracker changed from 'Reviewed' to 'Accepted'")}
              <div className="form-field full">
                <label htmlFor="restitution-comments">Comments</label>
                <textarea className="field" id="restitution-comments" data-testid="input-restitution-comments" rows={3} {...form.register("comments")} />
              </div>
            </div>
            {form.formState.errors.amountOwed && <div className="alert-message" role="alert">{form.formState.errors.amountOwed.message}</div>}
            {form.formState.errors.numberOfUnsupervisedHours && <div className="alert-message" role="alert">{form.formState.errors.numberOfUnsupervisedHours.message}</div>}
            {error && <div className="alert-message" role="alert">{error}</div>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid="button-save-restitution">
              {saving ? "Saving…" : <><Check /> Save record</>}
            </button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export function RestitutionsPage({
  projects,
  contractors,
  onDelete,
  onCreatePrimaryContractor,
}: {
  projects: Project[];
  contractors: Contractor[];
  onDelete: (id: number, title: string) => void;
  onCreatePrimaryContractor: (name: string) => Promise<Contractor>;
}) {
  const queryClient = useQueryClient();
  const query = useGetRestitutions({
    query: { retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true },
  });
  const createMutation = useCreateRestitution();
  const updateMutation = useUpdateRestitution();
  const [selected, setSelected] = useState<Restitution | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All statuses");
  const [sortBy, setSortBy] = useState("emailDate:desc");

  const records = query.data ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return sortRows(records.filter((record) => {
      if (statusFilter !== "All statuses" && record.status !== statusFilter) return false;
      if (!term) return true;
      return [
        record.projectName, record.contractorName, record.apprenticeName, record.apprenticeCraft,
        record.unsupervisedHoursDates, record.comments, record.status,
      ].join(" ").toLocaleLowerCase().includes(term);
    }), sortBy, {
      project: (record) => record.projectName,
      contractor: (record) => record.contractorName,
      status: (record) => record.status,
      apprentice: (record) => record.apprenticeName,
      emailDate: (record) => record.firstEmailSentDate,
      cprDate: (record) => record.cprWeekEndingDate,
      amount: (record) => record.amountOwed,
    });
  }, [records, search, statusFilter, sortBy]);

  const outstanding = records.reduce(
    (sum, record) => sum + (record.paidForRestitution === "Yes" ? 0 : record.amountOwed),
    0,
  );
  const openCount = records.filter((record) => !["Paid", "Closed"].includes(record.status)).length;

  const save = (data: RestitutionInput) => {
    const onSuccess = () => {
      void queryClient.invalidateQueries();
      setSelected(null);
    };
    if (selected && selected !== "new") {
      updateMutation.mutate({ id: selected.id, data }, { onSuccess });
    } else {
      createMutation.mutate({ data }, { onSuccess });
    }
  };

  const saveError = errorText(
    createMutation.error || updateMutation.error,
    "The record could not be saved. Check the form and try again.",
  );
  const hasSaveError = Boolean(createMutation.error || updateMutation.error);

  return (
    <div className="restitutions-page" data-testid="page-restitutions">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SQL Server · Restitution tracking</div>
          <h1>Restitution</h1>
          <p className="subheading">Track restitution status, apprentice details, unsupervised hours, documentation, and CPR follow-through.</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          data-testid="button-add-restitution"
          onClick={() => {
            createMutation.reset();
            updateMutation.reset();
            setSelected("new");
          }}
          disabled={query.isError}
        >
          <Plus /> Add restitution
        </button>
      </div>

      <div className="restitution-summary">
        <div className="panel metric">
          <div className="metric-label">Records</div>
          <div className="metric-value">{records.length.toLocaleString()}</div>
          <div className="metric-note">SQL-backed restitution entries</div>
        </div>
        <div className="panel metric alert">
          <div className="metric-label">Open cases</div>
          <div className="metric-value">{openCount.toLocaleString()}</div>
          <div className="metric-note">Not marked paid or closed</div>
        </div>
        <div className="panel metric gold">
          <div className="metric-label">Outstanding balance</div>
          <div className="metric-value">{money(outstanding)}</div>
          <div className="metric-note">Amount owed unless marked paid</div>
        </div>
      </div>

      {query.isLoading && <div className="panel loading-state">Loading restitution records…</div>}
      {query.isError && <div className="error-state restitution-storage-error" role="alert">
        <div>
          <strong>Restitution records are unavailable.</strong>
          <p>{errorText(query.error, "The SQL table has not been installed or the app cannot read it.")}</p>
        </div>
        <button type="button" className="btn" onClick={() => void query.refetch()}>
          <RefreshCw /> Retry
        </button>
      </div>}

      {!query.isError && !query.isLoading && <>
        <div className="tools-row restitution-tools">
          <label className="search-box">
            <Search />
            <input
              className="field"
              type="search"
              aria-label="Search restitution records"
              data-testid="input-search-restitution"
              placeholder="Search project, contractor, apprentice, or comments…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            className="field select-field"
            aria-label="Filter restitution status"
            data-testid="select-filter-restitution-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option>All statuses</option>
            {statuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          <SortByControl value={sortBy} onChange={setSortBy} options={[
            { value: "emailDate:desc", label: "Newest email date" },
            { value: "emailDate:asc", label: "Oldest email date" },
            { value: "project:asc", label: "Project A–Z" },
            { value: "contractor:asc", label: "Contractor A–Z" },
            { value: "status:asc", label: "Status" },
            { value: "apprentice:asc", label: "Apprentice A–Z" },
            { value: "cprDate:desc", label: "Newest CPR date" },
            { value: "amount:desc", label: "Highest amount owed" },
          ]} />
          <span className="panel-kicker">{filtered.length} records</span>
        </div>

        {!filtered.length ? (
          <div className="panel restitution-empty">
            <div className="empty-mark"><SlidersHorizontal /></div>
            <strong>{records.length ? "No matching restitution records" : "No restitution records yet"}</strong>
            <p>{records.length
              ? "Clear the search or choose a different status."
              : "Add a record to start tracking restitution cases."}</p>
          </div>
        ) : (
          <div className="panel restitution-table-panel">
            <div className="table-wrap">
              <RowNumberedTable className="data-table restitution-table">
                <thead><tr>
                  <th>Status of Restitution</th>
                  <th>Project Title</th>
                  <th>Contractor</th>
                  <th>Date of 1st e-Mail Sent to Contractor</th>
                  <th>Apprentice Name</th>
                  <th>Apprentice Craft</th>
                  <th>CPR(s) Week-Ending Date with issue</th>
                  <th>Date(s) of Unsupervised Hours</th>
                  <th>Number of Hours Unsupervised</th>
                  <th>Amount Owed</th>
                  <th>Paid for Restitution?</th>
                  <th>Docs Provided? (need following 3: copy of check, proof of deposit, and calculations of wage difference paid)</th>
                  <th>Uploaded Docs in LCPtracker e-Docs?</th>
                  <th>Confidential Notes Added to the CPR and Saved</th>
                  <th>CPR in LCPtracker changed from 'Reviewed' to 'Accepted'</th>
                  <th>Comments</th>
                  <th aria-label="Actions" />
                </tr></thead>
                <tbody>{filtered.map((record) => (
                  <tr key={record.id} data-testid={`row-restitution-${record.id}`}>
                    <td><span className={`status ${statusTone(record.status)}`}>{record.status}</span></td>
                    <td>{record.projectName || "—"}</td>
                    <td>{record.contractorName || "—"}</td>
                    <td>{dateLabel(record.firstEmailSentDate)}</td>
                    <td>{record.apprenticeName || "—"}</td>
                    <td>{record.apprenticeCraft || "—"}</td>
                    <td>{dateLabel(record.cprWeekEndingDate)}</td>
                    <td className="restitution-reason-cell" title={record.unsupervisedHoursDates}>{record.unsupervisedHoursDates || "—"}</td>
                    <td className="mono">{record.numberOfUnsupervisedHours ?? "—"}</td>
                    <td className="mono">{money(record.amountOwed)}</td>
                    <td>{record.paidForRestitution}</td>
                    <td className="restitution-docs-cell">
                      <div>Check: {record.checkCopyProvided ? "Yes" : "No"}</div>
                      <div>Deposit: {record.proofOfDepositProvided ? "Yes" : "No"}</div>
                      <div>Calculations: {record.wageDifferenceCalculationsProvided ? "Yes" : "No"}</div>
                    </td>
                    <td>{record.uploadedDocsInLcptracker}</td>
                    <td>{record.confidentialNotesAddedToCpr}</td>
                    <td>{record.cprReviewAccepted}</td>
                    <td className="restitution-reason-cell" title={record.comments}>{record.comments || "—"}</td>
                    <td className="record-actions-cell" data-label="Actions">
                      <RecordRowActions
                        recordType="restitution"
                        recordId={record.id}
                        title={record.apprenticeName || record.projectName || `Restitution ${record.id}`}
                        editTestId={`button-edit-restitution-${record.id}`}
                        deleteTestId={`button-delete-restitution-${record.id}`}
                        editLabel={`Edit restitution record ${record.id}`}
                        deleteLabel={`Delete restitution record ${record.id}`}
                        onEdit={() => {
                          createMutation.reset();
                          updateMutation.reset();
                          setSelected(record);
                        }}
                        onDelete={(_recordType, id, title) => onDelete(id, title)}
                      />
                    </td>
                  </tr>
                ))}</tbody>
              </RowNumberedTable>
            </div>
          </div>
        )}
      </>}

      {selected && <RestitutionForm
        key={selected === "new" ? "new-restitution" : `restitution-${selected.id}`}
        record={selected === "new" ? undefined : selected}
        projects={projects}
        contractors={contractors}
        saving={createMutation.isPending || updateMutation.isPending}
        error={hasSaveError ? saveError : ""}
        onClose={() => {
          createMutation.reset();
          updateMutation.reset();
          setSelected(null);
        }}
        onSubmit={save}
        onCreatePrimaryContractor={onCreatePrimaryContractor}
      />}
    </div>
  );
}
