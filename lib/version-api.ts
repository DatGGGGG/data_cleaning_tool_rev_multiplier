import { createHash, timingSafeEqual } from "node:crypto";

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VersionNotFoundError extends Error {
  constructor() {
    super("Version not found.");
    this.name = "VersionNotFoundError";
  }
}

export type VersionCsvExport = {
  fileName: string;
  csv: string;
};

export function getCsvIntegrity(csv: string) {
  const bytes = Buffer.from(csv, "utf-8");
  return {
    csvByteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function isValidVersionId(versionId: string) {
  return VERSION_ID_PATTERN.test(versionId);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

function getAuthenticationFailure(request: Request, configuredToken = process.env.PORTAL_SERVICE_TOKEN) {
  const expectedToken = configuredToken?.trim();
  if (!expectedToken) {
    return jsonResponse({ error: "Portal service authentication is not configured." }, 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  const presentedToken = match?.[1] ?? "";
  const expectedDigest = createHash("sha256").update(expectedToken, "utf-8").digest();
  const presentedDigest = createHash("sha256").update(presentedToken, "utf-8").digest();

  if (!match || !timingSafeEqual(expectedDigest, presentedDigest)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  return null;
}

export async function handleVersionListRequest<T>(
  request: Request,
  listVersions: () => Promise<T[]>,
  configuredToken = process.env.PORTAL_SERVICE_TOKEN,
) {
  const authenticationFailure = getAuthenticationFailure(request, configuredToken);
  if (authenticationFailure) {
    return authenticationFailure;
  }

  try {
    return jsonResponse({ versions: await listVersions() });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to load versions." },
      500,
    );
  }
}

function safeAttachmentFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function handleVersionDownloadRequest(
  request: Request,
  versionId: string,
  exportVersion: (versionId: string) => Promise<VersionCsvExport>,
  configuredToken = process.env.PORTAL_SERVICE_TOKEN,
) {
  const authenticationFailure = getAuthenticationFailure(request, configuredToken);
  if (authenticationFailure) {
    return authenticationFailure;
  }

  if (!isValidVersionId(versionId)) {
    return jsonResponse({ error: "Malformed version ID." }, 400);
  }

  try {
    const { fileName, csv } = await exportVersion(versionId);
    const { checksumSha256 } = getCsvIntegrity(csv);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeAttachmentFileName(fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-SHA256": checksumSha256,
      },
    });
  } catch (error) {
    if (error instanceof VersionNotFoundError) {
      return jsonResponse({ error: error.message }, 404);
    }

    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to export version." },
      500,
    );
  }
}
