import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { appApiPath } from "@/lib/app-path";
import { getMappingArtifactPrincipal } from "@/lib/mapping-artifacts/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "VN Strategy Data Cleaning Workbench",
  description: "Operator workbench for manual Sensor Tower data-cleaning inputs.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const principal = await getMappingArtifactPrincipal(new Request("http://workbench.internal", { headers: requestHeaders }));
  const initials = principal?.displayName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <html lang="en">
      <body>
        <div className="enterprise-frame">
          <header className="topbar">
            <div className="topbar-brand">
              <Link href="/" className="brand-link">
                VN Strategy Data Workbench
              </Link>
            </div>
            <nav className="topbar-nav" aria-label="Primary">
              <Link href="/" className="topbar-link">
                Top Down Mapping
              </Link>
              <Link href="/bottom-up" className="topbar-link">
                Bottom Up Mapping
              </Link>
              <Link href="/apps-publisher-ids" className="topbar-link">
                Apps + Publisher IDs
              </Link>
              <Link href="/full-mapping" className="topbar-link">
                Full Mapping
              </Link>
              <Link href="/artifact-registry" className="topbar-link">
                Artifact Registry
              </Link>
              <Link href="/publisher-management" className="topbar-link">
                Publisher Management
              </Link>
              <Link href="/audit-trail" className="topbar-link">
                Audit Trail
              </Link>
              <Link href="/settings" className="topbar-link">
                Settings
              </Link>
            </nav>
            <div className="topbar-user">
              <span className="user-badge">{initials}</span>
              <span className="topbar-user-identity">
                <strong>{principal?.displayName || "Not signed in"}</strong>
                {principal ? <small>{principal.portalRole}</small> : null}
              </span>
              {principal ? <form action={appApiPath("/auth/logout")} method="post"><button className="topbar-logout" type="submit">Logout</button></form> : null}
            </div>
          </header>
          <main className="page-frame">{children}</main>
        </div>
      </body>
    </html>
  );
}
