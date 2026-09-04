"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "tr" | "en";

const STORAGE_KEY = "kumbara.lang";

export const dict = {
  tr: {
    brand: "Kumbara",
    bySembol: "Sembol tarafından",
    network: { testnet: "TESTNET", mainnet: "MAINNET" },
    footer: "Test ağı. Gerçek lira hareket etmez.",
    footerMainnet: "Ana ağ. Gerçek USDC hareket eder.",
    nav: { savings: "Kumbaram", deposit: "Yükle", withdraw: "Çek", security: "Güvenlik" },
    onboard: {
      title: "Liranı USDC olarak biriktir.",
      lead: "Kumbara, telefonundaki Face ID ile açılan, anahtarı yalnızca sende olan bir USDC kumbarasıdır. Şifre yok, uygulama yok, XLM yok.",
      cta: "Kumbaranı aç",
      existing: "Kumbarana git",
      phasePasskey: "Face ID bekleniyor…",
      phaseDeploy: "Kumbaran Stellar'da oluşturuluyor…",
      phaseLimit: "Harcama limiti kuruluyor (ikinci onay)…",
      done: "Kumbaran hazır.",
      address: "Kumbara adresi",
      explorer: "stellar.expert'te gör",
      limitNote: "Varsayılan harcama limiti işlem başına 1.000 USDC. Güvenlik sayfasından değiştirebilirsin.",
      errorTitle: "Olmadı.",
      retry: "Tekrar dene",
      steps: ["Face ID ile aç", "Lira yükle, USDC olsun", "USDC DeFindex'te getiri kazanabilir", "İstediğinde liraya geri çek"],
    },
    savings: {
      title: "Kumbaram",
      inVault: "Kumbarada",
      waiting: "Beklemede (henüz kasada değil)",
      tryEquiv: "≈",
      rateSource: { reflector: "Reflector kuru", anchor: "Anchor kuru" },
      vault: "Kasa",
      yieldLine: "USDC'n DeFindex'te getiri kazanabilir.",
      noStrategy: "Test ağındaki kasada aktif strateji yok; getiri oluşmaz.",
      risk: "Getiri garanti değildir. DeFindex stratejileri ve akıllı sözleşmeler risk taşır; kaybı göze alamayacağın parayı koyma.",
      recovery: "Kurtarma",
      recoveryOk: "Yedek anahtar var",
      recoveryMissing: "Yedek anahtar yok",
      recoveryHint: "Telefonu kaybedersen kumbaraya erişmek için bir yedek ekle.",
      limit: "Harcama limiti",
      limitPerTx: "işlem başına",
      limitPer: "her",
      limitNone: "Limit yok",
      manage: "Güvenlik ayarları",
      deposit: "Yükle",
      withdraw: "Çek",
      address: "Kumbara adresi",
      refresh: "Yenile",
      loading: "Yükleniyor…",
      notConnected: "Bağlı kumbara yok.",
      open: "Kumbaranı aç",
      ledgers: "ledger",
    },
    security: {
      title: "Güvenlik",
      signers: "İmzacılar",
      signersHint: "Kumbarayı onaylayabilen her anahtar. Telefonun kaybolursa kumbaran kaybolmasın diye ikinci bir cihaz ya da yedek anahtar ekle.",
      recovery: "Kurtarma",
      recoveryHint: "Şimdi bir kurtarma anahtarı kaydet. Yeni bir cihazdan girmek için açılış sayfasındaki Kurtar'ı kullan.",
      limit: "Harcama limiti",
      limitHint: "Kumbaradan çıkan her USDC transferi (kasaya yatırma dahil) bu limite tabidir. Zincir üstünde uygulanır.",
      back: "Kumbarama dön",
    },
    soon: { title: "Bir sonraki adımda.", body: "Bu ekran bir sonraki yapı adımında geliyor.", back: "Kumbarama dön" },
    errors: {
      relay: "Sembol Cloud'a ulaşılamadı. Kumbara ücretleri bizim tarafımızdan karşılanır; lütfen biraz sonra tekrar dene.",
      cancelled: "Face ID iptal edildi.",
      generic: "Beklenmedik bir hata oldu.",
    },
  },
  en: {
    brand: "Kumbara",
    bySembol: "by Sembol",
    network: { testnet: "TESTNET", mainnet: "MAINNET" },
    footer: "Testnet. No real lira moves.",
    footerMainnet: "Mainnet. Real USDC moves.",
    nav: { savings: "My kumbara", deposit: "Deposit", withdraw: "Withdraw", security: "Security" },
    onboard: {
      title: "Put lira away as USDC.",
      lead: "Kumbara is a USDC piggy bank that opens with the Face ID on your phone. Only you hold the key. No password, no app, no XLM.",
      cta: "Open your kumbara",
      existing: "Go to your kumbara",
      phasePasskey: "Waiting for Face ID…",
      phaseDeploy: "Creating your kumbara on Stellar…",
      phaseLimit: "Installing the spending limit (second approval)…",
      done: "Your kumbara is ready.",
      address: "Kumbara address",
      explorer: "View on stellar.expert",
      limitNote: "The default spending limit is 1,000 USDC per transaction. Change it on the security page.",
      errorTitle: "That did not work.",
      retry: "Try again",
      steps: ["Open with Face ID", "Deposit lira, receive USDC", "USDC can earn yield through DeFindex", "Withdraw back to lira whenever you like"],
    },
    savings: {
      title: "My kumbara",
      inVault: "In the kumbara",
      waiting: "Waiting (not in the vault yet)",
      tryEquiv: "≈",
      rateSource: { reflector: "Reflector rate", anchor: "Anchor rate" },
      vault: "Vault",
      yieldLine: "Your USDC can earn yield through DeFindex.",
      noStrategy: "The testnet vault has no active strategy, so no yield accrues.",
      risk: "Yield is not guaranteed. DeFindex strategies and smart contracts carry risk; do not put in money you cannot afford to lose.",
      recovery: "Recovery",
      recoveryOk: "Backup key enrolled",
      recoveryMissing: "No backup key",
      recoveryHint: "Add a backup so a lost phone is not a lost kumbara.",
      limit: "Spending limit",
      limitPerTx: "per transaction",
      limitPer: "per",
      limitNone: "No limit",
      manage: "Security settings",
      deposit: "Deposit",
      withdraw: "Withdraw",
      address: "Kumbara address",
      refresh: "Refresh",
      loading: "Loading…",
      notConnected: "No kumbara connected.",
      open: "Open your kumbara",
      ledgers: "ledgers",
    },
    security: {
      title: "Security",
      signers: "Signers",
      signersHint: "Every key that can approve the kumbara. Add a second device or a backup key so a lost phone is not a lost kumbara.",
      recovery: "Recovery",
      recoveryHint: "Enroll a recovery credential now. To get back in from a new device, use Recover on the landing page.",
      limit: "Spending limit",
      limitHint: "Every USDC transfer leaving the kumbara (vault deposits included) is subject to this limit. Enforced on-chain.",
      back: "Back to my kumbara",
    },
    soon: { title: "Next build step.", body: "This screen arrives in the next build step.", back: "Back to my kumbara" },
    errors: {
      relay: "Sembol Cloud could not be reached. Fees are covered for you; please try again shortly.",
      cancelled: "Face ID was cancelled.",
      generic: "Something unexpected happened.",
    },
  },
} as const;

export type Dict = (typeof dict)["tr"];

interface LocaleContextValue {
  locale: Locale;
  t: Dict;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("tr");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "tr") setLocaleState(stored);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({ locale, t: dict[locale] as Dict, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider");
  return ctx;
}
