import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const variables = [
  "MAPPING_ARTIFACT_UI_ENABLED",
  "MAPPING_ARTIFACT_MUTATIONS_ENABLED",
  "NEXT_PUBLIC_BASE_PATH",
  "NODE_ENV",
  "PORTAL_INTERNAL_API_BASE_URL",
  "PORTAL_SERVICE_TOKEN",
  "SENSORTOWER_PIPELINE_API_BASE_URL",
  "SENSORTOWER_PIPELINE_API_SERVICE_TOKEN",
  "WORKBENCH_SESSION_SECRET",
  "WORKBENCH_SESSION_TTL_SECONDS",
];

function snapshotEnvironment() {
  return Object.fromEntries(variables.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const key of variables) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function configureSession() {
  process.env.WORKBENCH_SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
  process.env.WORKBENCH_SESSION_TTL_SECONDS = "28800";
  process.env.NEXT_PUBLIC_BASE_PATH = "/cleaning/sensortower";
}

function configureArtifacts() {
  process.env.MAPPING_ARTIFACT_UI_ENABLED = "true";
  process.env.MAPPING_ARTIFACT_MUTATIONS_ENABLED = "true";
  process.env.SENSORTOWER_PIPELINE_API_BASE_URL = "http://host.docker.internal:8010";
  process.env.SENSORTOWER_PIPELINE_API_SERVICE_TOKEN = "pipeline-secret-not-for-the-browser";
}

async function sessionCookie(role = "analyst", nowSeconds) {
  const { createSignedSession, WORKBENCH_SESSION_COOKIE } = await import("../lib/auth/session.ts");
  const token = await createSignedSession({
    userId: "123",
    email: "user@garena.com",
    displayName: "User Name",
    role,
  }, nowSeconds);
  return { token, header: `${WORKBENCH_SESSION_COOKIE}=${encodeURIComponent(token)}` };
}

test("signed sessions verify trusted identity and reject tampering and expiry", async () => {
  const original = snapshotEnvironment();
  try {
    configureSession();
    const now = 1_800_000_000;
    const { token } = await sessionCookie("analyst", now);
    const { verifySignedSession } = await import("../lib/auth/session.ts");
    const session = await verifySignedSession(token, now + 1);
    assert.equal(session?.userId, "123");
    assert.equal(session?.email, "user@garena.com");
    assert.equal(session?.displayName, "User Name");
    assert.equal(session?.role, "analyst");
    assert.equal(await verifySignedSession(`${token.slice(0, -1)}x`, now + 1), null);
    assert.equal(await verifySignedSession(token, now + 28_801), null);
  } finally {
    restoreEnvironment(original);
  }
});

test("portal workspace grant exchange creates a secure bounded session and drops the code", async () => {
  const original = snapshotEnvironment();
  const originalFetch = globalThis.fetch;
  try {
    configureSession();
    process.env.NODE_ENV = "production";
    process.env.PORTAL_INTERNAL_API_BASE_URL = "http://portal-api:8000";
    process.env.PORTAL_SERVICE_TOKEN = "portal-secret-not-for-the-browser";
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "http://portal-api:8000/api/v1/internal/workspace-grants/consume");
      assert.equal(init?.headers?.Authorization, "Bearer portal-secret-not-for-the-browser");
      assert.deepEqual(JSON.parse(init?.body), { audience: "sensortower-cleaning", code: "single-use-code" });
      return Response.json({ user_id: 123, email: "user@garena.com", display_name: "User Name", role: "admin" });
    };
    const { GET } = await import("../app/auth/exchange/route.ts");
    const response = await GET(new Request("http://0.0.0.0:3000/cleaning/sensortower/auth/exchange?code=single-use-code", {
      headers: { host: "attacker.example" },
    }));
    assert.equal(response.status, 303);
    const location = response.headers.get("location") || "";
    assert.equal(location, "/cleaning/sensortower/full-mapping");
    assert.doesNotMatch(location, /0\.0\.0\.0|localhost|attacker\.example|^[a-z][a-z0-9+.-]*:\/\//i);
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /sensortower_workbench_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Path=\/cleaning\/sensortower/i);
    assert.doesNotMatch(cookie, /single-use-code|portal-secret|pipeline-secret/);
    assert.doesNotMatch(await response.text(), /single-use-code|portal-secret|pipeline-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(original);
  }
});

test("grant exchange rejects missing, malformed, and portal-rejected codes", async () => {
  const original = snapshotEnvironment();
  const originalFetch = globalThis.fetch;
  try {
    configureSession();
    process.env.PORTAL_INTERNAL_API_BASE_URL = "http://portal-api:8000";
    process.env.PORTAL_SERVICE_TOKEN = "portal-service-token";
    const { GET } = await import("../app/auth/exchange/route.ts");
    assert.equal((await GET(new Request("http://localhost/auth/exchange"))).status, 400);
    assert.equal((await GET(new Request(`http://localhost/auth/exchange?code=${"x".repeat(2049)}`))).status, 400);
    globalThis.fetch = async () => new Response("rejected", { status: 401 });
    assert.equal((await GET(new Request("http://localhost/auth/exchange?code=expired-code"))).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(original);
  }
});

test("artifact roles enforce viewer, analyst, and admin capabilities", async () => {
  const original = snapshotEnvironment();
  try {
    configureSession();
    configureArtifacts();
    const { requireMappingArtifactCapability } = await import("../lib/mapping-artifacts/auth.ts");

    const viewer = await sessionCookie("viewer");
    const viewerRequest = new Request("http://localhost/api/mapping-artifacts/catalog", { headers: { cookie: viewer.header } });
    assert.equal((await requireMappingArtifactCapability(viewerRequest, "read")).portalRole, "viewer");
    await assert.rejects(() => requireMappingArtifactCapability(viewerRequest, "publish"), (error) => error?.status === 403);

    const analyst = await sessionCookie("analyst");
    const analystRequest = new Request("http://localhost/api/mapping-artifacts/catalog", { headers: { cookie: analyst.header } });
    assert.equal((await requireMappingArtifactCapability(analystRequest, "publish")).portalRole, "analyst");
    assert.equal((await requireMappingArtifactCapability(analystRequest, "commit")).portalRole, "analyst");
    await assert.rejects(() => requireMappingArtifactCapability(analystRequest, "activate"), (error) => error?.status === 403);

    const admin = await sessionCookie("admin");
    const adminRequest = new Request("http://localhost/api/mapping-artifacts/catalog", { headers: { cookie: admin.header } });
    assert.equal((await requireMappingArtifactCapability(adminRequest, "publish")).portalRole, "admin");
    assert.equal((await requireMappingArtifactCapability(adminRequest, "commit")).portalRole, "admin");
    assert.equal((await requireMappingArtifactCapability(adminRequest, "activate")).portalRole, "admin");
  } finally {
    restoreEnvironment(original);
  }
});

test("middleware protects pages and APIs and enforces same-origin mutations", async () => {
  const original = snapshotEnvironment();
  try {
    configureSession();
    const { config, middleware } = await import("../middleware.ts");
    assert.ok(config.matcher.includes("/"), "the exact configured base-path root must be matched");
    const publicHealth = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/api/health"));
    assert.equal(publicHealth.status, 200);

    const portalVersionApi = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/api/top-down/versions", {
      headers: { authorization: "Bearer validated-by-the-route-handler" },
    }));
    assert.equal(portalVersionApi.status, 200);
    const portalVersionMutation = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/api/top-down/versions", {
      method: "POST",
    }));
    assert.equal(portalVersionMutation.status, 401);

    const deniedApi = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/api/settings"));
    assert.equal(deniedApi.status, 401);
    const deniedPage = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/full-mapping"));
    assert.equal(deniedPage.status, 401);
    const deniedBasePathRoot = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower"));
    assert.equal(deniedBasePathRoot.status, 401);

    const { header } = await sessionCookie("analyst");
    const missingOrigin = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/api/settings", {
      method: "POST",
      headers: { cookie: header },
    }));
    assert.equal(missingOrigin.status, 403);
    const foreignOrigin = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/api/settings", {
      method: "POST",
      headers: { cookie: header, origin: "https://evil.example" },
    }));
    assert.equal(foreignOrigin.status, 403);
    const sameOrigin = await middleware(new NextRequest("https://market-data.garena.vn/cleaning/sensortower/api/settings", {
      method: "POST",
      headers: { cookie: header, origin: "https://market-data.garena.vn" },
    }));
    assert.equal(sameOrigin.status, 200);
  } finally {
    restoreEnvironment(original);
  }
});

test("logout expires the session cookie, redirects relatively, and health remains public", async () => {
  const original = snapshotEnvironment();
  try {
    configureSession();
    process.env.NODE_ENV = "production";
    const { POST } = await import("../app/auth/logout/route.ts");
    const logout = await POST(new Request("http://0.0.0.0:3000/cleaning/sensortower/auth/logout", {
      method: "POST",
      headers: { host: "attacker.example" },
    }));
    assert.equal(logout.status, 303);
    const location = logout.headers.get("location") || "";
    assert.equal(location, "/cleaning/sensortower");
    assert.doesNotMatch(location, /0\.0\.0\.0|localhost|attacker\.example|^[a-z][a-z0-9+.-]*:\/\//i);
    assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
    const { GET } = await import("../app/api/health/route.ts");
    const health = await GET();
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
  } finally {
    restoreEnvironment(original);
  }
});
