"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePasskeyWallet } from "@sembol/passkey-react";
import { cn } from "cn";
import { ArrowDownToLineIcon, ArrowUpFromLineIcon, PiggyBankIcon, ShieldCheckIcon } from "lucide-react";
import { useLocale } from "@/lib/i18n";

const ITEMS = [
  { key: "savings", href: "/kumbara", icon: PiggyBankIcon },
  { key: "deposit", href: "/yukle", icon: ArrowDownToLineIcon },
  { key: "withdraw", href: "/cek", icon: ArrowUpFromLineIcon },
  { key: "security", href: "/kumbara/guvenlik", icon: ShieldCheckIcon },
] as const;

const LAPTOP = "(min-width: 768px)";

/** One nav at a time: the header nav on laptops, the tab bar on phones. Rendering only one keeps a single set of links in the DOM. */
function useLaptop(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mq = window.matchMedia(LAPTOP);
      mq.addEventListener("change", callback);
      return () => mq.removeEventListener("change", callback);
    },
    () => window.matchMedia(LAPTOP).matches,
    () => false,
  );
}

function useNavItems() {
  const { t } = useLocale();
  const pathname = usePathname();
  return ITEMS.map((item) => ({
    ...item,
    label: t.nav[item.key],
    active: item.href === "/kumbara" ? pathname === "/kumbara" || pathname === "/kumbara/kanit" : pathname.startsWith(item.href),
  }));
}

/** Desktop: the four destinations in the header, only once a kumbara is connected. */
export function HeaderNav() {
  const { isConnected } = usePasskeyWallet();
  const { t } = useLocale();
  const items = useNavItems();
  const laptop = useLaptop();
  if (!isConnected || !laptop) return null;
  return (
    <nav className="flex items-center gap-1" aria-label={t.nav.label}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn("rounded-full px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-muted hover:text-foreground", item.active ? "bg-plum/10 text-plum" : "text-muted-foreground")}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Phone: a bottom tab bar, only once a kumbara is connected; the page keeps room for it. */
export function BottomNav() {
  const { isConnected } = usePasskeyWallet();
  const { t } = useLocale();
  const items = useNavItems();
  const laptop = useLaptop();
  if (!isConnected || laptop) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label={t.nav.label} data-testid="bottom-nav">
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors", item.active ? "text-plum" : "text-muted-foreground hover:text-foreground")}
            >
              <item.icon className={cn("size-5", item.active && "fill-plum/15")} aria-hidden />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Bottom padding for the tab bar on phones while connected. */
export function useBottomNavPadding(): string {
  const { isConnected } = usePasskeyWallet();
  return isConnected ? "pb-24 md:pb-6" : "pb-6";
}
