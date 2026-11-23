import type { ContractorSubcontractor, Project } from "@workspace/api-client-react";

export type ContractorProjectGroup = {
  projectId: number;
  projectName: string;
  projectNumber: string;
  subcontractors: ContractorSubcontractor[];
};

export type ContractorProjectSortOrder =
  | "name:asc"
  | "name:desc"
  | "number:asc"
  | "number:desc"
  | "subcontractors:desc"
  | "subcontractors:asc";

function compareProjectGroups(left: ContractorProjectGroup, right: ContractorProjectGroup): number {
  return left.projectName.localeCompare(right.projectName, undefined, { numeric: true, sensitivity: "base" }) ||
    left.projectNumber.localeCompare(right.projectNumber, undefined, { numeric: true, sensitivity: "base" }) ||
    left.projectId - right.projectId;
}

export function sortContractorProjectGroups(
  groups: readonly ContractorProjectGroup[],
  sortOrder: ContractorProjectSortOrder,
): ContractorProjectGroup[] {
  const [field, direction] = sortOrder.split(":") as [string, "asc" | "desc"];
  const multiplier = direction === "desc" ? -1 : 1;
  return [...groups].sort((left, right) => {
    let comparison = 0;
    if (field === "name") {
      comparison = left.projectName.localeCompare(right.projectName, undefined, { numeric: true, sensitivity: "base" });
    } else if (field === "number") {
      comparison = left.projectNumber.localeCompare(right.projectNumber, undefined, { numeric: true, sensitivity: "base" });
    } else {
      comparison = left.subcontractors.length - right.subcontractors.length;
    }
    return comparison * multiplier || compareProjectGroups(left, right);
  });
}

export function groupContractorProjects(
  contractorId: number,
  projects: readonly Project[],
  subcontractors: readonly ContractorSubcontractor[],
): ContractorProjectGroup[] {
  const groups = new Map<number, ContractorProjectGroup>();
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  for (const project of projects) {
    if (project.contractorId !== contractorId) continue;
    groups.set(project.id, {
      projectId: project.id,
      projectName: project.projectName,
      projectNumber: project.projectNumber || project.projectKey,
      subcontractors: [],
    });
  }

  for (const detail of subcontractors) {
    const project = projectsById.get(detail.projectId);
    if (!project || project.contractorId !== contractorId) continue;
    const group = groups.get(detail.projectId);
    if (!group) continue;
    if (!group.subcontractors.some((row) => row.subcontractorId === detail.subcontractorId)) {
      group.subcontractors.push(detail);
    }
  }

  return [...groups.values()].sort(compareProjectGroups);
}
