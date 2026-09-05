import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

/** Header, content column and the testnet footer for the four user screens. */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</main>
      <Footer />
    </>
  );
}
