"use client";

import { PasskeyWalletProvider, type SembolTheme } from "@sembol/passkey-react";
import { sembolConfig } from "@/lib/config";
import { LocaleProvider } from "@/lib/i18n";
import { ToastProvider } from "./Toaster";

/**
 * The Kumbara palette, handed to the library's own components (the Security page's signer list,
 * recovery setup and spending-policy form). This replaces the three `--sembol-*` variables that
 * used to sit in globals.css: they only reached the accent and the radius, which left the policy
 * form's primary button and the passkey chip on the library's default indigo. `accent` is the rose
 * every other primary button in the app uses; hover, active, muted and the focus ring derive from it.
 */
const sembolTheme: SembolTheme = {
  colorScheme: "light",
  accent: "#c9356a",
  colors: {
    accentHover: "#ac2a59",
    onAccent: "#ffffff",
    bg: "#fdf5f4",
    surface: "#ffffff",
    surfaceHover: "#f9e7e6",
    border: "#f0dbd9",
    borderStrong: "#e2c1c0",
    fg: "#33212a",
    fgMuted: "#6b5058",
    success: "#1a7a58",
    danger: "#b42318",
  },
  radius: 14,
  // The library's components sit inside Kumbara's own cards, which already carry the shadow.
  shadows: false,
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <PasskeyWalletProvider config={sembolConfig} theme={sembolTheme}>
        <ToastProvider>{children}</ToastProvider>
      </PasskeyWalletProvider>
    </LocaleProvider>
  );
}
