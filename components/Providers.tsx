"use client";

import { PasskeyWalletProvider } from "@sembol/passkey-react";
import { sembolConfig } from "@/lib/config";
import { LocaleProvider } from "@/lib/i18n";
import { ToastProvider } from "./Toaster";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <PasskeyWalletProvider config={sembolConfig}>
        <ToastProvider>{children}</ToastProvider>
      </PasskeyWalletProvider>
    </LocaleProvider>
  );
}
