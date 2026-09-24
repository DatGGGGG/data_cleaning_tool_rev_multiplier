import { MappingArtifactWorkbenchError } from "@/lib/mapping-artifacts/errors";
import { getMappingArtifactPrincipal, type WorkbenchPrincipal } from "@/lib/mapping-artifacts/auth";
import { listBottomUpVersions } from "@/lib/bottom-up/server";
import { listTopDownVersions } from "@/lib/top-down/server";

export type SourceWorkflow = "top_down" | "bottom_up";

export type SourceVersionBrowserItem = {
  id: string;
  workflow: SourceWorkflow;
  label: string;
  createdAt: string;
  createdBy: string;
  rowCount: number;
  rowLabel: string;
  checksumSha256: string;
  secondarySummary: string;
};

export async function requireVersionBrowserRead(request: Request): Promise<WorkbenchPrincipal> {
  const principal = await getMappingArtifactPrincipal(request);
  if (!principal) {
    throw new MappingArtifactWorkbenchError("authentication_required", "Launch the workbench from the portal.", 401);
  }
  if (!principal.roles.some((role) => role === "viewer" || role === "analyst" || role === "admin")) {
    throw new MappingArtifactWorkbenchError("forbidden", "Your workbench role cannot view saved versions.", 403);
  }
  return principal;
}

export async function listSourceVersionBrowserItems(workflow: SourceWorkflow): Promise<SourceVersionBrowserItem[]> {
  if (workflow === "top_down") {
    const versions = await listTopDownVersions();
    return versions.map((version) => ({
      id: version.id,
      workflow,
      label: version.label,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      rowCount: version.flattenedAppCount,
      rowLabel: "flattened apps",
      checksumSha256: version.checksumSha256,
      secondarySummary: `${version.publisherCount} publishers`,
    }));
  }

  const versions = await listBottomUpVersions();
  return versions.map((version) => ({
    id: version.id,
    workflow,
    label: version.label,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    rowCount: version.mappedRowCount,
    rowLabel: "mapped rows",
    checksumSha256: version.checksumSha256,
    secondarySummary: `${version.needsReviewCount} need review · ${version.rowCount} total rows`,
  }));
}
