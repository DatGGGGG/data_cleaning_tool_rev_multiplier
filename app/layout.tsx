import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "VN Strategy Data Cleaning Workbench",
  description: "Operator workbench for manual Sensor Tower data-cleaning inputs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
              <Link href="/full-mapping" className="topbar-link">
                Full Mapping
              </Link>
              <Link href="/publisher-management" className="topbar-link">
                Publisher Management
              </Link>
              <Link href="/" className="topbar-link">
                Versions
              </Link>
              <Link href="/audit-trail" className="topbar-link">
                Audit Trail
              </Link>
              <Link href="/settings" className="topbar-link">
                Settings
              </Link>
            </nav>
            <div className="topbar-user">
              <span className="user-badge">D</span>
              <span>Data Cleaning Ops</span>
            </div>
          </header>
          <main className="page-frame">{children}</main>
        </div>
      </body>
    </html>
  );
}
