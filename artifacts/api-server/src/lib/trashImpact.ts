import type {
  ContractorSubcontractor,
  Project,
  TrashAffectedRecord,
  TrashRecordType,
  WorkspaceData,
} from "@workspace/api-zod";
import type { RestitutionRecord } from "./restitutions";
import { getRestitutions } from "./restitutions";
import {
  getWorkbookSourceRowRelations,
  type WorkbookSourceRowRelation,
} from "./sqlCompliance";

type LinkWithOwner = {
  ownerId: number;
  ownerName: string;
  link: ContractorSubcontractor;
};

function addAffected(
  list: TrashAffectedRecord[],
  item: TrashAffectedRecord,
  deletedType: TrashRecordType,
  deletedId: number,
): void {
  if (item.recordType === deletedType && item.recordId === String(deletedId)) return;
  if (list.some((existing) => existing.recordType === item.recordType && existing.recordId === item.recordId)) return;
  list.push(item);
}

function projectEntry(
  project: Pick<Project, "id" | "projectName" | "projectNumber">,
  impact: string,
): TrashAffectedRecord {
  return {
    recordType: "project",
    recordId: String(project.id),
    title: project.projectNumber
      ? `${project.projectName} · ${project.projectNumber}`
      : project.projectName,
    impact,
  };
}

function contractorEntry(
  id: number,
  name: string,
  impact: string,
  alternateNames = "",
): TrashAffectedRecord {
  return {
    recordType: "contractor",
    recordId: String(id),
    title: name || `Contractor ${id}`,
    impact,
    ...(alternateNames.trim() ? { alternateNames: alternateNames.trim() } : {}),
  };
}

function linkEntry(link: ContractorSubcontractor, impact: string): TrashAffectedRecord {
  return {
    recordType: "subcontractorLink",
    recordId: String(link.linkId ?? link.id),
    title: `${link.subcontractorName} · ${link.projectName}`,
    impact,
  };
}

function withholdingEntry(id: number, impact: string): TrashAffectedRecord {
  return {
    recordType: "withholding",
    recordId: String(id),
    title: `Withholding ${id}`,
    impact,
  };
}

function restitutionEntry(id: number, impact: string): TrashAffectedRecord {
  return {
    recordType: "restitution",
    recordId: String(id),
    title: `Restitution ${id}`,
    impact,
  };
}

function sourceRowEntry(relation: WorkbookSourceRowRelation, impact: string): TrashAffectedRecord {
  return {
    recordType: "sourceRow",
    recordId: String(relation.id),
    title: `${relation.sourceSheet} · Excel row ${relation.excelRow}`,
    impact,
  };
}

function allLinks(workspace: WorkspaceData): LinkWithOwner[] {
  return workspace.contractors.flatMap((owner) =>
    owner.subcontractors.map((link) => ({
      ownerId: owner.id,
      ownerName: owner.name,
      link,
    })),
  );
}

function workspaceProject(
  workspace: WorkspaceData,
  id: number,
  snapshot: unknown,
): Project | null {
  const project = workspace.projects.find((candidate) => candidate.id === id);
  if (project) return project;
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidate = snapshot as Partial<Project>;
  if (candidate.id !== id || typeof candidate.projectName !== "string") return null;
  return candidate as Project;
}

function workspaceContractorName(workspace: WorkspaceData, id: number): string {
  return workspace.contractors.find((contractor) => contractor.id === id)?.name ?? "";
}

function workspaceContractorAlternateNames(workspace: WorkspaceData, id: number): string {
  return workspace.contractors.find((contractor) => contractor.id === id)?.aliases ?? "";
}

function impactFor(deletedType: TrashRecordType, relationRole = ""): string {
  if (deletedType === "project") {
    return "The project is in Trash; this linked record remains stored and is not changed.";
  }
  if (deletedType === "contractor") {
    return "The project or relationship remains stored; this contractor is hidden while in Trash.";
  }
  if (deletedType === "subcontractorLink") {
    return "The project and contractors remain active; only this relationship is in Trash.";
  }
  if (deletedType === "sourceRow") {
    if (relationRole === "project source") {
      return "This source row is in Trash; its linked project is hidden from workspace lists.";
    }
    if (relationRole.toLowerCase().includes("sub")) {
      return "This source row is in Trash; its subcontractor relationship is hidden, while the project and contractor remain.";
    }
    return "This source row is in Trash; its contractor relationship is hidden, while the project and contractor remain.";
  }
  return "The linked project or contractor remains active; only this record is in Trash.";
}

export function buildTrashAffectedRecordsFromData(
  deletedType: TrashRecordType,
  deletedId: number,
  snapshot: unknown,
  workspace: WorkspaceData,
  restitutions: readonly RestitutionRecord[],
  sourceRelations: readonly WorkbookSourceRowRelation[],
): TrashAffectedRecord[] {
  const affected: TrashAffectedRecord[] = [];
  const links = allLinks(workspace);

  const addProject = (
    project: Project | null,
    impact = impactFor(deletedType),
  ): void => {
    if (!project) return;
    addAffected(affected, projectEntry(project, impact), deletedType, deletedId);
  };
  const addContractor = (
    id: number | null | undefined,
    name = "",
    impact = impactFor(deletedType),
  ): void => {
    if (id === null || id === undefined) return;
    addAffected(
      affected,
      contractorEntry(
        id,
        name || workspaceContractorName(workspace, id),
        impact,
        workspaceContractorAlternateNames(workspace, id),
      ),
      deletedType,
      deletedId,
    );
  };
  const addLink = (
    link: ContractorSubcontractor,
    impact = impactFor(deletedType),
  ): void => {
    addAffected(affected, linkEntry(link, impact), deletedType, deletedId);
  };

  if (deletedType === "project") {
    const project = workspaceProject(workspace, deletedId, snapshot);
    if (!project) return affected;
    addContractor(project.contractorId);
    for (const { link } of links) {
      if (link.projectId === deletedId) addLink(link);
    }
    for (const withholding of workspace.withholdings) {
      if (withholding.projectId === deletedId) {
        addAffected(affected, withholdingEntry(withholding.id, impactFor(deletedType)), deletedType, deletedId);
      }
    }
    for (const restitution of restitutions) {
      if (restitution.projectId === deletedId) {
        addAffected(affected, restitutionEntry(restitution.id, impactFor(deletedType)), deletedType, deletedId);
      }
    }
    for (const relation of sourceRelations) {
      if (relation.relationshipRole === "project source") {
        addAffected(affected, sourceRowEntry(relation, impactFor(deletedType)), deletedType, deletedId);
      }
    }
  } else if (deletedType === "contractor") {
    const contractor = workspace.contractors.find((candidate) => candidate.id === deletedId);
    for (const project of workspace.projects) {
      if (project.contractorId === deletedId) addProject(project);
    }
    for (const { ownerId, ownerName, link } of links) {
      if (ownerId === deletedId) {
        addProject(workspace.projects.find((project) => project.id === link.projectId) ?? null);
        addContractor(link.subcontractorId, link.subcontractorName);
        addLink(link);
      } else if (link.subcontractorId === deletedId) {
        addContractor(ownerId, ownerName);
        addProject(workspace.projects.find((project) => project.id === link.projectId) ?? null);
        addLink(link);
      }
    }
    for (const withholding of workspace.withholdings) {
      if (withholding.contractorId === deletedId) {
        if (withholding.projectId !== null) {
          addProject(workspace.projects.find((project) => project.id === withholding.projectId) ?? null);
        }
        addAffected(affected, withholdingEntry(withholding.id, impactFor(deletedType)), deletedType, deletedId);
      }
    }
    for (const restitution of restitutions) {
      if (restitution.contractorId === deletedId) {
        if (restitution.projectId !== null) {
          addProject(workspace.projects.find((project) => project.id === restitution.projectId) ?? null);
        }
        addAffected(affected, restitutionEntry(restitution.id, impactFor(deletedType)), deletedType, deletedId);
      }
    }
    if (!contractor) return affected;
  } else if (deletedType === "withholding") {
    const withholding = workspace.withholdings.find((candidate) => candidate.id === deletedId);
    if (withholding) {
      addProject(withholding.projectId === null
        ? null
        : workspace.projects.find((project) => project.id === withholding.projectId) ?? null);
      addContractor(withholding.contractorId, withholding.contractorName);
    }
  } else if (deletedType === "restitution") {
    const restitution = restitutions.find((candidate) => candidate.id === deletedId);
    if (restitution) {
      addProject(restitution.projectId === null
        ? null
        : workspace.projects.find((project) => project.id === restitution.projectId) ?? null);
      addContractor(restitution.contractorId, restitution.contractorName);
    }
  } else if (deletedType === "subcontractorLink") {
    const ownerLink = links.find(({ link }) => link.linkId === deletedId);
    if (ownerLink) {
      addProject(workspace.projects.find((project) => project.id === ownerLink.link.projectId) ?? null);
      addContractor(ownerLink.ownerId, ownerLink.ownerName);
      addContractor(ownerLink.link.subcontractorId, ownerLink.link.subcontractorName);
    }
  } else if (deletedType === "sourceRow") {
    for (const relation of sourceRelations) {
      const impact = impactFor(deletedType, relation.relationshipRole);
      if (relation.projectId !== null) {
        addProject(
          workspace.projects.find((project) => project.id === relation.projectId) ?? null,
          impact,
        );
      }
      addContractor(relation.contractorId, relation.contractorName, impact);
    }
  }

  return affected;
}

export async function buildTrashAffectedRecords(
  deletedType: TrashRecordType,
  deletedId: number,
  snapshot: unknown,
  workspace: WorkspaceData,
): Promise<TrashAffectedRecord[]> {
  const needsRestitutions = ["project", "contractor", "restitution"].includes(deletedType);
  const needsSourceRelations = deletedType === "project" || deletedType === "sourceRow";
  const [restitutions, sourceRelations] = await Promise.all([
    needsRestitutions ? getRestitutions() : Promise.resolve([]),
    needsSourceRelations
      ? getWorkbookSourceRowRelations(
        deletedType === "sourceRow"
          ? { sourceRowId: deletedId }
          : { projectId: deletedId },
      )
      : Promise.resolve([]),
  ]);
  return buildTrashAffectedRecordsFromData(
    deletedType,
    deletedId,
    snapshot,
    workspace,
    restitutions,
    sourceRelations,
  );
}
