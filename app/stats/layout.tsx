import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kumbara live",
  description: "Public, read-only traction page for Kumbara by Sembol on Stellar testnet: kumbaras opened, deposits, withdrawals, live vault balance, timings and contracts.",
};

/** Chrome-less shell: the stats page draws its own compact header (hidden in ?mode=tv). */
export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col">{children}</main>;
}
