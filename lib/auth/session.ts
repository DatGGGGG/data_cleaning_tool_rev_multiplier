export const WORKBENCH_SESSION_COOKIE = "sensortower_workbench_session";
export const WORKBENCH_SESSION_VERSION = 1;

export type PortalRole = "viewer" | "analyst" | "admin";

export type WorkbenchSession = {
  version: typeof WORKBENCH_SESSION_VERSION;
  userId: string;
  email: string;
  displayName: string;
  role: PortalRole;
  issuedAt: number;
  expiresAt: number;
};

type SessionPayload = {
  v: number;
  sub: string;
  email: string;
  name: string;
  role: string;
  iat: number;
  exp: number;
};

function sessionSecret() {
  const secret = process.env.WORKBENCH_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("WORKBENCH_SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

export function sessionTtlSeconds() {
  const configured = Number(process.env.WORKBENCH_SESSION_TTL_SECONDS);
  if (!Number.isFinite(configured)) return 28_800;
  return Math.min(86_400, Math.max(300, Math.floor(configured)));
}

export function workbenchBasePath() {
  const configured = process.env.NEXT_PUBLIC_BASE_PATH?.trim();
  if (!configured || configured === "/") return "";
  return `/${configured.replace(/^\/+|\/+$/g, "")}`;
}

export function sessionCookiePath() {
  return workbenchBasePath() || "/";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Malformed base64url value.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodePayload(payload: SessionPayload) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodePayload(value: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown;
}

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function validRole(value: unknown): value is PortalRole {
  return value === "viewer" || value === "analyst" || value === "admin";
}

function asSession(candidate: unknown, nowSeconds: number): WorkbenchSession | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const payload = candidate as Partial<SessionPayload>;
  if (
    payload.v !== WORKBENCH_SESSION_VERSION ||
    typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 ||
    typeof payload.email !== "string" || !payload.email || payload.email.length > 320 ||
    typeof payload.name !== "string" || !payload.name || payload.name.length > 200 ||
    !validRole(payload.role) ||
    typeof payload.iat !== "number" || !Number.isInteger(payload.iat) ||
    typeof payload.exp !== "number" || !Number.isInteger(payload.exp) ||
    payload.iat > nowSeconds + 60 || payload.exp <= nowSeconds || payload.exp <= payload.iat
  ) return null;

  return {
    version: WORKBENCH_SESSION_VERSION,
    userId: payload.sub,
    email: payload.email,
    displayName: payload.name,
    role: payload.role,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

export async function createSignedSession(
  identity: { userId: string; email: string; displayName: string; role: PortalRole },
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const payload: SessionPayload = {
    v: WORKBENCH_SESSION_VERSION,
    sub: identity.userId,
    email: identity.email,
    name: identity.displayName,
    role: identity.role,
    iat: nowSeconds,
    exp: nowSeconds + sessionTtlSeconds(),
  };
  const encoded = encodePayload(payload);
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(encoded));
  return `${encoded}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifySignedSession(token: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || parts.some((part) => !part)) return null;
    const [encoded, encodedSignature] = parts;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;
    return asSession(decodePayload(encoded), nowSeconds);
  } catch {
    return null;
  }
}

export function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export async function getWorkbenchSession(request: Request) {
  const token = cookieValue(request.headers.get("cookie"), WORKBENCH_SESSION_COOKIE);
  return token ? verifySignedSession(token) : null;
}
