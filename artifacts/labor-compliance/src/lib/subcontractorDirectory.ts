import type { Contractor, Project } from "@workspace/api-client-react";

export type SubcontractorDirectoryProject = {
  projectId: number;
  projectName: string;
  projectNumber: string;
  projectType: string;
  lcpStatus: string;
  dirStatus: string;
  primaryContractorName: string;
};

export type SubcontractorDirectoryEntry = {
  subcontractorId: number;
  name: string;
  projects: SubcontractorDirectoryProject[];
};

export function buildSubcontractorDirectory(
  contractors: readonly Contractor[],
  projects: readonly Project[],
): SubcontractorDirectoryEntry[] {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const entries = new Map<number, SubcontractorDirectoryEntry>();
  const linkedProjectIds = new Map<number, Set<number>>();

  for (const primaryContractor of contractors) {
    for (const subcontractor of primaryContractor.subcontractors ?? []) {
      const project = projectsById.get(subcontractor.projectId);
      if (!project || project.contractorId !== primaryContractor.id) continue;

      let entry = entries.get(subcontractor.subcontractorId);
      if (!entry) {
        entry = {
          subcontractorId: subcontractor.subcontractorId,
          name: subcontractor.subcontractorName.trim() || "Unnamed subcontractor",
          projects: [],
        };
        entries.set(subcontractor.subcontractorId, entry);
        linkedProjectIds.set(subcontractor.subcontractorId, new Set());
      }

      const seenProjects = linkedProjectIds.get(subcontractor.subcontractorId)!;
      if (seenProjects.has(project.id)) continue;
      seenProjects.add(project.id);
      entry.projects.push({
        projectId: project.id,
        projectName: project.projectName || subcontractor.projectName,
        projectNumber: project.projectNumber || project.projectKey || subcontractor.projectNumber,
        projectType: [
          project.federalProject && "Federal project",
          project.designProject && "Design project",
          project.onCall && "On call",
          project.pasCipDpw && "PAS CIP+DPW",
        ].filter(Boolean).join(", ") || "Not selected",
        lcpStatus: project.registrationStatus || "Not checked",
        dirStatus: project.payrollFormsStatus || "Not checked",
        primaryContractorName: primaryContractor.name,
      });
    }
  }

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      projects: entry.projects.sort((left, right) =>
        left.projectName.localeCompare(right.projectName, undefined, { numeric: true, sensitivity: "base" }) ||
        left.projectId - right.projectId,
      ),
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) ||
      left.subcontractorId - right.subcontractorId,
    );
}
