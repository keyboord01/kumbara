import type { Metadata, Viewport } from "next";
import "@sembol/passkey-react/styles.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SITE_URL } from "@/lib/config";

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: { default: "Kumbara", template: "%s · Kumbara" },
  description: "A USDC piggy bank opened with a passkey (Face ID, Touch ID or your password manager) whose only key is yours. Put lira in, save in USDC, take it back out whenever you like. By Sembol.",
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
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
