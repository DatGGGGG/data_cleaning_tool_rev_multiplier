import { NextResponse } from "next/server";
import { sessionCookiePath, WORKBENCH_SESSION_COOKIE, workbenchBasePath } from "@/lib/auth/session";

export async function POST() {
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: workbenchBasePath() || "/",
      "Cache-Control": "no-store",
    },
  });
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
