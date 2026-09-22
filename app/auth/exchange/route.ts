import { NextResponse } from "next/server";
import { consumeWorkspaceGrant } from "@/lib/auth/portal";
import {
  createSignedSession,
  sessionCookiePath,
  sessionTtlSeconds,
  WORKBENCH_SESSION_COOKIE,
  workbenchBasePath,
} from "@/lib/auth/session";

function validCode(value: string | null): value is string {
  return Boolean(value && value.length <= 2_048 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
}

function failure(message: string, status: number) {
  return new NextResponse(message, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!validCode(code)) return failure("A valid one-time workspace grant is required.", 400);

  try {
    const identity = await consumeWorkspaceGrant(code);
    const session = await createSignedSession(identity);
    const response = new NextResponse(null, {
      status: 303,
      headers: {
        Location: `${workbenchBasePath()}/full-mapping`,
        "Cache-Control": "no-store",
      },
    });
    response.cookies.set({
      name: WORKBENCH_SESSION_COOKIE,
      value: session,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: sessionCookiePath(),
      maxAge: sessionTtlSeconds(),
    });
    return response;
  } catch {
    return failure("The workspace grant could not be exchanged. Return to the portal and launch the workbench again.", 401);
  }
}
