import { CompanyValueSchema, safeUrl, type CompanyProfile } from "./schema.js";

/** A value is usable only with supporting citations, never inferred from funding. */
export function sourcedCompanyValue(profile?: CompanyProfile) {
  const parsed = CompanyValueSchema.safeParse(profile?.companyValue);
  if (
    !parsed.success ||
    Number(parsed.data.asOf.slice(0, 4)) > new Date().getUTCFullYear()
  )
    return null;
  const source = profile?.sources.find(
    (s) => s.fields.includes("companyValue") && safeUrl(s.url),
  );
  return source ? { ...parsed.data, source } : null;
}
export function valueRadius(amountUsd?: number) {
  if (!amountUsd || !Number.isFinite(amountUsd) || amountUsd <= 0) return 5;
  // Fixed logarithmic scale keeps a trillion-dollar company from covering the map.
  return Math.max(9, Math.min(34, 9 + (Math.log10(amountUsd) - 6) * 4));
}
export function formatCompanyValue(amountUsd: number) {
  const unit =
    amountUsd >= 1e12
      ? 1e12
      : amountUsd >= 1e9
        ? 1e9
        : amountUsd >= 1e6
          ? 1e6
          : 1e3;
  const suffix =
    unit === 1e12 ? "T" : unit === 1e9 ? "B" : unit === 1e6 ? "M" : "K";
  return (
    "$" +
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
      amountUsd / unit,
    ) +
    suffix
  );
}
export function companyValueKind(kind: string) {
  return kind === "market_cap"
    ? "market cap"
    : kind === "acquisition"
      ? "acquisition"
      : "valuation";
}
