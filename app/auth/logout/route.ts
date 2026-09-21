import { NextResponse } from "next/server";
import { sessionCookiePath, WORKBENCH_SESSION_COOKIE, workbenchBasePath } from "@/lib/auth/session";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL(workbenchBasePath() || "/", request.url), 303);
  response.cookies.set({
    name: WORKBENCH_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: sessionCookiePath(),
    maxAge: 0,
  });
  return response;
}
