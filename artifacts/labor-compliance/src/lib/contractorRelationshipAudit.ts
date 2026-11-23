import type { Contractor, Project } from "@workspace/api-client-react";

export type WorkbookContractorRelationship = {
  sourceSheet: string;
  sourceRow: number;
  projectAnchorRow: number | null;
  projectName: string;
  projectNumbers: string[];
  role: "primary" | "subcontractor" | "unclassified";
  contractorName: string;
  sourceValue: string;
};

export type RelationshipReviewRow = {
  key: string;
  sourceSheet: string;
  sourceRows: number[];
  sourceProjectName: string;
  sourceProjectNumbers: string[];
  sourceRole: "Primary" | "Subcontractor" | "Role unclear" | "App-only primary" | "App-only subcontractor";
  sourceContractorName: string;
  appProjectName: string;
  appProjectNumber: string;
  appPrimaryContractor: string;
  appContractorMatch: string;
  appContractorCandidates: Array<{ id: number; name: string }>;
  reason: string;
};

export type ContractorRelationshipAudit = {
  inSyncCount: number;
  reviewRows: RelationshipReviewRow[];
};

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\(federal\)/gi, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeProjectNumber(value: string): string {
  const trimmed = value.trim();
  const scientificNumber = Number(trimmed);
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(trimmed) && Number.isSafeInteger(scientificNumber)) {
    return String(scientificNumber);
  }
  const integerDecimal = trimmed.match(/^([+-]?\d+)\.0+$/);
  if (integerDecimal) return integerDecimal[1];
  return normalizeName(trimmed);
}

function contractorAliases(contractor: Contractor): string[] {
  return [contractor.name, ...(contractor.aliases ?? "").split(/[,;|]/)]
    .map(normalizeName)
    .filter(Boolean);
}

function matchContractor(name: string, contractors: readonly Contractor[]) {
  const key = normalizeName(name);
  if (!key) return { match: null, ambiguous: false, candidates: [] as Contractor[] };
  const matches = contractors.filter((contractor) => contractorAliases(contractor).includes(key));
  return {
    match: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
    candidates: matches,
  };
}

function projectNameMatches(source: string, app: string): boolean {
  return Boolean(normalizeName(source) && normalizeName(source) === normalizeName(app));
}

function matchProject(
  record: WorkbookContractorRelationship,
  projects: readonly Project[],
) {
  const sourceNumbers = record.projectNumbers.map(normalizeProjectNumber).filter(Boolean);
  const numberMatches = sourceNumbers.length
    ? projects.filter((project) => {
      const projectNumbers = [project.projectNumber, project.projectKey, project.dirNumber]
        .map(normalizeProjectNumber)
        .filter(Boolean);
      return sourceNumbers.some((sourceNumber) => projectNumbers.includes(sourceNumber));
    })
    : [];
  const uniqueNumberMatches = [...new Map(numberMatches.map((project) => [project.id, project])).values()];
  if (uniqueNumberMatches.length > 1) {
    return { match: null, ambiguous: true, numberMismatch: false, nameMismatch: false };
  }
  if (uniqueNumberMatches.length === 1) {
    const match = uniqueNumberMatches[0];
    return {
      match,
      ambiguous: false,
      numberMismatch: false,
      nameMismatch: Boolean(record.projectName && !projectNameMatches(record.projectName, match.projectName)),
    };
  }

  const nameMatches = record.projectName
    ? projects.filter((project) => projectNameMatches(record.projectName, project.projectName))
    : [];
  const uniqueNameMatches = [...new Map(nameMatches.map((project) => [project.id, project])).values()];
  if (uniqueNameMatches.length > 1) {
    return { match: null, ambiguous: true, numberMismatch: false, nameMismatch: false };
  }
  if (uniqueNameMatches.length === 1) {
    return {
      match: uniqueNameMatches[0],
      ambiguous: false,
      numberMismatch: sourceNumbers.length > 0,
      nameMismatch: false,
    };
  }
  return { match: null, ambiguous: false, numberMismatch: false, nameMismatch: false };
}

function uniqueRelationshipRows(records: readonly WorkbookContractorRelationship[]): WorkbookContractorRelationship[][] {
  const groups = new Map<string, WorkbookContractorRelationship[]>();
  for (const record of records) {
    const identity = [
      record.sourceSheet,
      record.projectAnchorRow ?? "no-project",
      record.role,
      normalizeName(record.contractorName),
    ].join("|");
    const rows = groups.get(identity) ?? [];
    rows.push(record);
    groups.set(identity, rows);
  }
  return [...groups.values()];
}

export function auditContractorRelationships(
  records: readonly WorkbookContractorRelationship[],
  projects: readonly Project[],
  contractors: readonly Contractor[],
): ContractorRelationshipAudit {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const contractorById = new Map(contractors.map((contractor) => [contractor.id, contractor]));
  const links = contractors.flatMap((primary) =>
    (primary.subcontractors ?? []).map((subcontractor) => ({
      primaryContractorId: primary.id,
      projectId: subcontractor.projectId,
      subcontractorId: subcontractor.subcontractorId,
    })),
  );
  const reviewRows: RelationshipReviewRow[] = [];
  let inSyncCount = 0;
  const sourcePrimaryPairs = new Set<string>();
  const sourceSubcontractorPairs = new Set<string>();
  const sourceUnclassifiedPairs = new Set<string>();

  for (const group of uniqueRelationshipRows(records)) {
    const record = group[0];
    const sourceRows = [...new Set(group.map((item) => item.sourceRow))].sort((a, b) => a - b);
    const key = `${record.sourceSheet}:${record.projectAnchorRow ?? "none"}:${record.role}:${normalizeName(record.contractorName)}`;
    const sourceRole = record.role === "primary"
      ? "Primary"
      : record.role === "subcontractor"
        ? "Subcontractor"
        : "Role unclear";
    const projectResult = matchProject(record, projects);
    const contractorResult = matchContractor(record.contractorName, contractors);
    const project = projectResult.match;
    const contractor = contractorResult.match;
    if (project) {
      const candidateIds = contractorResult.ambiguous
        ? contractorResult.candidates.map((candidate) => candidate.id)
        : contractor ? [contractor.id] : [];
      for (const candidateId of candidateIds) {
        const pair = `${project.id}:${candidateId}`;
        if (record.role === "primary") sourcePrimaryPairs.add(pair);
        if (record.role === "subcontractor") sourceSubcontractorPairs.add(pair);
        if (record.role === "unclassified") sourceUnclassifiedPairs.add(pair);
      }
    }
    const appPrimary = project?.contractorId
      ? contractorById.get(project.contractorId)?.name ?? project.contractorName
      : project?.contractorName ?? "";
    const appContractorMatch = contractor?.name ?? "";
    const reasons: string[] = [];

    if (record.role === "unclassified") {
      reasons.push("The Active Federal sheet says “Contractor” but does not identify a prime/sub role.");
    }
    if (projectResult.ambiguous) reasons.push("More than one app project matches the workbook identifiers.");
    else if (!project) reasons.push("No exact app project match was found.");
    if (projectResult.nameMismatch) reasons.push("The project number matches, but the project names differ.");
    if (projectResult.numberMismatch) reasons.push("The project name matches, but the project numbers differ.");
    if (contractorResult.ambiguous) reasons.push("More than one app contractor matches this name or alias.");
    else if (!contractor) reasons.push("No exact app contractor name or alias match was found.");

    if (project && contractor && !projectResult.nameMismatch && !projectResult.numberMismatch && !contractorResult.ambiguous) {
      if (record.role === "primary") {
        if (project.contractorId === contractor.id) {
          inSyncCount++;
          continue;
        }
        reasons.push(project.contractorId
          ? `The app currently lists ${appPrimary || "another contractor"} as primary.`
          : "The app project has no linked primary-contractor ID.");
      } else if (record.role === "subcontractor") {
        const matchingLinks = links.filter((link) =>
          link.projectId === project.id && link.subcontractorId === contractor.id,
        );
        if (matchingLinks.some((link) => link.primaryContractorId === project.contractorId)) {
          inSyncCount++;
          continue;
        }
        if (matchingLinks.length) {
          reasons.push("The subcontractor is linked to a different primary contractor in the app.");
        } else {
          reasons.push("The app does not have this subcontractor linked to the project.");
        }
      }
    }

    reviewRows.push({
      key,
      sourceSheet: record.sourceSheet,
      sourceRows,
      sourceProjectName: record.projectName,
      sourceProjectNumbers: record.projectNumbers,
      sourceRole,
      sourceContractorName: record.contractorName,
      appProjectName: project?.projectName ?? "",
      appProjectNumber: project?.projectNumber || project?.projectKey || "",
      appPrimaryContractor: appPrimary,
      appContractorMatch,
      appContractorCandidates: contractorResult.ambiguous
        ? contractorResult.candidates.map(({ id, name }) => ({ id, name }))
        : [],
      reason: reasons.join(" "),
    });
  }

  const appOnlyRows: RelationshipReviewRow[] = [];
  for (const project of projects) {
    if (!project.contractorId || !contractorById.has(project.contractorId)) continue;
    const pair = `${project.id}:${project.contractorId}`;
    if (sourcePrimaryPairs.has(pair) || sourceUnclassifiedPairs.has(pair)) continue;
    const primary = contractorById.get(project.contractorId)!;
    appOnlyRows.push({
      key: `app-primary:${pair}`,
      sourceSheet: "App SQL data",
      sourceRows: [],
      sourceProjectName: project.projectName,
      sourceProjectNumbers: [...new Set([project.projectNumber, project.projectKey, project.dirNumber].filter(Boolean))],
      sourceRole: "App-only primary",
      sourceContractorName: primary.name,
      appProjectName: project.projectName,
      appProjectNumber: project.projectNumber || project.projectKey,
      appPrimaryContractor: primary.name,
      appContractorMatch: primary.name,
      appContractorCandidates: [],
      reason: "The app lists this primary-contractor relationship, but the workbook has no exact matching primary entry.",
    });
  }

  const seenAppSubcontractorPairs = new Set<string>();
  for (const primary of contractors) {
    for (const subcontractor of primary.subcontractors ?? []) {
      const project = projectById.get(subcontractor.projectId);
      if (!project || project.contractorId !== primary.id) continue;
      const pair = `${project.id}:${subcontractor.subcontractorId}`;
      const linkKey = `${primary.id}:${pair}`;
      if (seenAppSubcontractorPairs.has(linkKey)) continue;
      seenAppSubcontractorPairs.add(linkKey);
      if (sourceSubcontractorPairs.has(pair) || sourceUnclassifiedPairs.has(pair)) continue;
      appOnlyRows.push({
        key: `app-subcontractor:${linkKey}`,
        sourceSheet: "App SQL data",
        sourceRows: [],
        sourceProjectName: project.projectName,
        sourceProjectNumbers: [...new Set([project.projectNumber, project.projectKey, project.dirNumber].filter(Boolean))],
        sourceRole: "App-only subcontractor",
        sourceContractorName: subcontractor.subcontractorName,
        appProjectName: project.projectName,
        appProjectNumber: project.projectNumber || project.projectKey,
        appPrimaryContractor: primary.name,
        appContractorMatch: subcontractor.subcontractorName,
        appContractorCandidates: [],
        reason: "The app lists this subcontractor link, but the workbook has no exact matching subcontractor entry.",
      });
    }
  }

  reviewRows.push(...appOnlyRows);
  return {
    inSyncCount,
    reviewRows,
  };
}
