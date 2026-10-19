import { describe, it, expect } from "vitest";
import {
  sourcedCompanyValue,
  valueRadius,
  formatCompanyValue,
} from "../packages/shared/src/company-value.js";
import { ProfileFactsSchema, type CompanyProfile } from "../packages/shared/src/schema.js";
const profile = {
  companyValue: { kind: "valuation", amountUsd: 1e9, asOf: "2025-06-12" },
  funding: { amount: "50000000", currency: "USD", date: "2025" },
  sources: [
    {
      url: "https://example.com/announcement",
      title: "Announcement",
      fields: ["companyValue"],
    },
  ],
} as CompanyProfile;
describe("company value map scale", () => {
  it('keeps an otherwise valid profile when an optional value is unavailable or invalid', () => {
    const facts = ProfileFactsSchema.parse({ name: 'Example', description: 'Builds software.', product: null, domain: null, address: null, fact: null, tags: [], founders: [], funding: null, companyValue: { amountUsd: 0, kind: 'valuation', asOf: '2025' } });
    expect(facts.companyValue).toBeNull();
  });
  it("requires value citations and never substitutes funding", () => {
    expect(sourcedCompanyValue(profile)?.amountUsd).toBe(1e9);
    expect(sourcedCompanyValue({ ...profile, companyValue: null })).toBeNull();
    expect(
      sourcedCompanyValue({
        ...profile,
        sources: [{ ...profile.sources[0], fields: ["funding"] }],
      }),
    ).toBeNull();
    expect(
      sourcedCompanyValue({
        ...profile,
        sources: [{ ...profile.sources[0], url: "javascript:alert(1)" }],
      }),
    ).toBeNull();
  });
  it("rejects negative values and future reporting years", () => {
    expect(
      sourcedCompanyValue({
        ...profile,
        companyValue: { ...profile.companyValue!, amountUsd: -1 },
      }),
    ).toBeNull();
    expect(
      sourcedCompanyValue({
        ...profile,
        companyValue: { ...profile.companyValue!, asOf: "2100" },
      }),
    ).toBeNull();
  });
  it("scales known values monotonically with a readable upper bound", () => {
    expect(valueRadius()).toBe(5);
    expect(valueRadius(1e8)).toBeLessThan(valueRadius(1e10));
    expect(valueRadius(1e15)).toBe(34);
    expect(formatCompanyValue(10.2e9)).toBe("$10.2B");
    expect(formatCompanyValue(500e6)).toBe("$500M");
  });
});
