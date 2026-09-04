import type { Metadata, Viewport } from "next";
import "@sembol/passkey-react/styles.css";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: { default: "Kumbara", template: "%s · Kumbara" },
  description: "Face ID ile açılan, anahtarı yalnızca sende olan USDC kumbarası. Lira yükle, USDC biriktir, istediğinde geri çek. Sembol tarafından.",
  applicationName: "Kumbara",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#fbf7f0",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
