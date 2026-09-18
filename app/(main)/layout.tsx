"use client";

import { cn } from "cn";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { BottomNav, useBottomNavPadding } from "@/components/Nav";
import { NetworkGuard } from "@/components/NetworkGuard";
import { OfflineBanner } from "@/components/OfflineBanner";

/**
 * Header with the desktop nav, offline notice, content column (one column on
 * a phone, room for two on a laptop), the testnet footer and the phone tab
 * bar. NetworkGuard replaces the content when the link, the build and the
 * server disagree on the network or the server answers with Vercel's login page.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  const padding = useBottomNavPadding();
  return (
    <>
      <Header />
      <OfflineBanner />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6 lg:max-w-5xl lg:px-8">
        <NetworkGuard>{children}</NetworkGuard>
      </main>
      <Footer />
      {/* The tab bar is fixed over the bottom of the viewport. The room for it goes *below* the footer:
          padding on <main> alone left the footer underneath the bar, where it could not be read. */}
      <div className={cn("flex-none", padding)} aria-hidden />
      <BottomNav />
    </>
  );
}
