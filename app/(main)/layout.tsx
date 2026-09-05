import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { NetworkGuard } from "@/components/NetworkGuard";
import { OfflineBanner } from "@/components/OfflineBanner";

/**
 * Header, offline notice, content column and the testnet footer for the user
 * screens. NetworkGuard replaces the content when the link, the build and
 * the server disagree on the network or the server answers with Vercel's
 * login page.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <OfflineBanner />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        <NetworkGuard>{children}</NetworkGuard>
      </main>
      <Footer />
    </>
  );
}
