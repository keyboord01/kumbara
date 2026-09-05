import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Booth admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function BoothAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
