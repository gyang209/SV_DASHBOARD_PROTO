import type { Contractor, Project } from "@workspace/api-zod";

export type RecordFieldChange = {
  field: string;
  before: string;
  after: string;
};

export function buildRecordCreatedChange(
  recordType: "project" | "contractor",
): RecordFieldChange[] {
  return [{
    field: "Record created",
    before: "",
    after: recordType === "project" ? "Project" : "Contractor",
  }];
}

type FieldDefinition = {
  key: keyof Project;
  label: string;
  kind?: "date" | "boolean" | "contractor" | "formsStatus" | "formStatus";
};

const projectFields: FieldDefinition[] = [
  { key: "projectNumber", label: "Project number" },
  { key: "projectName", label: "Project name" },
  { key: "dirNumber", label: "DIR number" },
  { key: "classification", label: "Classification" },
  { key: "contractorId", label: "Primary contractor", kind: "contractor" },
  { key: "intakeDate", label: "Intake date", kind: "date" },
  { key: "registrationStatus", label: "LCP status" },
  { key: "registrationBypass", label: "LCP bypass", kind: "boolean" },
  { key: "registrationBypassStatus", label: "LCP bypass status" },
  { key: "registrationCheckedOn", label: "LCP checked date", kind: "date" },
  { key: "payrollFormsStatus", label: "DIR status" },
  { key: "payrollFormsBypass", label: "DIR bypass", kind: "boolean" },
  { key: "payrollFormsBypassStatus", label: "DIR bypass status" },
  { key: "payrollFormsCheckedOn", label: "DIR checked date", kind: "date" },
  { key: "formsStatus", label: "Forms status", kind: "formsStatus" },
  { key: "form1Status", label: "Form 1 status", kind: "formStatus" },
  { key: "form2Status", label: "Form 2 status", kind: "formStatus" },
  { key: "form3Status", label: "Form 3 status", kind: "formStatus" },
  { key: "form4Status", label: "Form 4 status", kind: "formStatus" },
  { key: "paymentDueDate", label: "Payment due date", kind: "date" },
  { key: "paymentDate", label: "Payment date", kind: "date" },
  { key: "complianceNotes", label: "Comments" },
  { key: "projectInitiationDate", label: "Project initiation date", kind: "date" },
  { key: "projectFinishDate", label: "Project finish date", kind: "date" },
  { key: "pwc100", label: "PWC-100", kind: "boolean" },
  { key: "pwc100RegisteredDate", label: "PWC-100 registration date", kind: "date" },
  { key: "pwc100ExpirationDate", label: "PWC-100 expiration date", kind: "date" },
  { key: "designProjectManager", label: "Design project manager" },
  { key: "designProjectManagerEmail", label: "Design project manager email" },
  { key: "designWeekStart", label: "Design week start", kind: "date" },
  { key: "designWeekEnd", label: "Design week end", kind: "date" },
  { key: "designPwcrExpirationDate", label: "Design PWCR expiration date", kind: "date" },
  { key: "primeApprover", label: "Prime approver" },
  { key: "federalProject", label: "Federal project", kind: "boolean" },
  { key: "federalProjectNumber", label: "Federal project number" },
  { key: "davisBaconDetermination", label: "Davis-Bacon determination" },
  { key: "federalSetupInLcp", label: "Federal setup in LCP" },
  { key: "federalNotes", label: "Federal notes" },
  { key: "federalActive", label: "Federal active status" },
  { key: "designProject", label: "Design project", kind: "boolean" },
  { key: "onCall", label: "On-call project", kind: "boolean" },
  { key: "pasCipDpw", label: "PAS CIP+DPW project", kind: "boolean" },
];

type RawChange = {
  field: string;
  before: unknown;
  after: unknown;
};

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function normalizedValue(value: unknown, kind?: FieldDefinition["kind"]): unknown {
  if (kind === "date") {
    const raw = text(value);
    return raw ? raw.slice(0, 10) : null;
  }
  if (kind === "boolean") return value === true || value === 1 || value === "1";
  if (kind === "contractor") {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (kind === "formStatus") {
    return ["Not checked", "Complete", "Missing"].includes(text(value))
      ? text(value)
      : "Not tracked";
  }
  if (kind === "formsStatus") {
    return ["Projects with all forms", "Projects with missing forms"].includes(text(value))
      ? text(value)
      : "Not tracked";
  }
  return text(value);
}

function displayValue(
  value: unknown,
  kind: FieldDefinition["kind"],
  contractorNames: ReadonlyMap<number, string>,
): string {
  const normalized = normalizedValue(value, kind);
  if (normalized === null) return "Not set";
  if (kind === "boolean") return normalized ? "Yes" : "No";
  if (kind === "contractor") {
    const id = Number(normalized);
    return contractorNames.get(id) ?? `Contractor ${id}`;
  }
  return String(normalized) || "(empty)";
}

export function buildProjectChanges(
  input: Record<string, unknown>,
  current: Project,
  contractors: readonly Pick<Contractor, "id" | "name">[] = [],
): RawChange[] {
  const contractorNames = new Map(contractors.map(({ id, name }) => [id, name]));
  return projectFields.flatMap(({ key, label, kind }) => {
    if (!(key in input)) return [];
    const before = normalizedValue(current[key], kind);
    const after = normalizedValue(input[key], kind);
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [{
      field: label,
      before: displayValue(current[key], kind, contractorNames),
      after: displayValue(input[key], kind, contractorNames),
    }];
  });
}

export function buildContractorChanges(
  input: Record<string, unknown>,
  current: Contractor,
): RawChange[] {
  return ([
    ["name", "Contractor name"],
    ["aliases", "Aliases"],
  ] as const).flatMap(([key, label]) => {
    if (!(key in input)) return [];
    const before = text(current[key]).trim();
    const after = key === "name" ? text(input[key]).trim() : text(input[key]);
    if (before === after) return [];
    return [{
      field: label,
      before: before || "Not set",
      after: after || "(empty)",
    }];
  });
}
