import type { PortalRole } from "@/lib/auth/session";

export type PortalIdentity = {
  userId: string;
  email: string;
  displayName: string;
  role: PortalRole;
};

function portalConfig() {
  const baseUrl = process.env.PORTAL_INTERNAL_API_BASE_URL?.trim().replace(/\/$/, "");
  const token = process.env.PORTAL_SERVICE_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("Portal authentication is not configured.");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Portal authentication is not configured.");
  return { baseUrl, token };
}

function parseIdentity(candidate: unknown): PortalIdentity {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Portal returned an invalid identity.");
  const value = candidate as Record<string, unknown>;
  const userId = typeof value.user_id === "number" && Number.isSafeInteger(value.user_id) && value.user_id > 0
    ? String(value.user_id)
    : typeof value.user_id === "string" && value.user_id.trim() && value.user_id.length <= 128
      ? value.user_id.trim()
      : "";
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const displayName = typeof value.display_name === "string" ? value.display_name.trim() : "";
  const role = value.role;
  if (!userId || !email || email.length > 320 || !displayName || displayName.length > 200 || (role !== "viewer" && role !== "analyst" && role !== "admin")) {
    throw new Error("Portal returned an invalid identity.");
  }
  return { userId, email, displayName, role };
}

export async function consumeWorkspaceGrant(code: string): Promise<PortalIdentity> {
  const config = portalConfig();
  const response = await fetch(`${config.baseUrl}/api/v1/internal/workspace-grants/consume`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audience: "sensortower-cleaning", code }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("The workspace grant was rejected or has expired.");
  return parseIdentity(await response.json().catch(() => null));
}
