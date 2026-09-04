export function formatUsdc(raw: bigint | number | string | null | undefined, locale: "tr" | "en" = "tr"): string {
  if (raw === null || raw === undefined) return "–";
  const value = typeof raw === "bigint" ? Number(raw) / 1e7 : Number(raw);
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatTry(value: number | null | undefined, locale: "tr" | "en" = "tr"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value);
}

export function shortAddress(address: string, chars = 6): string {
  return address.length > chars * 2 + 1 ? `${address.slice(0, chars)}…${address.slice(-chars)}` : address;
}
