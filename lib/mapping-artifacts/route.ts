import { NextResponse } from "next/server";
import { asMappingArtifactError, MappingArtifactWorkbenchError } from "@/lib/mapping-artifacts/errors";

export function mappingArtifactErrorResponse(error: unknown) {
  const normalized = asMappingArtifactError(error);
  return NextResponse.json(
    { error: { code: normalized.code, message: normalized.message } },
    { status: normalized.status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readJsonObject(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64 * 1024) {
    throw new MappingArtifactWorkbenchError("request_too_large", "Request body is too large.", 413);
  }
  let candidate: unknown;
  try {
    candidate = await request.json();
  } catch {
    throw new MappingArtifactWorkbenchError("invalid_request", "Request body must contain valid JSON.", 400);
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new MappingArtifactWorkbenchError("invalid_request", "Request body must be a JSON object.", 400);
  }
  return candidate as Record<string, unknown>;
}
