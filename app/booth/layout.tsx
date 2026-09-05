import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Booth",
  robots: { index: false, follow: false },
};

/** Chrome-less: the booth screen is a QR and a counter, nothing else. */
export default function BoothLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col">{children}</main>;
}
