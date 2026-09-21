import { MappingArtifactWorkbenchError } from "@/lib/mapping-artifacts/errors";
import type { MappingArtifactReadiness } from "@/lib/mapping-artifacts/types";

export type MappingArtifactCapability = "read" | "publish" | "commit" | "activate";

export type WorkbenchPrincipal = {
  id: string;
  displayName: string;
  roles: string[];
};

function featureEnabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function upstreamConfigured() {
  return Boolean(
    process.env.SENSORTOWER_PIPELINE_API_BASE_URL?.trim() &&
      process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN?.trim(),
  );
}

/**
 * The standalone workbench has no production identity provider yet. Keep mutation
 * routes fail-closed until this adapter is replaced by trusted gateway/SSO identity.
 * Never derive an actor from the editable operator field.
 */
export async function getMappingArtifactPrincipal(_request: Request): Promise<WorkbenchPrincipal | null> {
  return null;
}

export async function getMappingArtifactReadiness(request: Request): Promise<MappingArtifactReadiness> {
  const uiEnabled = featureEnabled("MAPPING_ARTIFACT_UI_ENABLED");
  const mutationsEnabled = featureEnabled("MAPPING_ARTIFACT_MUTATIONS_ENABLED");
  const principal = await getMappingArtifactPrincipal(request);
  const configured = upstreamConfigured();
  const authenticated = Boolean(principal);

  let message = "Mapping Artifact integration is disabled.";
  if (uiEnabled && !mutationsEnabled) {
    message = "Artifact publishing is in safe mode until workbench authentication is enabled.";
  } else if (uiEnabled && mutationsEnabled && !authenticated) {
    message = "Artifact publishing requires authenticated workbench roles.";
  } else if (uiEnabled && mutationsEnabled && authenticated && !configured) {
    message = "The SensorTower Mapping Artifact service is not configured.";
  } else if (uiEnabled && mutationsEnabled && authenticated) {
    message = "Mapping Artifact integration is ready.";
  }

  return {
    uiEnabled,
    mutationsEnabled,
    authenticated,
    canPublish: Boolean(uiEnabled && mutationsEnabled && authenticated && configured && principal?.roles.includes("analyst")),
    canCommit: Boolean(uiEnabled && mutationsEnabled && authenticated && configured && principal?.roles.some((role) => role === "analyst" || role === "reviewer")),
    canActivate: Boolean(uiEnabled && mutationsEnabled && authenticated && configured && principal?.roles.includes("admin")),
    upstreamConfigured: configured,
    message,
  };
}

export async function requireMappingArtifactCapability(
  request: Request,
  capability: MappingArtifactCapability,
): Promise<WorkbenchPrincipal> {
  const readiness = await getMappingArtifactReadiness(request);
  if (!readiness.uiEnabled || (capability !== "read" && !readiness.mutationsEnabled)) {
    throw new MappingArtifactWorkbenchError("feature_disabled", readiness.message, 503);
  }
  const principal = await getMappingArtifactPrincipal(request);
  if (!principal) {
    throw new MappingArtifactWorkbenchError("authentication_required", readiness.message, 401);
  }
  if (!readiness.upstreamConfigured) {
    throw new MappingArtifactWorkbenchError("service_not_configured", readiness.message, 503);
  }

  const authorized =
    (capability === "read" && principal.roles.some((role) => role === "viewer" || role === "analyst" || role === "reviewer" || role === "admin")) ||
    (capability === "publish" && principal.roles.includes("analyst")) ||
    (capability === "commit" && principal.roles.some((role) => role === "analyst" || role === "reviewer")) ||
    (capability === "activate" && principal.roles.includes("admin"));
  if (!authorized) {
    throw new MappingArtifactWorkbenchError("forbidden", "Your workbench role cannot perform this artifact action.", 403);
  }
  return principal;
}
